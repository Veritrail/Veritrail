"""Admin audit log: real-DB integration tests via the transactional db_session."""
import uuid
from datetime import datetime, timedelta, timezone

from app.models import User
from app.models.org import Org
from app.models.org_team import OrgActivityLog
from app.services.org_activity import (
    list_org_activity,
    log_org_activity,
    log_org_activity_for_actor,
)


def _org_and_admin(db_session):
    org = Org(id=uuid.uuid4(), name="Acme", slug=f"acme-{uuid.uuid4().hex[:8]}")
    user = User(
        id=uuid.uuid4(),
        org_id=org.id,
        email=f"admin-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        role="admin",
    )
    db_session.add_all([org, user])
    db_session.flush()
    return org, user


def test_log_and_list_roundtrip(db_session):
    org, user = _org_and_admin(db_session)
    log_org_activity_for_actor(
        db_session,
        actor=user,
        action="account.created",
        target_type="aws_account",
        target_id="acc-1",
        target_label="Prod",
    )
    db_session.flush()

    rows = list_org_activity(db_session, org.id)
    assert len(rows) == 1
    row = rows[0]
    assert row["action"] == "account.created"
    assert row["actor_email"] == user.email
    assert row["target_type"] == "aws_account"
    assert row["target_label"] == "Prod"
    # actor_email / target_label are lifted out of detail in the reader.
    assert "actor_email" not in row["detail"]


def test_list_is_org_scoped(db_session):
    org, user = _org_and_admin(db_session)
    _, other_user = _org_and_admin(db_session)

    for action in ("account.created", "org.settings_updated", "account.removed"):
        log_org_activity_for_actor(db_session, actor=user, action=action)
    log_org_activity_for_actor(db_session, actor=other_user, action="account.created")
    db_session.flush()

    rows = list_org_activity(db_session, org.id)
    assert len(rows) == 3  # the other org's event is excluded
    assert {r["action"] for r in rows} == {
        "account.created",
        "org.settings_updated",
        "account.removed",
    }


def test_list_orders_newest_first(db_session):
    """Across requests, distinct created_at timestamps order newest-first."""
    org, user = _org_and_admin(db_session)
    base = datetime.now(timezone.utc) - timedelta(hours=1)
    for i, action in enumerate(["oldest", "middle", "newest"]):
        db_session.add(
            OrgActivityLog(
                id=uuid.uuid4(),
                org_id=org.id,
                actor_user_id=user.id,
                action=action,
                detail={},
                created_at=base + timedelta(minutes=i),
            )
        )
    db_session.flush()

    rows = list_org_activity(db_session, org.id)
    assert [r["action"] for r in rows] == ["newest", "middle", "oldest"]


def test_actor_email_survives_user_deletion(db_session):
    """FK is SET NULL on user delete; denormalized email keeps the row readable."""
    org, user = _org_and_admin(db_session)
    email = user.email
    log_org_activity_for_actor(db_session, actor=user, action="member.invited")
    db_session.flush()

    db_session.delete(user)
    db_session.flush()

    rows = list_org_activity(db_session, org.id)
    assert len(rows) == 1
    assert rows[0]["actor_email"] == email  # from detail fallback, not the (now null) FK


def test_log_org_activity_returns_entry_without_actor(db_session):
    org, _ = _org_and_admin(db_session)
    entry = log_org_activity(
        db_session,
        org_id=org.id,
        actor_user_id=None,
        action="system.event",
    )
    db_session.flush()
    assert entry.id is not None
    rows = list_org_activity(db_session, org.id)
    assert rows[0]["actor_email"] is None
