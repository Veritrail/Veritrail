"""Unauthenticated public endpoints (token-based actions + marketing-site forms)."""
from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.ratelimit import limiter
from app.models.org import Org

router = APIRouter()
log = structlog.get_logger()


class AccessRequestIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    company: str = Field(min_length=1, max_length=200)
    message: str = Field(default="", max_length=2000)


class AccessRequestOut(BaseModel):
    ok: bool = True


@router.post("/access-request", status_code=status.HTTP_202_ACCEPTED, response_model=AccessRequestOut)
@limiter.limit("5/minute")
def request_access(request: Request, body: AccessRequestIn, db: Session = Depends(get_db)):
    """Marketing-site "request access" form — stored for the platform-admin
    dashboard and emailed to support. Public and rate-limited per IP; no
    account is created.
    """
    from app.models.access_request import AccessRequest
    from app.services.mail import send_mail

    name = body.name.strip()
    company = body.company.strip()
    note = body.message.strip()

    text = (
        "New access request from veritrail.io\n\n"
        f"Name: {name}\n"
        f"Work email: {body.email}\n"
        f"Company: {company}\n"
    )
    if note:
        text += f"\nMessage:\n{note}\n"

    settings = get_settings()
    sent, mail_err = send_mail(
        to=settings.ACCESS_REQUEST_EMAIL,
        subject=f"Veritrail access request — {company}",
        text=text,
    )
    if not sent:
        log.warning("access_request.mail_failed", email=str(body.email), company=company, error=mail_err)

    db.add(
        AccessRequest(
            name=name,
            email=str(body.email).lower(),
            company=company,
            message=note or None,
            mail_sent=sent,
        )
    )
    db.commit()
    log.info("access_request.received", email=str(body.email), company=company, mail_sent=sent)
    return AccessRequestOut()


def _find_org_by_digest_token(db: Session, token: str) -> Org | None:
    if not token or len(token) < 16:
        return None
    for org in db.scalars(select(Org)).all():
        notifications = (org.settings or {}).get("notifications") or {}
        if notifications.get("digest_unsubscribe_token") == token:
            return org
    return None


@router.get("/digest/unsubscribe", response_class=HTMLResponse)
def unsubscribe_digest(
    token: str = Query(..., min_length=16),
    db: Session = Depends(get_db),
):
    """One-click weekly digest unsubscribe via signed URL token in email."""
    org = _find_org_by_digest_token(db, token)
    if not org:
        raise HTTPException(status_code=404, detail="Invalid or expired unsubscribe link")

    settings = dict(org.settings or {})
    notifications = dict(settings.get("notifications") or {})
    notifications["email_digest_enabled"] = False
    settings["notifications"] = notifications
    org.settings = settings
    db.add(org)
    db.commit()

    return HTMLResponse(
        """<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Unsubscribed — Veritrail</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.5rem;color:#18181b}
h1{font-size:1.25rem}p{color:#52525b;line-height:1.5}</style></head>
<body>
<h1>Weekly digest turned off</h1>
<p>You will no longer receive Veritrail weekly security digests for this organization.
Re-enable anytime under Settings → Notifications.</p>
</body></html>"""
    )
