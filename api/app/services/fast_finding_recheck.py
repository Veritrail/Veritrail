"""Fast, resource-scoped verification after remediation (see fast_recheck package)."""
from app.services.fast_recheck import try_fast_finding_recheck

__all__ = ["try_fast_finding_recheck"]
