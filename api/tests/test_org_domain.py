"""Email-domain workspace collision guard."""
from __future__ import annotations

from unittest.mock import MagicMock

from app.services.org_domain import (
    email_domain,
    is_public_email_domain,
    org_claiming_email_domain,
)


def test_email_domain_normalizes():
    assert email_domain("Alice@Cloud-Castles.com") == "cloud-castles.com"
    assert email_domain("  bob@acme.io  ") == "acme.io"
    assert email_domain("not-an-email") is None


def test_public_domains_recognized():
    assert is_public_email_domain("gmail.com")
    assert is_public_email_domain("OUTLOOK.COM")
    assert is_public_email_domain("proton.me")
    assert not is_public_email_domain("cloud-castles.com")
    assert not is_public_email_domain("acme.io")


def test_public_domain_never_collides_without_querying_db():
    """A gmail.com signup must not be blocked just because another gmail user
    exists — and the guard should not even hit the DB for public domains."""
    db = MagicMock()
    assert org_claiming_email_domain(db, "new-person@gmail.com") is None
    db.scalar.assert_not_called()


def test_corporate_domain_queries_for_existing_workspace():
    db = MagicMock()
    db.scalar.return_value = None  # no existing user on this domain
    assert org_claiming_email_domain(db, "founder@acme.io") is None
    db.scalar.assert_called_once()


def test_normalize_domain():
    from app.services.org_domain import normalize_domain

    assert normalize_domain("Acme.com") == "acme.com"
    assert normalize_domain("https://www.acme.com/path") == "acme.com"
    assert normalize_domain("user@acme.io") == "acme.io"
    assert normalize_domain("gmail.com") is None  # public provider can't be claimed
    assert normalize_domain("not a domain") is None
    assert normalize_domain("") is None


def test_verify_domain_dns(monkeypatch):
    import dns.resolver

    from app.services import org_domain

    class FakeRdata:
        def __init__(self, s: bytes):
            self.strings = [s]

    def fake_resolve(self, qname, rdtype):
        assert str(qname) == "_veritrail-challenge.acme.com"
        assert rdtype == "TXT"
        return [FakeRdata(b"veritrail-domain-verification=tok123")]

    monkeypatch.setattr(dns.resolver.Resolver, "resolve", fake_resolve)
    assert org_domain.verify_domain_dns("acme.com", "tok123") is True
    assert org_domain.verify_domain_dns("acme.com", "wrong-token") is False

    def fake_fail(self, *a, **k):
        raise Exception("NXDOMAIN")

    monkeypatch.setattr(dns.resolver.Resolver, "resolve", fake_fail)
    assert org_domain.verify_domain_dns("acme.com", "tok123") is False


def test_auto_join_skips_public_and_unverified():
    from app.services.org_domain import auto_join_target_for_email

    db = MagicMock()
    # public domain → no auto-join, no DB hit
    assert auto_join_target_for_email(db, "anyone@gmail.com") is None
    db.scalar.assert_not_called()

    # corporate domain with no matching verified+enabled row → None
    db.scalar.return_value = None
    assert auto_join_target_for_email(db, "new@acme.com") is None


def test_auto_join_returns_org_and_clamped_role():
    from app.models.org_team import OrgDomain
    from app.services.org_domain import auto_join_target_for_email

    db = MagicMock()
    d = OrgDomain(domain="acme.com", verified=True, auto_join_enabled=True, auto_join_role="owner")
    db.scalar.return_value = d
    org_obj = object()
    db.get.return_value = org_obj

    result = auto_join_target_for_email(db, "new@acme.com")
    assert result is not None
    org, role = result
    assert org is org_obj
    assert role == "viewer"  # 'owner' is never granted via auto-join
