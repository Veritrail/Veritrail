"""Org-level scan run counts for Accounts page metrics."""
import uuid

from app.routes.accounts_scan import scan_stats


def test_scan_stats_sums_runs_in_each_window(mock_db):
    org_id = uuid.uuid4()
    acc_id = uuid.uuid4()
    mock_db.scalars.return_value.all.return_value = [acc_id]

    counts = iter([12, 8])
    mock_db.scalar.side_effect = lambda _stmt: next(counts)

    principal = {"org_id": str(org_id)}
    out = scan_stats(p=principal, db=mock_db)

    assert out.scans_last_7_days == 12
    assert out.scans_prev_7_days == 8
    assert mock_db.scalar.call_count == 2


def test_scan_stats_zero_when_no_accounts(mock_db):
    mock_db.scalars.return_value.all.return_value = []
    out = scan_stats(p={"org_id": str(uuid.uuid4())}, db=mock_db)
    assert out.scans_last_7_days == 0
    assert out.scans_prev_7_days == 0
    mock_db.scalar.assert_not_called()
