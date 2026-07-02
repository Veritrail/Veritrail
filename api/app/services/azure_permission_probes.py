"""Probe Azure scan APIs during verify and report degraded checks."""
from __future__ import annotations

from typing import Any, Callable

from app.models.azure_subscription import AzureSubscription
from app.services.azure_client import AzureClient

ProbeFn = Callable[[AzureClient, str], tuple[Any, int | None]]

_AZURE_SCAN_PROBES: list[tuple[str, str, ProbeFn]] = [
    ("defender", "azure.defender.not_enabled", lambda c, s: c.list_secure_scores_soft(s)),
    ("storage", "azure.storage.public_blob_access", lambda c, s: c.list_storage_accounts_soft(s)),
    (
        "resource_graph",
        "azure.compute.instance_public_ip",
        lambda c, s: c.query_resource_graph(s, "Resources | limit 1"),
    ),
    ("activity_log", "azure.logging.not_enabled", lambda c, s: c.list_subscription_diagnostic_settings(s)),
    (
        "authorization",
        "azure.entra.privileged_role_assignment",
        lambda c, s: c.list_role_assignments(s),
    ),
]


def probe_azure_scan_permissions(subscription: AzureSubscription) -> list[dict[str, str]]:
    """Return degraded checks when an API is unreachable due to missing RBAC permissions."""
    client = AzureClient(
        tenant_id=subscription.tenant_id,
        client_id=subscription.client_id,
        client_secret=subscription.client_secret,
    )
    degraded: list[dict[str, str]] = []
    for api_name, check_id, probe in _AZURE_SCAN_PROBES:
        try:
            _payload, status = probe(client, subscription.subscription_id)
            if status is not None and status >= 400:
                degraded.append(
                    {
                        "check_id": check_id,
                        "api": api_name,
                        "reason": (
                            f"Azure API returned HTTP {status} — grant the app registration "
                            f"Reader (and Security Reader for Defender) on the subscription."
                        ),
                    }
                )
        except ValueError as exc:
            degraded.append(
                {
                    "check_id": check_id,
                    "api": api_name,
                    "reason": str(exc),
                }
            )
    return degraded
