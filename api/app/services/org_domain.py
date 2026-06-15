"""Email-domain workspace collision checks + DNS-verified domain auto-join."""
from __future__ import annotations

import re
import secrets

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.org import Org, User
from app.models.org_team import ORG_ROLES, OrgDomain

# Where the org publishes the verification record, e.g.
#   _vigil-challenge.acme.com  TXT  "vigil-domain-verification=<token>"
DNS_CHALLENGE_PREFIX = "_vigil-challenge"
DNS_TXT_KEY = "vigil-domain-verification"
_DOMAIN_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$")

# Verify against known public recursive resolvers rather than the host/container
# resolver. Docker's embedded DNS (127.0.0.11) returns NXDOMAIN for these TXT
# lookups, and using a fixed public resolver also avoids split-horizon/internal DNS.
DNS_RESOLVERS = ("8.8.8.8", "1.1.1.1", "8.8.4.4", "1.0.0.1")

# Free / consumer email providers. Many unrelated people share these domains, so
# they must NOT trigger the corporate-domain collision guard — otherwise the
# first gmail.com signup would lock out every later gmail.com user.
PUBLIC_EMAIL_DOMAINS = frozenset({
    "gmail.com", "googlemail.com",
    "outlook.com", "hotmail.com", "hotmail.co.uk", "hotmail.fr", "live.com", "live.co.uk", "msn.com",
    "yahoo.com", "yahoo.co.uk", "yahoo.co.in", "ymail.com", "rocketmail.com",
    "icloud.com", "me.com", "mac.com",
    "aol.com", "aim.com",
    "protonmail.com", "proton.me", "pm.me",
    "gmx.com", "gmx.net", "gmx.de", "web.de",
    "zoho.com", "yandex.com", "yandex.ru", "mail.com", "mail.ru",
    "fastmail.com", "hey.com", "tutanota.com", "tuta.io",
    "qq.com", "163.com", "126.com", "naver.com",
})


def email_domain(email: str) -> str | None:
    normalized = email.strip().lower()
    if "@" not in normalized:
        return None
    domain = normalized.rsplit("@", 1)[-1].strip()
    return domain or None


def is_public_email_domain(domain: str | None) -> bool:
    return bool(domain) and domain.lower() in PUBLIC_EMAIL_DOMAINS


def org_claiming_email_domain(db: Session, email: str) -> Org | None:
    """Return an org that already has members on this email domain, if any.

    Public/consumer email domains never collide — only corporate domains imply a
    shared workspace.
    """
    domain = email_domain(email)
    if not domain or is_public_email_domain(domain):
        return None
    suffix = f"@{domain}"
    org_id = db.scalar(
        select(User.org_id)
        .where(func.lower(User.email).like(f"%{suffix}"))
        .limit(1)
    )
    if not org_id:
        return None
    return db.get(Org, org_id)


def assert_domain_available_for_new_workspace(db: Session, email: str) -> None:
    from fastapi import HTTPException, status

    org = org_claiming_email_domain(db, email)
    if not org:
        return
    name = (org.name or "an existing workspace").strip()
    raise HTTPException(
        status.HTTP_409_CONFLICT,
        f"This email domain is already used by {name}. Ask a workspace admin for an invite.",
    )


# ── DNS verification ───────────────────────────────────────────────

def normalize_domain(raw: str) -> str | None:
    """Lowercase, strip protocol/path/www, and validate as a bare domain."""
    d = (raw or "").strip().lower()
    d = re.sub(r"^https?://", "", d)
    d = d.split("/", 1)[0].split("@", 1)[-1].strip()
    if d.startswith("www."):
        d = d[4:]
    if not d or is_public_email_domain(d) or not _DOMAIN_RE.match(d):
        return None
    return d


def new_verification_token() -> str:
    return secrets.token_hex(20)


def dns_record_name(domain: str) -> str:
    return f"{DNS_CHALLENGE_PREFIX}.{domain}"


def dns_record_value(token: str) -> str:
    return f"{DNS_TXT_KEY}={token}"


def verify_domain_dns(domain: str, token: str) -> bool:
    """Look up the challenge TXT record on public resolvers and confirm our token."""
    import dns.resolver  # imported lazily so the module loads without DNS at import time

    expected = dns_record_value(token)
    resolver = dns.resolver.Resolver(configure=False)
    resolver.nameservers = list(DNS_RESOLVERS)
    resolver.timeout = 4.0
    resolver.lifetime = 10.0
    try:
        answers = resolver.resolve(dns_record_name(domain), "TXT")
    except Exception:
        return False
    for rdata in answers:
        try:
            txt = b"".join(rdata.strings).decode("utf-8", "ignore").strip().strip('"')
        except Exception:
            continue
        if txt == expected:
            return True
    return False


def auto_join_target_for_email(db: Session, email: str) -> tuple[Org, str] | None:
    """If the email's domain is a verified, auto-join-enabled org domain, return
    (org, role) to place the new user into. Public domains never match."""
    domain = email_domain(email)
    if not domain or is_public_email_domain(domain):
        return None
    d = db.scalar(
        select(OrgDomain).where(
            OrgDomain.domain == domain,
            OrgDomain.verified.is_(True),
            OrgDomain.auto_join_enabled.is_(True),
        )
    )
    if not d:
        return None
    org = db.get(Org, d.org_id)
    if not org:
        return None
    role = d.auto_join_role if d.auto_join_role in ORG_ROLES and d.auto_join_role != "owner" else "viewer"
    return org, role
