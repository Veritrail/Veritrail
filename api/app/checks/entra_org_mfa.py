from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.checks._identity_helpers import _providers_of_type, _source_label

CHECK_ID = "entra.org.mfa_not_enforced"


def run(db: Session, account_id) -> list[FindingDraft]:
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, "entra_id"):
        try:
            cfg = json.loads(provider.config_json_encrypted or "{}")
        except Exception:
            cfg = {}
        source = _source_label(provider)
        if cfg.get("security_defaults_enabled"):
            continue
        out.append(
            FindingDraft(
                check_id=CHECK_ID,
                resource_arn=f"entra_id://{source}/org",
                title=f"Microsoft Entra tenant `{source}` does not have Security Defaults / MFA enforcement enabled",
                severity="high",
                risk_score=score("high"),
                evidence={
                    "provider_type": "entra_id",
                    "tenant_id": source,
                    "security_defaults_enabled": False,
                },
            )
        )
    return out
