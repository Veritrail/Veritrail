from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.checks._identity_helpers import _providers_of_type, _source_label

CHECK_ID = "google_workspace.org.mfa_not_enforced"


def run(db: Session, account_id) -> list[FindingDraft]:
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, "google_workspace"):
        try:
            cfg = json.loads(provider.config_json_encrypted or "{}")
        except Exception:
            cfg = {}
        source = _source_label(provider)
        if cfg.get("two_step_verification_enforced"):
            continue
        out.append(
            FindingDraft(
                check_id=CHECK_ID,
                resource_arn=f"google_workspace://{source}/org",
                title=f"Google Workspace domain `{source}` does not enforce 2-Step Verification org-wide",
                severity="high",
                risk_score=score("high"),
                evidence={
                    "provider_type": "google_workspace",
                    "domain": source,
                    "two_step_verification_enforced": False,
                },
            )
        )
    return out
