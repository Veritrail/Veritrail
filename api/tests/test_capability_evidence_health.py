"""Phase B — capability evidence health derived from stored syncs."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.capability_evidence_health import github_evidence_health


def test_github_evidence_health_degraded_when_permission_denied_in_features():
    now = datetime(2026, 7, 20, 12, 0, tzinfo=timezone.utc)
    provider = SimpleNamespace(id=uuid.uuid4(), status="connected", type="github")
    repo = SimpleNamespace(
        security_features={
            "capability_evidence": {
                "dependency_scanning": {
                    "last_successful_scan_at": (now - timedelta(days=1)).isoformat(),
                    "limitations": ["permission_denied"],
                    "collection": {"collection_status": "permission_denied"},
                }
            }
        }
    )
    db = MagicMock()
    db.scalars.return_value.all.return_value = [repo]
    health = github_evidence_health(db, provider, now=now)
    assert health["connection_status"] == "connected"
    assert health["evidence_status"] == "degraded"
    assert health["needs_attention"] is True
    assert "permission_denied" in health["limitations"]


def test_github_evidence_health_stale_when_last_scan_old():
    now = datetime(2026, 7, 20, 12, 0, tzinfo=timezone.utc)
    provider = SimpleNamespace(id=uuid.uuid4(), status="connected", type="github")
    repo = SimpleNamespace(
        security_features={
            "capability_evidence": {
                "dependency_scanning": {
                    "last_successful_scan_at": (now - timedelta(days=40)).isoformat(),
                    "limitations": [],
                    "collection": {"collection_status": "complete"},
                }
            }
        }
    )
    db = MagicMock()
    db.scalars.return_value.all.return_value = [repo]
    health = github_evidence_health(db, provider, now=now)
    assert health["evidence_status"] == "stale"
    assert health["needs_attention"] is True
