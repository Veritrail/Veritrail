"""Phase 3 — SIEM / PagerDuty operational capability grading."""
from __future__ import annotations

from app.services.operational_capability import (
    grade_pagerduty_from_config,
    grade_siem_from_config,
)
from app.services.technical_capability import grade_from_enablement_and_activity


def test_siem_connected_without_signals_is_not_covered():
    rows = grade_siem_from_config(
        "splunk",
        {"index": "security", "signal_count": 0, "last_synced_at": "2026-07-19T00:00:00+00:00"},
    )
    detection = next(r for r in rows if r["capability"] == "threat_detection_signals")
    status = grade_from_enablement_and_activity(
        enabled=detection["enabled"],
        has_observable_activity=detection["has_observable_activity"],
        last_successful_scan_at=detection.get("last_successful_scan_at"),
        capability="cloud_findings_posture",
        eligible=detection["eligible"],
        assessed=detection["assessed"],
    )
    assert status in ("partial", "not_covered")
    assert "connected_without_security_signals" in detection["limitations"]


def test_datadog_base_presence_without_security_monitors():
    rows = grade_siem_from_config(
        "datadog",
        {"site": "datadoghq.com", "signal_count": 0, "security_rules_enabled": False},
    )
    detection = next(r for r in rows if r["capability"] == "threat_detection_signals")
    assert "base_datadog_without_cloud_siem_signals" in detection["limitations"]


def test_generic_splunk_logs_do_not_verify_threat_detection():
    rows = grade_siem_from_config(
        "splunk",
        {
            "index": "main",
            "logging_event_count": 5000,
            "signal_count": 5000,
            "security_signal_count": 0,
            "security_rules_enabled": False,
            "ingestion_fresh": True,
        },
    )
    logging = next(r for r in rows if r["capability"] == "logging_monitoring")
    detection = next(r for r in rows if r["capability"] == "threat_detection_signals")
    assert logging["has_observable_activity"] is True
    assert detection["enabled"] is False
    assert detection["has_observable_activity"] is False


def test_pagerduty_is_incident_ops_not_threat_detection():
    rows = grade_pagerduty_from_config(
        {
            "service_count": 3,
            "schedule_count": 1,
            "open_incident_count": 2,
            "last_synced_at": "2026-07-19T00:00:00+00:00",
        }
    )
    assert len(rows) == 1
    assert rows[0]["capability"] == "incident_operations"
    assert "not_threat_detection" in rows[0]["limitations"]
    assert rows[0]["enabled"] is True
    assert rows[0]["has_observable_activity"] is True


def test_pagerduty_connected_without_services_not_covered():
    rows = grade_pagerduty_from_config({"service_count": 0, "schedule_count": 0})
    assert rows[0]["enabled"] is False
    assert "no_services_or_schedules" in rows[0]["limitations"]
