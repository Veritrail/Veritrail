import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from app.services.access_review_summary import build_access_review_summary


def test_access_review_summary_counts(mock_db):
    org_id = uuid.uuid4()
    provider = MagicMock()
    provider.id = uuid.uuid4()
    provider.type = "entra_id"
    provider.status = "connected"
    provider.last_synced_at = datetime.now(timezone.utc)

    stale = datetime.now(timezone.utc) - timedelta(days=120)
    user1 = MagicMock()
    user1.status = "active"
    user1.mfa_enabled = False
    user1.last_active_at = stale
    user2 = MagicMock()
    user2.status = "active"
    user2.mfa_enabled = True
    user2.last_active_at = datetime.now(timezone.utc)

    finding = MagicMock()
    finding.check_id = "entra.admin.unreviewed"
    finding.title = "Admin unreviewed"
    finding.resource_arn = "entra://tenant/admin"
    finding.severity = "high"

    providers_result = MagicMock()
    providers_result.all.return_value = [provider]
    users_result = MagicMock()
    users_result.all.return_value = [user1, user2]
    admin_result = MagicMock()
    admin_result.all.return_value = [finding]
    mock_db.scalars.side_effect = [providers_result, users_result, admin_result]
    mock_db.scalar.return_value = 3

    summary = build_access_review_summary(mock_db, org_id)
    assert summary["users_total"] == 2
    assert summary["users_dormant_or_inactive"] == 1
    assert summary["users_without_mfa"] == 1
    assert summary["admin_unreviewed_count"] == 1
    assert summary["open_identity_findings"] == 3
