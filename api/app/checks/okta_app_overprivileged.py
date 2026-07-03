"""Okta API collector: over-privileged OAuth app grants."""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.checks._identity_helpers import _providers_of_type, _source_label

CHECK_ID = "okta.app.overprivileged_grant"


def run(db: Session, account_id) -> list[FindingDraft]:
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, "okta"):
        try:
            cfg = json.loads(provider.config_json_encrypted or "{}")
        except Exception:
            cfg = {}
        source = _source_label(provider)
        for grant in cfg.get("risky_app_grants") or []:
            app_name = grant.get("app_name") or grant.get("app_id") or "app"
            scopes = grant.get("scopes") or []
            out.append(
                FindingDraft(
                    check_id=CHECK_ID,
                    resource_arn=f"okta://{source}/app/{grant.get('app_id', app_name)}",
                    title=f"Okta app `{app_name}` has broad OAuth scopes",
                    severity="medium",
                    risk_score=score("medium"),
                    evidence={
                        "provider_type": "okta",
                        "app_name": app_name,
                        "scopes": scopes,
                    },
                )
            )
    return out
