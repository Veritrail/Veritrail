from app.models import Finding
from app.models.org import Org
from app.services.ai_finding_review import heuristic_triage_payload, org_ai_finding_review_enabled


def _org(settings: dict | None) -> Org:
    org = Org(name="Test")
    org.settings = settings
    return org


def test_org_ai_finding_review_defaults_on():
    assert org_ai_finding_review_enabled(_org({})) is True
    assert org_ai_finding_review_enabled(_org(None)) is True
    assert org_ai_finding_review_enabled(None) is True


def test_org_ai_finding_review_respects_explicit_off():
    assert org_ai_finding_review_enabled(
        _org({"features": {"ai_finding_review_enabled": False}})
    ) is False


def test_org_ai_finding_review_legacy_key():
    assert org_ai_finding_review_enabled(_org({"features": {"ai_triage_enabled": False}})) is False


def test_heuristic_triage_payload_shape():
    import uuid

    oid = uuid.uuid4()
    finding = Finding(
        org_id=oid,
        account_id=uuid.uuid4(),
        check_id="iam.root_mfa",
        title="Root MFA not enabled",
        severity="critical",
        status="open",
        evidence={"resource_count": 1},
    )
    payload = heuristic_triage_payload(finding)
    assert payload["model_version"] == "veritrail-local-review-v1"
    assert payload["suggested_action"] == "resolve"
    assert payload["confidence_score"] >= 0.8
