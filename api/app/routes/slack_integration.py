"""Slack incoming-webhook integration (alerts + digest delivery)."""
from __future__ import annotations

import uuid
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.route_deps import RequireAdmin
from app.core.security import current_principal
from app.models.org import Org
from app.routes.settings import DEFAULT_SETTINGS, _merged, _validate_slack_webhook

router = APIRouter()


def _get_org(p, db: Session) -> Org:
    org = db.get(Org, uuid.UUID(p["org_id"]))
    if not org:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    return org


def _mask_webhook(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) < 3:
        return "https://hooks.slack.com/services/…"
    return f"{parsed.scheme}://{parsed.netloc}/services/{parts[-3]}/…/{parts[-1][-4:].rjust(4, '•')}"


class SlackIntegrationOut(BaseModel):
    connected: bool
    webhook_url_masked: str | None
    webhook_url: str | None = None
    slack_digest_enabled: bool
    slack_scan_failure_enabled: bool
    slack_critical_alerts_enabled: bool


class SlackIntegrationIn(BaseModel):
    webhook_url: str | None = None
    slack_digest_enabled: bool | None = None
    slack_scan_failure_enabled: bool | None = None
    slack_critical_alerts_enabled: bool | None = None


class SlackTestIn(BaseModel):
    url: str | None = None


@router.get("/slack", response_model=SlackIntegrationOut)
def get_slack(p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    notifications = _merged(org.settings or {}).get("notifications", {})
    webhook = notifications.get("slack_webhook_url")
    return SlackIntegrationOut(
        connected=bool(webhook and str(webhook).strip()),
        webhook_url_masked=_mask_webhook(webhook),
        webhook_url=webhook,
        slack_digest_enabled=bool(notifications.get("slack_digest_enabled", False)),
        slack_scan_failure_enabled=bool(notifications.get("slack_scan_failure_enabled", True)),
        slack_critical_alerts_enabled=bool(notifications.get("slack_critical_alerts_enabled", True)),
    )


@router.put("/slack", response_model=SlackIntegrationOut)
def put_slack(body: SlackIntegrationIn, _rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    current = dict(org.settings or {})
    notifications = {**DEFAULT_SETTINGS["notifications"], **current.get("notifications", {})}

    if body.webhook_url is not None:
        trimmed = body.webhook_url.strip()
        if trimmed:
            notifications["slack_webhook_url"] = _validate_slack_webhook(trimmed)
        else:
            notifications["slack_webhook_url"] = None

    if body.slack_digest_enabled is not None:
        notifications["slack_digest_enabled"] = body.slack_digest_enabled
    if body.slack_scan_failure_enabled is not None:
        notifications["slack_scan_failure_enabled"] = body.slack_scan_failure_enabled
    if body.slack_critical_alerts_enabled is not None:
        notifications["slack_critical_alerts_enabled"] = body.slack_critical_alerts_enabled

    current["notifications"] = notifications
    org.settings = current
    db.add(org)
    db.commit()
    db.refresh(org)
    return get_slack(p=p, db=db)


@router.delete("/slack", status_code=204)
def delete_slack(_rbac: RequireAdmin, p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    current = dict(org.settings or {})
    notifications = {**DEFAULT_SETTINGS["notifications"], **current.get("notifications", {})}
    notifications["slack_webhook_url"] = None
    notifications["slack_digest_enabled"] = False
    current["notifications"] = notifications
    org.settings = current
    db.add(org)
    db.commit()


@router.post("/slack/test")
def test_slack(_rbac: RequireAdmin, body: SlackTestIn = SlackTestIn(), p=Depends(current_principal), db: Session = Depends(get_db)):
    org = _get_org(p, db)
    notifications = (org.settings or {}).get("notifications") or {}
    webhook_url = body.url or notifications.get("slack_webhook_url")
    if not webhook_url:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No Slack webhook URL configured")
    webhook_url = _validate_slack_webhook(webhook_url)

    try:
        resp = httpx.post(
            webhook_url,
            json={"text": ":white_check_mark: *Veritrail* — Slack notifications are working."},
            timeout=10,
        )
        if resp.status_code != 200:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Slack returned {resp.status_code}: {resp.text}")
    except httpx.RequestError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Slack request failed: {e}")

    return {"ok": True}
