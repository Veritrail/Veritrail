from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.checks._identity_helpers import _providers_of_type, _source_label

CHECK_ID = "okta.org.mfa_not_enforced"


def run(db: Session, account_id) -> list[FindingDraft]:
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, "okta"):
        try:
            cfg = json.loads(provider.config_json_encrypted or "{}")
        except Exception:
            cfg = {}
        source = _source_label(provider)
        if cfg.get("mfa_policy_enforced"):
            continue
        out.append(
            FindingDraft(
                check_id=CHECK_ID,
                resource_arn=f"okta://{source}/org",
                title=f"Okta org `{source}` does not enforce MFA via sign-on policy",
                severity="high",
                risk_score=score("high"),
                evidence={
                    "provider_type": "okta",
                    "org_url": source,
                    "mfa_policy_enforced": False,
                },
            )
        )
    return out
