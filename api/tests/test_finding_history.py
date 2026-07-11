"""Tests for point-in-time finding state reconstruction."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from app.services.check_evidence import CLASS_ACTIVITY, CLASS_BENCHMARK, CLASS_SUPPORTING
from app.services.finding_history import (
    finding_open_for_control,
    findings_for_pack_at,
    finding_state_at,
)
from app.services.check_evidence import evidence_class_for_check


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s)


def _finding(*, first_seen: str, resolved_at: str | None = None, status: str = "open"):
    f = MagicMock()
    f.id = uuid.uuid4()
    f.check_id = "iam.user.no_mfa"
    f.first_seen = _ts(first_seen)
    f.resolved_at = _ts(resolved_at) if resolved_at else None
    f.status = status
    return f


def _event(action: str, ts: str):
    e = MagicMock()
    e.ts = _ts(ts)
    e.action = action
    return e


def test_not_yet_open_before_first_seen():
    f = _finding(first_seen="2026-03-01T00:00:00+00:00")
    assert finding_state_at(f, _ts("2026-02-01T00:00:00+00:00"), []) == "not_yet_open"


def test_resolved_at_as_of():
    f = _finding(first_seen="2026-01-01T00:00:00+00:00", resolved_at="2026-02-01T00:00:00+00:00")
    assert finding_state_at(f, _ts("2026-03-01T00:00:00+00:00"), []) == "resolved"


def test_excepted_from_events():
    f = _finding(first_seen="2026-01-01T00:00:00+00:00")
    events = [_event("opened", "2026-01-01T00:00:00+00:00"), _event("excepted", "2026-01-15T00:00:00+00:00")]
    assert finding_state_at(f, _ts("2026-02-01T00:00:00+00:00"), events) == "excepted"


def test_supporting_check_does_not_fail_control():
    f = MagicMock()
    f.check_id = "guardduty.detector.not_enabled"
    assert evidence_class_for_check(f.check_id) == CLASS_SUPPORTING
    assert finding_open_for_control(f, "open") is False


def test_benchmark_check_fails_control():
    f = MagicMock()
    f.check_id = "iam.user.no_mfa"
    assert evidence_class_for_check(f.check_id) == CLASS_BENCHMARK
    assert finding_open_for_control(f, "open") is True


def test_wildcard_resource_is_supporting_only():
    assert evidence_class_for_check("iam.policy.wildcard_resource") == CLASS_SUPPORTING


def test_activity_check_does_not_fail_control():
    f = MagicMock()
    f.check_id = "cloudtrail.event.root_activity"
    assert evidence_class_for_check(f.check_id) == CLASS_ACTIVITY
    assert finding_open_for_control(f, "open") is False


def test_info_mfa_delete_open_does_not_fail_control():
    f = MagicMock()
    f.check_id = "s3.bucket.no_mfa_delete"
    assert evidence_class_for_check(f.check_id) == CLASS_SUPPORTING
    assert finding_open_for_control(f, "open") is False


def test_pack_findings_include_only_the_accounts_workspace(db_session):
    from app.models import AwsAccount, Finding, Org

    org = Org(name="Pack Scope One")
    other_org = Org(name="Pack Scope Two")
    db_session.add_all([org, other_org])
    db_session.flush()
    account = AwsAccount(
        org_id=org.id,
        label="Primary",
        account_id="111111111111",
        external_id="scope-one",
        status="connected",
    )
    other_account = AwsAccount(
        org_id=other_org.id,
        label="Other",
        account_id="222222222222",
        external_id="scope-two",
        status="connected",
    )
    db_session.add_all([account, other_account])
    db_session.flush()

    now = datetime.now(timezone.utc)

    def add_finding(*, finding_org_id, finding_account_id, check_id, resource):
        finding = Finding(
            org_id=finding_org_id,
            account_id=finding_account_id,
            check_id=check_id,
            resource_arn=resource,
            title="Open audit finding",
            severity="high",
            risk_score=80,
            evidence={},
            status="open",
            first_seen=now,
            last_seen=now,
        )
        db_session.add(finding)
        return finding

    account_finding = add_finding(
        finding_org_id=org.id,
        finding_account_id=account.id,
        check_id="iam.user.no_mfa",
        resource="arn:aws:iam::111111111111:user/alice",
    )
    org_source_finding = add_finding(
        finding_org_id=org.id,
        finding_account_id=None,
        check_id="github.repo.no_branch_protection",
        resource="github://one/repo",
    )
    other_org_source_finding = add_finding(
        finding_org_id=other_org.id,
        finding_account_id=None,
        check_id="github.repo.no_branch_protection",
        resource="github://two/repo",
    )
    db_session.flush()

    rows = findings_for_pack_at(db_session, account.id, now + timedelta(seconds=1))
    ids = {finding.id for finding, _state in rows}
    assert account_finding.id in ids
    assert org_source_finding.id in ids
    assert other_org_source_finding.id not in ids
