"""HTTP tests for POST /v1/controls/evidence upload hardening."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.core.db import get_db
from app.core.security import current_principal, issue_token
from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def _auth_header(org_id: str, user_id: str) -> dict[str, str]:
    token = issue_token(user_id, org_id)
    return {"Authorization": f"Bearer {token}"}


def _mock_upload_context(*, org_id: uuid.UUID, user_id: uuid.UUID, control_id: uuid.UUID):
    user = MagicMock()
    user.id = user_id
    user.org_id = org_id
    user.email = "uploader@test"
    user.role = "editor"

    ctrl = MagicMock()
    ctrl.id = control_id
    ctrl.framework = "soc2"
    ctrl.control_id = "CC6.1"

    db = MagicMock()

    def _get(model, pk):
        if getattr(model, "__name__", "") == "Control":
            return ctrl if pk == control_id else None
        return None

    db.get.side_effect = _get
    db.scalars.return_value.all.return_value = []

    def _refresh(row):
        row.reviewed_by = None
        row.id = uuid.uuid4()
        row.created_at = None

    db.refresh.side_effect = _refresh
    return user, db, ctrl


@pytest.fixture
def upload_env(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCAL_UPLOAD_DIR", str(tmp_path))
    monkeypatch.setenv("EVIDENCE_ARTIFACTS_S3_URI", "")
    from app.core.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _post_evidence(client, user, db, control_id, *, filename, content, content_type="application/pdf"):
    org_id = user.org_id
    user_id = user.id
    client.app.dependency_overrides[get_db] = lambda: db
    client.app.dependency_overrides[current_principal] = lambda: {
        "sub": str(user_id),
        "org_id": str(org_id),
        "role": "editor",
    }
    try:
        return client.post(
            "/v1/controls/evidence",
            headers=_auth_header(str(org_id), str(user_id)),
            data={
                "framework": "soc2",
                "control_id": str(control_id),
                "title": "Test evidence",
            },
            files={"file": (filename, content, content_type)},
        )
    finally:
        client.app.dependency_overrides.clear()


def test_rejects_html_upload(client, upload_env):
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    control_id = uuid.uuid4()
    user, db, _ctrl = _mock_upload_context(org_id=org_id, user_id=user_id, control_id=control_id)

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("app.routes.controls.get_org_user", lambda _db, _p: user)
        mp.setattr("app.routes.controls.require_evidence_upload", lambda *_args, **_kwargs: "contributor")
        mp.setattr("app.routes.controls.log_org_activity", lambda *_args, **_kwargs: None)
        res = _post_evidence(
            client,
            user,
            db,
            control_id,
            filename="payload.html",
            content=b"<html><script>alert(1)</script></html>",
            content_type="text/html",
        )
    assert res.status_code == 400


def test_rejects_exe_upload(client, upload_env):
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    control_id = uuid.uuid4()
    user, db, _ctrl = _mock_upload_context(org_id=org_id, user_id=user_id, control_id=control_id)

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("app.routes.controls.get_org_user", lambda _db, _p: user)
        mp.setattr("app.routes.controls.require_evidence_upload", lambda *_args, **_kwargs: "contributor")
        res = _post_evidence(
            client,
            user,
            db,
            control_id,
            filename="malware.exe",
            content=b"MZfake",
            content_type="application/octet-stream",
        )
    assert res.status_code == 400


def test_rejects_oversized_upload(client, upload_env):
    from app.services.evidence_artifact_safety import MAX_EVIDENCE_UPLOAD_BYTES

    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    control_id = uuid.uuid4()
    user, db, _ctrl = _mock_upload_context(org_id=org_id, user_id=user_id, control_id=control_id)

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("app.routes.controls.get_org_user", lambda _db, _p: user)
        mp.setattr("app.routes.controls.require_evidence_upload", lambda *_args, **_kwargs: "contributor")
        oversized = b"%PDF-" + b"x" * (MAX_EVIDENCE_UPLOAD_BYTES + 1)
        res = _post_evidence(
            client,
            user,
            db,
            control_id,
            filename="huge.pdf",
            content=oversized,
        )
    assert res.status_code == 400
    assert "too large" in res.json()["detail"].lower()


def test_accepts_valid_pdf(client, upload_env):
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    control_id = uuid.uuid4()
    user, db, _ctrl = _mock_upload_context(org_id=org_id, user_id=user_id, control_id=control_id)

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("app.routes.controls.get_org_user", lambda _db, _p: user)
        mp.setattr("app.routes.controls.require_evidence_upload", lambda *_args, **_kwargs: "contributor")
        mp.setattr("app.routes.controls.log_org_activity", lambda *_args, **_kwargs: None)
        res = _post_evidence(
            client,
            user,
            db,
            control_id,
            filename="report.pdf",
            content=b"%PDF-1.4 valid",
        )

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["filename"] == "report.pdf"
    assert body["size_bytes"] > 0
