"""Intune MDM device encryption check."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.checks._identity_helpers import _providers_of_type, _source_label
from app.models.phase9 import MdmDeviceSnapshot

CHECK_ID = "intune.device.not_encrypted"


def run(db: Session, account_id) -> list[FindingDraft]:
    out: list[FindingDraft] = []
    for provider in _providers_of_type(db, account_id, "intune"):
        source = _source_label(provider)
        devices = db.scalars(
            select(MdmDeviceSnapshot).where(
                MdmDeviceSnapshot.provider_id == provider.id,
                MdmDeviceSnapshot.encrypted.is_(False),
            )
        ).all()
        for device in devices:
            out.append(
                FindingDraft(
                    check_id=CHECK_ID,
                    resource_arn=f"intune://{source}/device/{device.external_id}",
                    title=f"Intune device `{device.device_name or device.external_id}` is not encrypted",
                    severity="high",
                    risk_score=score("high"),
                    evidence={
                        "provider_type": "intune",
                        "device_name": device.device_name,
                        "platform": device.platform,
                        "encrypted": False,
                    },
                )
            )
        total = db.scalar(
            select(func.count()).select_from(MdmDeviceSnapshot).where(
                MdmDeviceSnapshot.provider_id == provider.id
            )
        ) or 0
        if total == 0:
                out.append(
                    FindingDraft(
                        check_id=CHECK_ID,
                        resource_arn=f"intune://{source}/sync",
                        title=f"Intune `{source}` has no synced device inventory",
                        severity="medium",
                        risk_score=score("medium"),
                        evidence={"provider_type": "intune", "sync_required": True},
                    )
                )
    return out
