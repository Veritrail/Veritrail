"""Immutable evidence vault (S3 Object Lock)."""
from __future__ import annotations

import base64
import json
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any

import boto3
import structlog
from botocore.exceptions import ClientError

from app.core.config import get_settings

log = structlog.get_logger()
_S3_URI_RE = re.compile(r"^s3://([^/]+)/?(.*)$")


class AuditorAccessMode(str, Enum):
    NONE = "none"
    PRESIGNED = "presigned"
    APPROVED_LINK = "approved_link"


class VaultWriteMode(str, Enum):
    GOVERNANCE = "GOVERNANCE"
    COMPLIANCE = "COMPLIANCE"


@dataclass(frozen=True)
class VaultLocation:
    bucket: str
    prefix: str
    region: str | None = None

    @property
    def base_uri(self) -> str:
        p = self.prefix.rstrip("/")
        return f"s3://{self.bucket}/{p}" if p else f"s3://{self.bucket}"


@dataclass(frozen=True)
class VaultUploadPlan:
    org_id: uuid.UUID
    account_id: uuid.UUID
    report_id: str
    framework: str
    object_key: str
    s3_uri: str
    content_sha256: str | None
    retention_days: int
    object_lock_mode: VaultWriteMode
    generated_at: str
    aws_account_id: str | None = None

    def to_manifest(self) -> dict[str, Any]:
        return {
            "status": "planned",
            "s3_uri": self.s3_uri,
            "object_key": self.object_key,
            "report_id": self.report_id,
            "retention_days": self.retention_days,
            "object_lock_mode": self.object_lock_mode.value,
            "generated_at": self.generated_at,
            "aws_account_id": self.aws_account_id,
        }


@dataclass(frozen=True)
class AuditorAccessPlan:
    report_id: str
    s3_uri: str
    mode: AuditorAccessMode
    expires_at: str | None
    presigned_url: str | None = None

    def to_manifest(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "status": "active" if self.presigned_url else "planned",
            "mode": self.mode.value,
            "s3_uri": self.s3_uri,
            "report_id": self.report_id,
            "expires_at": self.expires_at,
        }
        if self.presigned_url:
            out["presigned_get_url"] = self.presigned_url
        return out


def parse_s3_uri(uri: str) -> VaultLocation:
    uri = (uri or "").strip()
    match = _S3_URI_RE.match(uri)
    if not match:
        raise ValueError(f"EVIDENCE_VAULT_S3_URI must be s3://bucket/prefix, got: {uri!r}")
    bucket, prefix = match.group(1), match.group(2)
    if not bucket:
        raise ValueError("S3 bucket name is required")
    return VaultLocation(bucket=bucket, prefix=prefix.strip("/"))


def vault_config() -> dict[str, Any]:
    s = get_settings()
    loc: VaultLocation | None = None
    if s.EVIDENCE_VAULT_S3_URI.strip():
        loc = parse_s3_uri(s.EVIDENCE_VAULT_S3_URI)
        if s.EVIDENCE_VAULT_S3_REGION.strip():
            loc = VaultLocation(bucket=loc.bucket, prefix=loc.prefix, region=s.EVIDENCE_VAULT_S3_REGION.strip())
    mode = VaultWriteMode.GOVERNANCE
    raw_mode = (s.EVIDENCE_VAULT_OBJECT_LOCK_MODE or "GOVERNANCE").upper()
    if raw_mode == VaultWriteMode.COMPLIANCE.value:
        mode = VaultWriteMode.COMPLIANCE
    auditor = AuditorAccessMode.NONE
    raw_auditor = (s.EVIDENCE_VAULT_AUDITOR_ACCESS_MODE or "none").lower()
    try:
        auditor = AuditorAccessMode(raw_auditor)
    except ValueError:
        auditor = AuditorAccessMode.NONE
    return {
        "enabled": bool(s.EVIDENCE_VAULT_ENABLED) and loc is not None,
        "location": loc,
        "retention_days": s.EVIDENCE_VAULT_RETENTION_DAYS,
        "object_lock_mode": mode,
        "auditor_access_mode": auditor,
    }


def vault_enabled() -> bool:
    return vault_config()["enabled"]


def object_key_for_pack(
    *,
    prefix: str,
    app_env: str,
    aws_account_id: str | None,
    report_id: str,
    generated_at: datetime,
) -> str:
    """Layout: {prefix}/{env}/{aws_account_id}/{YYYY-MM-DD}/{report_id}.zip"""
    date_part = generated_at.strftime("%Y-%m-%d")
    acct = (aws_account_id or "unknown").replace(":", "-")
    env = (app_env or "dev").strip().lower()
    base = prefix.rstrip("/")
    parts = [base, env, acct, date_part, f"{report_id}.zip"]
    return "/".join(p for p in parts if p)


