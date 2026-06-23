"""Persist sign-in sessions for the account page (device + geo)."""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.client_ip import client_ip_from_request
from app.models.user_session import UserSession
from app.services.ip_geolocation import format_location, lookup_ip_geolocation


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def record_user_session(db: Session, user_id: uuid.UUID, refresh_token: str, request: Request) -> UserSession:
    ip = client_ip_from_request(request)
    geo = lookup_ip_geolocation(ip)
    ua = request.headers.get("user-agent")
    row = UserSession(
        user_id=user_id,
        token_hash=hash_refresh_token(refresh_token),
        ip_address=ip,
        city=geo["city"],
        region=geo["region"],
        country=geo["country"],
        user_agent=(ua[:512] if ua else None),
    )
    db.add(row)
    return row


def rotate_user_session(
    db: Session,
    user_id: uuid.UUID,
    old_refresh_token: str,
    new_refresh_token: str,
    request: Request,
) -> UserSession | None:
    old_hash = hash_refresh_token(old_refresh_token)
    row = db.scalar(
        select(UserSession).where(UserSession.user_id == user_id, UserSession.token_hash == old_hash)
    )
    if row:
        row.token_hash = hash_refresh_token(new_refresh_token)
        row.last_seen_at = datetime.now(timezone.utc)
        return row
    return record_user_session(db, user_id, new_refresh_token, request)


def get_session_for_refresh(db: Session, user_id: uuid.UUID, refresh_token: str) -> UserSession | None:
    token_hash = hash_refresh_token(refresh_token)
    return db.scalar(
        select(UserSession).where(UserSession.user_id == user_id, UserSession.token_hash == token_hash)
    )


def ensure_session_for_refresh(
    db: Session,
    user_id: uuid.UUID,
    refresh_token: str,
    request: Request,
) -> UserSession:
    row = get_session_for_refresh(db, user_id, refresh_token)
    if row:
        return row
    return record_user_session(db, user_id, refresh_token, request)


def revoke_session_for_refresh(db: Session, refresh_token: str) -> None:
    token_hash = hash_refresh_token(refresh_token)
    row = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash))
    if row:
        db.delete(row)


def list_user_sessions(db: Session, user_id: uuid.UUID) -> list[UserSession]:
    return list(
        db.scalars(
            select(UserSession)
            .where(UserSession.user_id == user_id)
            .order_by(UserSession.last_seen_at.desc())
        ).all()
    )


def revoke_session_by_id(db: Session, user_id: uuid.UUID, session_id: uuid.UUID) -> bool:
    row = db.scalar(
        select(UserSession).where(UserSession.id == session_id, UserSession.user_id == user_id)
    )
    if not row:
        return False
    db.delete(row)
    return True


def revoke_other_sessions(db: Session, user_id: uuid.UUID, keep_refresh_token: str) -> int:
    keep_hash = hash_refresh_token(keep_refresh_token)
    rows = list(
        db.scalars(
            select(UserSession).where(
                UserSession.user_id == user_id,
                UserSession.token_hash != keep_hash,
            )
        ).all()
    )
    for row in rows:
        db.delete(row)
    return len(rows)


def refresh_session_geolocation(session: UserSession) -> bool:
    """Fill geo fields when missing (e.g. session created before egress fallback)."""
    if format_location(session.city, session.region, session.country):
        return False
    geo = lookup_ip_geolocation(session.ip_address)
    if not any(geo.values()):
        return False
    session.city = geo["city"]
    session.region = geo["region"]
    session.country = geo["country"]
    return True


def session_location_label(session: UserSession | None) -> str | None:
    if not session:
        return None
    return format_location(session.city, session.region, session.country)
