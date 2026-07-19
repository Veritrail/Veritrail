"""Collect Amazon Inspector v2 account status and active findings (all severities)."""
from __future__ import annotations

import uuid
from collections import Counter
from datetime import datetime, timezone

import structlog
from botocore.exceptions import ClientError
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.aws import assume_role
from app.models import AwsAccount
from app.models.resources import InspectorAccountStatus, InspectorFinding

log = structlog.get_logger()

_STORE_SEVERITIES = {"CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL", "UNTRIAGED"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _get_regions(sess) -> list[str]:
    ec2 = sess.client("ec2", region_name="us-east-1")
    return [
        r["RegionName"]
        for r in ec2.describe_regions(
            Filters=[{"Name": "opt-in-status", "Values": ["opt-in-not-required", "opted-in"]}]
        )["Regions"]
    ]


def _resource_enabled(state: dict | None) -> bool:
    if not state:
        return False
    return str(state.get("status", "")).upper() == "ENABLED"


def _coverage_bucket(resource_type: str | None) -> str | None:
    value = str(resource_type or "").upper()
    if "EC2" in value:
        return "ec2"
    if "ECR" in value or "CONTAINER_IMAGE" in value:
        return "ecr"
    if "LAMBDA" in value:
        return "lambda"
    if "CODE_REPOSITORY" in value:
        return "code_repository"
    return None


def _coverage_evidence(inspector) -> tuple[dict[str, dict], list[str]]:
    coverage: dict[str, dict] = {}
    limitations: list[str] = []
    try:
        paginator = inspector.get_paginator("list_coverage")
        for page in paginator.paginate():
            for row in page.get("coveredResources") or []:
                bucket = _coverage_bucket(row.get("resourceType"))
                if not bucket:
                    continue
                target = coverage.setdefault(
                    bucket,
                    {"eligible": 0, "assessed": 0, "excluded": 0, "last_scanned_at": None, "limitations": []},
                )
                target["eligible"] += 1
                scan = row.get("scanStatus") or {}
                status_code = str(scan.get("statusCode") or "").upper()
                if status_code in {"ACTIVE", "ENABLED", "SUCCESSFUL"}:
                    target["assessed"] += 1
                else:
                    reason = str(scan.get("reason") or status_code or "coverage_inactive").lower()
                    if reason not in target["limitations"]:
                        target["limitations"].append(reason)
                observed = row.get("lastScannedAt") or row.get("scanStatusUpdatedAt")
                if isinstance(observed, datetime):
                    observed = observed.isoformat()
                if observed and (
                    not target["last_scanned_at"] or str(observed) > str(target["last_scanned_at"])
                ):
                    target["last_scanned_at"] = str(observed)
    except Exception as exc:  # noqa: BLE001 - coverage support varies by region/account
        limitations.append(f"inspector_coverage_collection_failed:{type(exc).__name__}")
    return coverage, limitations


def collect_inspector(db: Session, account: AwsAccount) -> dict:
    sess = assume_role(
        account.role_arn,
        account.external_id,
        session_name="veritrail-inspector",
        aws_account=account,
        purpose="collect_inspector",
    )
    aws_account_id = account.account_id
    if not aws_account_id:
        sts = sess.client("sts")
        aws_account_id = sts.get_caller_identity()["Account"]

    status_count = finding_count = 0
    severity_totals: Counter[str] = Counter()
    for region in _get_regions(sess):
        try:
            inspector = sess.client("inspector2", region_name=region)
            status_resp = inspector.batch_get_account_status(accountIds=[aws_account_id])
            accounts = status_resp.get("accounts") or []
            if not accounts:
                continue
            acct = accounts[0]
            resource_state = acct.get("resourceState") or {}
            ecr_on = _resource_enabled(resource_state.get("ecr"))
            ec2_on = _resource_enabled(resource_state.get("ec2"))
            lambda_on = _resource_enabled(resource_state.get("lambda"))
            lambda_code_on = _resource_enabled(
                resource_state.get("lambdaCode") or resource_state.get("lambda_code")
            )
            code_repo_on = _resource_enabled(
                resource_state.get("codeRepository") or resource_state.get("code_repository")
            )
            coverage, coverage_limitations = _coverage_evidence(inspector)
            evidence = {
                "resource_state": {
                    k: (v or {}).get("status") if isinstance(v, dict) else v
                    for k, v in resource_state.items()
                },
                "account_state": (acct.get("state") or {}).get("status")
                if isinstance(acct.get("state"), dict)
                else acct.get("state"),
                "coverage": coverage,
                "limitations": coverage_limitations,
            }
            stmt = pg_insert(InspectorAccountStatus).values(
                id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:inspector:{region}"),
                account_id=account.id,
                region=region,
                ecr_enabled=ecr_on,
                ec2_enabled=ec2_on,
                lambda_enabled=lambda_on,
                lambda_code_enabled=lambda_code_on,
                code_repository_enabled=code_repo_on,
                evidence_json=evidence,
                last_seen=_now(),
            ).on_conflict_do_update(
                index_elements=["account_id", "region"],
                set_={
                    "ecr_enabled": ecr_on,
                    "ec2_enabled": ec2_on,
                    "lambda_enabled": lambda_on,
                    "lambda_code_enabled": lambda_code_on,
                    "code_repository_enabled": code_repo_on,
                    "evidence_json": evidence,
                    "last_seen": _now(),
                },
            )
            db.execute(stmt)
            status_count += 1

            if not (ecr_on or ec2_on or lambda_on or lambda_code_on or code_repo_on):
                continue

            paginator = inspector.get_paginator("list_findings")
            for page in paginator.paginate(
                filterCriteria={
                    "findingStatus": [{"comparison": "EQUALS", "value": "ACTIVE"}],
                },
                maxResults=50,
            ):
                arns = page.get("findings") or []
                if not arns:
                    continue
                # Inspector accepts at most ten ARNs per detail request. Process
                # every ARN from every paginator page; truncating this inventory
                # would under-report findings and make coverage look healthier.
                for offset in range(0, len(arns), 10):
                    try:
                        detail = inspector.batch_get_finding_details(
                            findingArns=arns[offset : offset + 10]
                        )
                    except ClientError:
                        continue
                    for item in detail.get("findings") or []:
                        summary = item.get("findingSummary") or item
                        severity = str(summary.get("severity", "")).upper()
                        if severity not in _STORE_SEVERITIES:
                            continue
                        finding_arn = item.get("findingArn") or summary.get("findingArn")
                        if not finding_arn:
                            continue
                        title = summary.get("title")
                        resource_type = summary.get("resourceType")
                        resource_id = summary.get("resourceId")
                        fix_available = bool(summary.get("fixAvailable") == "YES")
                        stmt = pg_insert(InspectorFinding).values(
                            id=uuid.uuid5(uuid.NAMESPACE_URL, f"{account.id}:{finding_arn}"),
                            account_id=account.id,
                            region=region,
                            finding_arn=finding_arn,
                            resource_type=resource_type,
                            severity=severity,
                            title=title,
                            resource_id=resource_id,
                            fix_available=fix_available,
                            last_seen=_now(),
                        ).on_conflict_do_update(
                            index_elements=["account_id", "finding_arn"],
                            set_={
                                "resource_type": resource_type,
                                "severity": severity,
                                "title": title,
                                "resource_id": resource_id,
                                "fix_available": fix_available,
                                "last_seen": _now(),
                            },
                        )
                        db.execute(stmt)
                        finding_count += 1
                        severity_totals[severity] += 1
        except ClientError:
            continue

    log.info(
        "collect_inspector.done",
        account_id=str(account.id),
        regions=status_count,
        findings=finding_count,
        severities=dict(severity_totals),
    )
    return {"regions": status_count, "findings": finding_count, "severities": dict(severity_totals)}
