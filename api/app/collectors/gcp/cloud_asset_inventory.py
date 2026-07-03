"""Collect GCP Cloud Asset Inventory IAM policies with public bindings."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.gcp_project import GcpCloudAsset, GcpProject
from app.services.gcp_client import GcpClient

log = structlog.get_logger()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def collect_cloud_asset_inventory(db: Session, project: GcpProject) -> int:
    client = GcpClient.from_project(project)
    assets, status = client.list_cloud_asset_iam_policies(project.project_id)
    if status is not None and status >= 400:
        log.info(
            "collect_gcp_cai.skipped",
            project_id=project.project_id,
            status=status,
        )
        return 0

    count = 0
    for asset in assets:
        asset_name = str(asset.get("name") or "")
        if not asset_name:
            continue
        public_iam = client.asset_has_public_iam(asset)
        if not public_iam:
            continue
        public_roles = client.public_iam_roles(asset)
        asset_type = str(asset.get("assetType") or "")
        stmt = pg_insert(GcpCloudAsset).values(
            id=uuid.uuid5(uuid.NAMESPACE_URL, f"{project.id}:cai:{asset_name}"),
            gcp_project_id=project.id,
            asset_name=asset_name,
            asset_type=asset_type,
            has_public_iam=True,
            public_iam_roles=public_roles or None,
            last_seen=_now(),
        ).on_conflict_do_update(
            index_elements=["gcp_project_id", "asset_name"],
            set_={
                "asset_type": asset_type,
                "has_public_iam": True,
                "public_iam_roles": public_roles or None,
                "last_seen": _now(),
            },
        )
        db.execute(stmt)
        count += 1

    log.info("collect_gcp_cai.done", project_id=project.project_id, public_assets=count)
    return count
