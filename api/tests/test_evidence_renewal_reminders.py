import uuid
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

from app.models.evidence_artifact import EvidenceArtifact
from app.models.org import Org
from app.services.evidence_renewal_reminders import (
    collect_renewal_items,
    notify_org_evidence_renewals,
)


def test_collect_renewal_items_includes_expiring_and_stale():
    org_id = uuid.uuid4()
    today = date.today()
    rows = [
        EvidenceArtifact(
            id=uuid.uuid4(),
            org_id=org_id,
            framework="soc2",
            title="soon",
            status="accepted",
            expires_at=today + timedelta(days=10),
            size_bytes=0,
        ),
        EvidenceArtifact(
            id=uuid.uuid4(),
            org_id=org_id,
            framework="soc2",
            title="fresh",
            status="accepted",
            expires_at=today + timedelta(days=120),
            size_bytes=0,
        ),
        EvidenceArtifact(
            id=uuid.uuid4(),
            org_id=org_id,
            framework="soc2",
            title="stale",
            status="submitted",
            period_end=today - timedelta(days=3),
            size_bytes=0,
        ),
    ]
    db = MagicMock()
    db.scalars.return_value.all.return_value = rows
    items = collect_renewal_items(db, org_id=org_id)
    titles = {item["title"] for item in items}
    assert titles == {"soon", "stale"}


def test_notify_org_skips_when_disabled():
    org_id = uuid.uuid4()
    org = Org(id=org_id, name="Acme", settings={"notifications": {"evidence_renewal_email_enabled": False}})
    db = MagicMock()
    db.get.return_value = org
    assert notify_org_evidence_renewals(db, org_id) is False


def test_notify_org_sends_when_items_exist():
    org_id = uuid.uuid4()
    org = Org(id=org_id, name="Acme", settings={})
    db = MagicMock()
    db.get.return_value = org
    with patch(
        "app.services.evidence_renewal_reminders.collect_renewal_items",
        return_value=[{"title": "x", "reason": "expiring"}],
    ), patch(
        "app.services.evidence_renewal_reminders.renewal_recipient_emails",
        return_value=["admin@example.com"],
    ), patch(
        "app.services.evidence_renewal_reminders.send_evidence_renewal_email",
        return_value=True,
    ) as send:
        assert notify_org_evidence_renewals(db, org_id) is True
        send.assert_called_once()
