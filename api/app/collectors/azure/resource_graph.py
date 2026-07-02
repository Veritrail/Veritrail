"""Collect Azure compute VM inventory via Resource Graph."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.azure_subscription import AzureComputeInstance, AzureSubscription
from app.services.azure_client import AzureClient

log = structlog.get_logger()

VM_INVENTORY_QUERY = """
Resources
| where type =~ 'microsoft.compute/virtualmachines'
| project vmId=id, name, resourceGroup, location, nics=properties.networkProfile.networkInterfaces
| mv-expand nic=nics
| extend nicId=tostring(nic.id)
| join kind=leftouter (
    Resources
    | where type =~ 'microsoft.network/networkinterfaces'
    | mv-expand ipconfig=properties.ipConfigurations
    | extend publicIpId = tostring(ipconfig.properties.publicIPAddress.id)
    | where isnotnull(publicIpId) and publicIpId != ''
    | project nicId=id, publicIpId
) on nicId
| summarize has_public_ip=countif(isnotnull(publicIpId)) > 0 by vmId, name, resourceGroup, location
""".strip()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def collect_resource_graph(db: Session, subscription: AzureSubscription) -> int:
    client = AzureClient(
        tenant_id=subscription.tenant_id,
        client_id=subscription.client_id,
        client_secret=subscription.client_secret,
    )
    rows, status = client.query_resource_graph(subscription.subscription_id, VM_INVENTORY_QUERY)
    if status and status >= 400:
        log.info(
            "collect_azure_resource_graph.skipped",
            subscription_id=subscription.subscription_id,
            status=status,
        )
        return 0

    count = 0
    for row in rows:
        vm_id = str(row.get("vmId") or "")
        name = str(row.get("name") or "")
        if not vm_id or not name:
            continue
        resource_group = str(row.get("resourceGroup") or "")
        location = str(row.get("location") or "")
        has_public_ip = bool(row.get("has_public_ip"))
        stmt = pg_insert(AzureComputeInstance).values(
            id=uuid.uuid5(uuid.NAMESPACE_URL, f"{subscription.id}:compute:{vm_id}"),
            azure_subscription_id=subscription.id,
            vm_id=vm_id,
            name=name,
            resource_group=resource_group,
            location=location,
            has_public_ip=has_public_ip,
            last_seen=_now(),
        ).on_conflict_do_update(
            index_elements=["azure_subscription_id", "vm_id"],
            set_={
                "name": name,
                "resource_group": resource_group,
                "location": location,
                "has_public_ip": has_public_ip,
                "last_seen": _now(),
            },
        )
        db.execute(stmt)
        count += 1

    log.info(
        "collect_azure_resource_graph.done",
        subscription_id=subscription.subscription_id,
        instances=count,
    )
    return count
