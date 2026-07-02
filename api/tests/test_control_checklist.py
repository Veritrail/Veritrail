"""Control checklist (auto + manual attestation) + readiness %."""
import uuid

import pytest
from fastapi import HTTPException

from app.models.org import Org, User
from app.routes.controls import AttestationIn, control_checklist, put_attestation


def _seed_org_user(db, role="admin"):
    org = Org(name="Test Co")
    db.add(org)
    db.flush()
    user = User(org_id=org.id, email=f"u{uuid.uuid4().hex[:8]}@example.com", password_hash="x", role=role)
    db.add(user)
    db.flush()
    return org, user


def _principal(org, user):
    return {"org_id": str(org.id), "sub": str(user.id)}


def test_checklist_returns_auto_and_manual(db_session):
    org, user = _seed_org_user(db_session)
    out = control_checklist(framework="soc2", account_id=None, p=_principal(org, user), db=db_session)
    kinds = {c.kind for c in out.controls}
    assert "auto" in kinds and "manual" in kinds
    # Catalog: 9 automated + 24 manual SOC 2 controls.
    assert out.summary.total >= 33
    manual = [c for c in out.controls if c.kind == "manual"]
    assert manual and all(c.status == "pending" for c in manual)
    # No connected account → auto controls are no_data, no manual met → 0%.
    assert out.summary.met == 0
    assert out.summary.percent == 0
    # Every control carries its SOC 2 family group (CC* or availability A1*).
    assert all(c.group.startswith(("CC", "A1")) for c in out.controls)


def test_attestation_sets_status_and_bumps_readiness(db_session):
    db_session.commit = db_session.flush  # keep the rollback fixture clean
    org, user = _seed_org_user(db_session, role="admin")
    p = _principal(org, user)
    before = control_checklist(framework="soc2", account_id=None, p=p, db=db_session)
    manual = next(c for c in before.controls if c.kind == "manual")

    res = put_attestation(control_id=manual.id, body=AttestationIn(status="met", owner="Sec", note="done"), p=p, db=db_session)
    assert res["status"] == "met"

    after = control_checklist(framework="soc2", account_id=None, p=p, db=db_session)
    assert after.summary.met == before.summary.met + 1
    updated = next(c for c in after.controls if c.id == manual.id)
    assert updated.status == "met"
    assert updated.owner == "Sec"
    assert updated.note == "done"
    assert updated.reviewed_at is not None


def test_attestation_upsert_overwrites(db_session):
    db_session.commit = db_session.flush
    org, user = _seed_org_user(db_session, role="owner")
    p = _principal(org, user)
    manual = next(c for c in control_checklist(framework="soc2", account_id=None, p=p, db=db_session).controls if c.kind == "manual")
    put_attestation(control_id=manual.id, body=AttestationIn(status="met"), p=p, db=db_session)
    put_attestation(control_id=manual.id, body=AttestationIn(status="not_met"), p=p, db=db_session)
    updated = next(c for c in control_checklist(framework="soc2", account_id=None, p=p, db=db_session).controls if c.id == manual.id)
    assert updated.status == "not_met"


def test_not_applicable_excluded_from_denominator(db_session):
    db_session.commit = db_session.flush
    org, user = _seed_org_user(db_session, role="admin")
    p = _principal(org, user)
    before = control_checklist(framework="soc2", account_id=None, p=p, db=db_session)
    manual = next(c for c in before.controls if c.kind == "manual")
    put_attestation(control_id=manual.id, body=AttestationIn(status="not_applicable"), p=p, db=db_session)
    after = control_checklist(framework="soc2", account_id=None, p=p, db=db_session)
    assert after.summary.not_applicable == before.summary.not_applicable + 1
    assert after.summary.total == before.summary.total  # NA stays in the list, not the denominator


def test_attestation_requires_admin(db_session):
    org, user = _seed_org_user(db_session, role="viewer")
    p = _principal(org, user)
    manual = next(c for c in control_checklist(framework="soc2", account_id=None, p=p, db=db_session).controls if c.kind == "manual")
    with pytest.raises(HTTPException) as ei:
        put_attestation(control_id=manual.id, body=AttestationIn(status="met"), p=p, db=db_session)
    assert ei.value.status_code == 403


def test_attestation_rejected_on_automated_control(db_session):
    org, user = _seed_org_user(db_session, role="admin")
    p = _principal(org, user)
    auto = next(c for c in control_checklist(framework="soc2", account_id=None, p=p, db=db_session).controls if c.kind == "auto")
    with pytest.raises(HTTPException) as ei:
        put_attestation(control_id=auto.id, body=AttestationIn(status="met"), p=p, db=db_session)
    assert ei.value.status_code == 400


def test_bad_status_rejected(db_session):
    org, user = _seed_org_user(db_session, role="admin")
    p = _principal(org, user)
    manual = next(c for c in control_checklist(framework="soc2", account_id=None, p=p, db=db_session).controls if c.kind == "manual")
    with pytest.raises(HTTPException) as ei:
        put_attestation(control_id=manual.id, body=AttestationIn(status="bogus"), p=p, db=db_session)
    assert ei.value.status_code == 400
