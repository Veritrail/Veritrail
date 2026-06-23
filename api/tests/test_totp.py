import pyotp

from app.core.totp import new_secret, provisioning_uri, verify_totp


def test_new_secret_is_valid_base32():
    secret = new_secret()
    assert len(secret) >= 16
    pyotp.TOTP(secret)


def test_provisioning_uri_includes_issuer_and_email():
    uri = provisioning_uri("alice@example.com", "JBSWY3DPEHPK3PXP")
    assert "Veritrail" in uri
    assert "alice%40example.com" in uri or "alice@example.com" in uri


def test_verify_totp_accepts_current_code():
    secret = new_secret()
    code = pyotp.TOTP(secret).now()
    assert verify_totp(secret, code) is True


def test_verify_totp_rejects_bad_code():
    secret = new_secret()
    assert verify_totp(secret, "000000") is False
    assert verify_totp(secret, "abc") is False
    assert verify_totp(secret, "") is False
