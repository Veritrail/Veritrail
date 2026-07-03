"""Okta API collector: stale API service tokens."""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.checks._identity_helpers import _providers_of_type, _source_label

CHECK_ID = "okta.service.api_token_stale"


def run(db: Session, account_id) -> list[FindingDraft]:
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, "okta"):
        try:
            cfg = json.loads(provider.config_json_encrypted or "{}")
        except Exception:
            cfg = {}
        source = _source_label(provider)
        for token in cfg.get("stale_api_tokens") or []:
            name = token.get("name") or token.get("id") or "token"
            out.append(
                FindingDraft(
                    check_id=CHECK_ID,
                    resource_arn=f"okta://{source}/token/{token.get('id', name)}",
                    title=f"Okta API token `{name}` has not rotated in 90+ days",
                    severity="medium",
                    risk_score=score("medium"),
                    evidence={
                        "provider_type": "okta",
                        "token_name": name,
                        "last_updated": token.get("last_updated"),
                    },
                )
            )
    return out
