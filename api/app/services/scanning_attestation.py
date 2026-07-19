"""Capability-level attestation for the code/dependency/secret-scanning family.

Secure SDLC includes scanning checks (SAST, dependency, secret scanning). Those
capabilities can be satisfied by a tool outside the git provider (Snyk, Semgrep,
etc.). When an org declares an external scanner, the scanning-family findings are
suppressed from SDLC grading — while the *intrinsic* repo controls (branch
protection, required reviews, self-merge) stay enforced live from the provider.
Stored under ``org.settings["sdlc_scanning_attestation"]``.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# Scanning capabilities that an external tool can satisfy. Branch protection,
# reviews, self-merge, env protection, and status checks are intrinsic repo
# configuration and are intentionally NOT attestable.
ATTESTABLE_SCANNING_CHECKS = frozenset(
    {
        "github.repo.code_scanning_disabled",
        "github.repo.code_scanning_inactive",
        "github.repo.dependabot_disabled",
        "github.repo.dependabot_inactive",
        "github.repo.secret_scanning_disabled",
        "github.repo.secret_scanning_inactive",
        "gitlab.repo.sast_disabled",
        "gitlab.repo.dependency_scanning_disabled",
        "gitlab.repo.container_scanning_disabled",
    }
)


def get_scanning_attestation(settings: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return the attestation record, or None when not declared."""
    raw = (settings or {}).get("sdlc_scanning_attestation")
    if isinstance(raw, dict) and raw.get("declared"):
        return raw
    return None


def is_scanning_attested(settings: dict[str, Any] | None) -> bool:
    return get_scanning_attestation(settings) is not None


def merge_scanning_attestation(
    stored: dict[str, Any] | None,
    patch: dict[str, Any] | None,
    *,
    actor: str | None = None,
) -> dict[str, Any] | None:
    """Apply an attestation patch.

    ``patch`` = ``{"declared": bool, "vendor": str, "note": str}``. A falsy
    ``declared`` clears the attestation.
    """
    if not patch or not patch.get("declared"):
        return None
    return {
        "declared": True,
        "vendor": (patch.get("vendor") or "").strip() or None,
        "note": (patch.get("note") or "").strip() or None,
        "set_by": actor,
        "set_at": datetime.now(timezone.utc).isoformat(),
    }
