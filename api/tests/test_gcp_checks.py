"""GCP check module tests."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock

from app.checks.gcp_logging_not_enabled import CHECK_ID as LOG_CHECK
from app.checks.gcp_logging_not_enabled import run as run_logging_check


def test_gcp_logging_not_enabled_when_audit_missing():
    db = MagicMock()
    project_id = uuid.uuid4()
    project = MagicMock()
    project.project_id = "demo-project"
    db.get.return_value = project
    db.scalar.return_value = None

    drafts = run_logging_check(db, project_id)
    assert len(drafts) == 1
    assert drafts[0].check_id == LOG_CHECK
