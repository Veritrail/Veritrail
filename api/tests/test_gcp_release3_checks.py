"""GCP Release 3 check module tests."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock

from app.checks.gcp_asset_public_iam_binding import CHECK_ID as ASSET_CHECK
from app.checks.gcp_asset_public_iam_binding import run as run_asset_check
from app.checks.gcp_osconfig_vuln_report_present import CHECK_ID as OSCONFIG_CHECK
from app.checks.gcp_osconfig_vuln_report_present import run as run_osconfig_check
from app.checks.gcp_scc_not_enabled import CHECK_ID as SCC_CHECK
from app.checks.gcp_scc_not_enabled import run as run_scc_check


def test_gcp_osconfig_vuln_report_present_when_no_reports():
    db = MagicMock()
    project_id = uuid.uuid4()
    project = MagicMock()
    project.project_id = "demo-project"
    db.get.return_value = project
    row = MagicMock()
    row.api_accessible = True
    row.has_reports = False
    row.report_count = 0
    db.scalar.return_value = row

    drafts = run_osconfig_check(db, project_id)
    assert len(drafts) == 1
    assert drafts[0].check_id == OSCONFIG_CHECK


def test_gcp_scc_not_enabled_when_inaccessible():
    db = MagicMock()
    project_id = uuid.uuid4()
    project = MagicMock()
    project.project_id = "demo-project"
    db.get.return_value = project
    row = MagicMock()
    row.scc_enabled = False
    row.active_finding_count = 0
    db.scalar.return_value = row

    drafts = run_scc_check(db, project_id)
    assert len(drafts) == 1
    assert drafts[0].check_id == SCC_CHECK


def test_gcp_asset_public_iam_binding_per_asset():
    db = MagicMock()
    project_id = uuid.uuid4()
    project = MagicMock()
    project.project_id = "demo-project"
    db.get.return_value = project
    asset = MagicMock()
    asset.asset_name = "//storage.googleapis.com/demo-bucket"
    asset.asset_type = "storage.googleapis.com/Bucket"
    asset.has_public_iam = True
    db.scalars.return_value.all.return_value = [asset]

    drafts = run_asset_check(db, project_id)
    assert len(drafts) == 1
    assert drafts[0].check_id == ASSET_CHECK