def plan_vault_upload(
    *,
    org_id: uuid.UUID,
    account_id: uuid.UUID,
    report_id: str,
    framework: str,
    content_sha256: str | None = None,
    generated_at: datetime | None = None,
    customer_s3_uri: str | None = None,
    aws_account_id: str | None = None,
) -> VaultUploadPlan | None:
    cfg = vault_config()
    loc: VaultLocation | None = cfg["location"]
    if customer_s3_uri:
        loc = parse_s3_uri(customer_s3_uri)
    if not loc:
        return None
    if not cfg["enabled"] and not customer_s3_uri:
        return None

    ts = generated_at or datetime.now(timezone.utc)
    key = object_key_for_pack(
        prefix=loc.prefix,
        app_env=get_settings().APP_ENV,
        aws_account_id=aws_account_id,
        report_id=report_id,
        generated_at=ts,
    )
    return VaultUploadPlan(
        org_id=org_id,
        account_id=account_id,
        report_id=report_id,
        framework=framework,
        object_key=key,
        s3_uri=f"s3://{loc.bucket}/{key}",
        content_sha256=content_sha256,
        retention_days=int(cfg["retention_days"]),
        object_lock_mode=cfg["object_lock_mode"],
        generated_at=ts.isoformat(),
        aws_account_id=aws_account_id,
    )


def plan_auditor_access(
    upload: VaultUploadPlan,
    *,
    approved_by: str | None = None,
    ttl_hours: int = 168,
) -> AuditorAccessPlan | None:
    cfg = vault_config()
    mode: AuditorAccessMode = cfg["auditor_access_mode"]
    if mode == AuditorAccessMode.NONE:
        return None
    expires = datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
    presigned: str | None = None
    if mode == AuditorAccessMode.PRESIGNED:
        presigned = generate_presigned_get(upload, ttl_seconds=ttl_hours * 3600)
    return AuditorAccessPlan(
        report_id=upload.report_id,
        s3_uri=upload.s3_uri,
        mode=mode,
        expires_at=expires.isoformat(),
        presigned_url=presigned,
    )


def _s3_client(loc: VaultLocation):
    region = loc.region or get_settings().EVIDENCE_VAULT_S3_REGION or "us-east-1"
    return boto3.client("s3", region_name=region)


def upload_pack_to_vault(plan: VaultUploadPlan, zip_bytes: bytes) -> dict[str, Any]:
    """Write immutable ZIP to S3 with Object Lock retention."""
    cfg = vault_config()
    loc: VaultLocation | None = cfg["location"]
    if not loc:
        raise ValueError("Evidence vault location not configured")
    client = _s3_client(loc)
    retain_until = datetime.now(timezone.utc) + timedelta(days=plan.retention_days)
    extra: dict[str, Any] = {
        "Bucket": loc.bucket,
        "Key": plan.object_key,
        "Body": zip_bytes,
        "ContentType": "application/zip",
        "ObjectLockMode": plan.object_lock_mode.value,
        "ObjectLockRetainUntilDate": retain_until,
    }
    if plan.content_sha256:
        extra["ChecksumSHA256"] = base64.b64encode(bytes.fromhex(plan.content_sha256)).decode()
    try:
        resp = client.put_object(**extra)
    except ClientError as e:
        log.exception("vault.upload_failed", object_key=plan.object_key)
        return {
            "status": "error",
            "s3_uri": plan.s3_uri,
            "error_code": e.response.get("Error", {}).get("Code"),
            "error_message": e.response.get("Error", {}).get("Message"),
        }
    log.info("vault.upload_ok", s3_uri=plan.s3_uri, version_id=resp.get("VersionId"))
    return {
        "status": "uploaded",
        "s3_uri": plan.s3_uri,
        "object_key": plan.object_key,
        "version_id": resp.get("VersionId"),
        "etag": resp.get("ETag"),
        "retention_until": retain_until.isoformat(),
        "object_lock_mode": plan.object_lock_mode.value,
        "bytes": len(zip_bytes),
    }


def generate_presigned_get(plan: VaultUploadPlan, *, ttl_seconds: int = 3600) -> str | None:
    cfg = vault_config()
    loc: VaultLocation | None = cfg["location"]
    if not loc:
        return None
    client = _s3_client(loc)
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": loc.bucket, "Key": plan.object_key},
            ExpiresIn=ttl_seconds,
        )
    except ClientError:
        log.exception("vault.presign_failed", key=plan.object_key)
        return None


def plan_from_stored_s3_uri(
    *,
    org_id: uuid.UUID,
    account_id: uuid.UUID,
    report_id: str,
    framework: str,
    vault_s3_uri: str,
    content_sha256: str | None = None,
) -> VaultUploadPlan | None:
    """Rebuild a vault plan from a persisted export row for presigned auditor access."""
    uri = (vault_s3_uri or "").strip()
    if not uri.startswith("s3://"):
        return None
    match = _S3_URI_RE.match(uri)
    if not match:
        return None
    bucket, key = match.group(1), match.group(2)
    if not bucket or not key:
        return None
    cfg = vault_config()
    mode = cfg["object_lock_mode"]
    return VaultUploadPlan(
        org_id=org_id,
        account_id=account_id,
        report_id=report_id or "unknown",
        framework=framework,
        object_key=key,
        s3_uri=uri,
        content_sha256=content_sha256,
        retention_days=int(cfg["retention_days"]),
        object_lock_mode=mode,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


def org_vault_override(org_settings: dict | None) -> str | None:
    if not org_settings:
        return None
    block = org_settings.get("evidence_vault") or {}
    uri = (block.get("customer_s3_uri") or "").strip()
    return uri or None
