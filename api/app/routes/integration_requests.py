"""Inbound integration requests from workspace users."""
from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.ratelimit import limiter
from app.core.route_deps import RequireViewer
from app.models.org import Org, User
from app.services.mail import send_mail
from app.services.org_activity import log_org_activity

router = APIRouter()
log = structlog.get_logger()


class IntegrationRequestIn(BaseModel):
    integration_name: str = Field(min_length=1, max_length=120)
    message: str = Field(default="", max_length=2000)


class IntegrationRequestOut(BaseModel):
    ok: bool = True
    message: str = "Thanks — we've received your request and will follow up."


@router.post("/integration-request", status_code=status.HTTP_202_ACCEPTED, response_model=IntegrationRequestOut)
@limiter.limit("10/minute")
def request_integration(
    body: IntegrationRequestIn,
    request: Request,
    user: RequireViewer,
    db: Session = Depends(get_db),
):
    """Authenticated users can ask Veritrail to add a new integration."""
    org = db.get(Org, user.org_id)
    org_name = org.name if org else "Unknown workspace"
    integration_name = body.integration_name.strip()
    note = body.message.strip()

    text = (
        f"Integration request from {user.email} ({org_name})\n\n"
        f"Requested integration: {integration_name}\n"
    )
    if note:
        text += f"\nMessage:\n{note}\n"

    settings = get_settings()
    sent, mail_err = send_mail(
        to=settings.SUPPORT_EMAIL,
        subject=f"Integration request — {integration_name}",
        text=text,
    )
    if not sent:
        log.warning(
            "integration_request.mail_failed",
            org_id=str(user.org_id),
            user_email=user.email,
            integration_name=integration_name,
            error=mail_err,
        )

    log_org_activity(
        db,
        org_id=user.org_id,
        actor_user_id=user.id,
        action="integration.requested",
        target_type="integration_request",
        target_label=integration_name,
        actor_email=user.email,
        detail={
            "integration_name": integration_name,
            "message": note[:500] if note else None,
            "mail_sent": sent,
        },
    )
    db.commit()

    return IntegrationRequestOut()
