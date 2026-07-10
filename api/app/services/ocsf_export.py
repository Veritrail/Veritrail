"""Serialize Veritrail findings to OCSF-shaped JSON (Compliance Finding / Security Finding).

Maps lightly onto OCSF 1.1.0-ish field names without changing the internal data model.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable

# OCSF class / category constants (Findings category = 2)
_CATEGORY_UID = 2
_CATEGORY_NAME = "Findings"
_COMPLIANCE_CLASS_UID = 2003
_COMPLIANCE_CLASS_NAME = "Compliance Finding"
_SECURITY_CLASS_UID = 2001
_SECURITY_CLASS_NAME = "Security Finding"

_SEVERITY_ID = {
    "unknown": 0,
    "informational": 1,
    "low": 2,
    "medium": 3,
    "high": 4,
    "critical": 5,
    "fatal": 6,
    "other": 99,
}

_STATUS_ACTIVITY = {
    "open": (1, "Create"),
    "resolved": (3, "Close"),
    "ignored": (3, "Close"),
    "excepted": (3, "Close"),
    "snoozed": (2, "Update"),
}


def _epoch_ms(dt: datetime | None) -> int | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _severity_id(severity: str | None) -> int:
    return _SEVERITY_ID.get((severity or "unknown").lower(), 0)


def finding_to_ocsf(
    finding: Any,
    *,
    as_compliance: bool = True,
    account_label: str | None = None,
) -> dict[str, Any]:
    """Map one Finding ORM row (or duck-typed object) to an OCSF finding event."""
    status = getattr(finding, "status", None) or "open"
    activity_id, activity_name = _STATUS_ACTIVITY.get(status, (1, "Create"))
    class_uid = _COMPLIANCE_CLASS_UID if as_compliance else _SECURITY_CLASS_UID
    class_name = _COMPLIANCE_CLASS_NAME if as_compliance else _SECURITY_CLASS_NAME
    type_uid = class_uid * 100 + activity_id

    severity = getattr(finding, "severity", None) or "unknown"
    check_id = getattr(finding, "check_id", "") or ""
    title = getattr(finding, "title", "") or check_id
    resource_arn = getattr(finding, "resource_arn", "") or ""
    evidence = getattr(finding, "evidence", None) or {}
    finding_id = str(getattr(finding, "id", ""))

    first_seen = getattr(finding, "first_seen", None)
    last_seen = getattr(finding, "last_seen", None)
    time_ms = _epoch_ms(last_seen) or _epoch_ms(first_seen) or _epoch_ms(datetime.now(timezone.utc))

    event: dict[str, Any] = {
        "metadata": {
            "version": "1.1.0",
            "product": {
                "name": "Veritrail",
                "vendor_name": "Veritrail",
            },
            "logged_time": _epoch_ms(datetime.now(timezone.utc)),
        },
        "time": time_ms,
        "severity": severity.capitalize() if isinstance(severity, str) else "Unknown",
        "severity_id": _severity_id(severity),
        "status": status,
        "category_uid": _CATEGORY_UID,
        "category_name": _CATEGORY_NAME,
        "class_uid": class_uid,
        "class_name": class_name,
        "activity_id": activity_id,
        "activity_name": activity_name,
        "type_uid": type_uid,
        "type_name": f"{class_name}: {activity_name}",
        "finding_info": {
            "uid": finding_id,
            "title": title,
            "desc": title,
            "types": [check_id] if check_id else [],
            "first_seen_time": _epoch_ms(first_seen),
            "last_seen_time": _epoch_ms(last_seen),
            "data_sources": ["Veritrail"],
        },
        "resources": (
            [
                {
                    "uid": resource_arn,
                    "name": resource_arn.rsplit("/", 1)[-1] if resource_arn else None,
                    "type": "AWS Resource",
                }
            ]
            if resource_arn
            else []
        ),
        "unmapped": {
            "check_id": check_id,
            "risk_score": getattr(finding, "risk_score", None),
            "account_label": account_label,
            "evidence": evidence if isinstance(evidence, dict) else {},
        },
    }

    if as_compliance:
        event["compliance"] = {
            "status": "Fail" if status == "open" else "Pass",
            "requirements": [check_id] if check_id else [],
            "control": check_id,
            "standards": [],
            "desc": title,
        }
    else:
        event["finding_info"]["analytic"] = {"name": check_id, "type": "Rule", "uid": check_id}

    return event


def findings_to_ocsf_bundle(
    findings: Iterable[Any],
    *,
    as_compliance: bool = True,
    account_labels: dict[Any, str] | None = None,
) -> dict[str, Any]:
    """Wrap findings as an OCSF export document."""
    labels = account_labels or {}
    events = [
        finding_to_ocsf(
            f,
            as_compliance=as_compliance,
            account_label=labels.get(getattr(f, "account_id", None)),
        )
        for f in findings
    ]
    return {
        "ocsf_version": "1.1.0",
        "export_format": "compliance_finding" if as_compliance else "security_finding",
        "count": len(events),
        "events": events,
    }
