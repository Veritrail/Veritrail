"""Reconstruct finding status at a point in time for exports and control scoring."""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Finding, FindingEvent
from app.services.check_evidence import CLASS_BENCHMARK, evidence_class_for_check

STATE_OPEN = "open"
STATE_EXCEPTED = "excepted"
STATE_RESOLVED = "resolved"
STATE_SNOOZED = "snoozed"
STATE_IGNORED = "ignored"
STATE_NOT_YET = "not_yet_open"


def load_events_by_finding(
    db: Session,
    finding_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[FindingEvent]]:
    if not finding_ids:
        return {}
    events = db.scalars(
        select(FindingEvent)
        .where(FindingEvent.finding_id.in_(finding_ids))
        .order_by(FindingEvent.ts.asc())
    ).all()
    out: dict[uuid.UUID, list[FindingEvent]] = defaultdict(list)
    for evt in events:
        out[evt.finding_id].append(evt)
    return out


def finding_state_at(
    finding: Finding,
    as_of: datetime,
    events: list[FindingEvent] | None = None,
) -> str:
    """Return effective finding status at ``as_of`` (UTC-aware)."""
    if finding.first_seen > as_of:
        return STATE_NOT_YET
    if finding.resolved_at and finding.resolved_at <= as_of:
        return STATE_RESOLVED

    events = events or []
    if not events:
        # No event log — row status is authoritative when first_seen <= as_of.
        if finding.status in (STATE_EXCEPTED, STATE_SNOOZED, STATE_IGNORED):
            return finding.status
        return STATE_OPEN if finding.status == STATE_OPEN else finding.status

    state = STATE_OPEN
    for evt in sorted(events, key=lambda e: e.ts):
        if evt.ts > as_of:
            break
        if evt.action == "excepted":
            state = STATE_EXCEPTED
        elif evt.action == "resolved":
            state = STATE_RESOLVED
        elif evt.action in {"reopened", "opened", "recheck_opened"}:
            state = STATE_OPEN
        elif evt.action == "ignored":
            state = STATE_IGNORED
        elif evt.action == "snoozed":
            state = STATE_SNOOZED
    return state


def finding_open_for_control(finding: Finding, state: str) -> bool:
    """Whether an open finding should fail a mapped control (benchmark checks only)."""
    if state != STATE_OPEN:
        return False
    return evidence_class_for_check(finding.check_id) == CLASS_BENCHMARK


def findings_for_pack_at(
    db: Session,
    account_id: uuid.UUID,
    as_of: datetime,
    *,
    hidden_check_ids: set[str] | None = None,
) -> list[tuple[Finding, str]]:
    """Findings to include in an evidence pack as of ``as_of`` (open + excepted)."""
    hidden = set(hidden_check_ids or set())
    from app.services.source_control_scan import with_source_control_for_audit
    from app.services.scanning_attestation import (
        ATTESTABLE_SCANNING_CHECKS,
        is_scanning_attested,
    )
    from app.models import AwsAccount, Org

    # When the org attests external scanning, the scanning-family findings are
    # covered — exclude them from the pack so the audit deliverable matches the
    # control status (which suppresses them). Intrinsic controls are unaffected.
    acc = db.get(AwsAccount, account_id)
    org = db.get(Org, acc.org_id) if acc else None
    if org and is_scanning_attested(org.settings):
        hidden |= ATTESTABLE_SCANNING_CHECKS

    # Org-level source-control findings (Secure SDLC) belong in the evidence
    # pack alongside the account's cloud findings, or the audit PDF would show
    # SDLC passing while the live control fails.
    rows = db.scalars(
        select(Finding).where(with_source_control_for_audit(Finding.account_id == account_id))
    ).all()
    events_map = load_events_by_finding(db, [f.id for f in rows])
    out: list[tuple[Finding, str]] = []
    for f in rows:
        if f.check_id in hidden:
            continue
        state = finding_state_at(f, as_of, events_map.get(f.id))
        if state in (STATE_OPEN, STATE_EXCEPTED):
            out.append((f, state))
    return out
