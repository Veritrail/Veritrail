import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.services.evidence_artifact_storage import (
    EvidenceArtifactStorageError,
    delete_artifact,
    is_s3_storage_path,
    read_artifact_bytes,
    save_artifact_bytes,
)


def test_local_save_and_read_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCAL_UPLOAD_DIR", str(tmp_path))
    monkeypatch.setenv("EVIDENCE_ARTIFACTS_S3_URI", "")
    from app.core.config import get_settings

    get_settings.cache_clear()

    org_id = uuid.uuid4()
    raw = b"pdf-bytes"
    path = save_artifact_bytes(org_id=org_id, stored_name="report.pdf", raw=raw, content_type="application/pdf")
    assert not is_s3_storage_path(path)
    assert read_artifact_bytes(path) == raw
    delete_artifact(path)
    with pytest.raises(EvidenceArtifactStorageError):
        read_artifact_bytes(path)


def test_s3_save_uses_put_object(monkeypatch):
    monkeypatch.setenv("EVIDENCE_ARTIFACTS_S3_URI", "s3://artifacts-bucket/uploads")
    monkeypatch.setenv("EVIDENCE_ARTIFACTS_S3_REGION", "us-west-2")
    from app.core.config import get_settings

    get_settings.cache_clear()

    client = MagicMock()
    org_id = uuid.uuid4()
    with patch("app.services.evidence_artifact_storage.boto3.client", return_value=client):
        path = save_artifact_bytes(org_id=org_id, stored_name="scan.csv", raw=b"a,b", content_type="text/csv")
    assert path.startswith("s3://artifacts-bucket/")
    client.put_object.assert_called_once()
    assert client.put_object.call_args.kwargs["Bucket"] == "artifacts-bucket"

    with patch("app.services.evidence_artifact_storage.boto3.client", return_value=client):
        client.get_object.return_value = {"Body": MagicMock(read=MagicMock(return_value=b"a,b"))}
        assert read_artifact_bytes(path) == b"a,b"
        delete_artifact(path)
        client.delete_object.assert_called_once()

    get_settings.cache_clear()


def test_presigned_download_url(monkeypatch):
    monkeypatch.setenv("EVIDENCE_ARTIFACTS_S3_URI", "s3://artifacts-bucket/uploads")
    monkeypatch.setenv("EVIDENCE_ARTIFACTS_S3_REGION", "us-west-2")
    from app.core.config import get_settings

    get_settings.cache_clear()

    client = MagicMock()
    client.generate_presigned_url.return_value = "https://signed.example/file"
    with patch("app.services.evidence_artifact_storage.boto3.client", return_value=client):
        from app.services.evidence_artifact_storage import presigned_download_url

        url = presigned_download_url("s3://artifacts-bucket/uploads/evidence/x/file.pdf", filename="file.pdf")
    assert url == "https://signed.example/file"
    client.generate_presigned_url.assert_called_once()
    get_settings.cache_clear()
    monkeypatch.setenv("EVIDENCE_ARTIFACTS_S3_URI", "")
