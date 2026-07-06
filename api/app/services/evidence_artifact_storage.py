"""Persist uploaded external evidence artifacts (local disk or S3)."""
from __future__ import annotations

import uuid
from pathlib import Path

import boto3
import structlog
from botocore.exceptions import ClientError

from app.core.config import get_settings
from app.services.evidence_vault import VaultLocation, parse_s3_uri

log = structlog.get_logger()
_S3_SCHEME = "s3://"


class EvidenceArtifactStorageError(RuntimeError):
    pass


def artifacts_s3_enabled() -> bool:
    return bool(get_settings().EVIDENCE_ARTIFACTS_S3_URI.strip())


def _upload_root() -> Path:
    return Path(get_settings().LOCAL_UPLOAD_DIR)


def _artifacts_s3_location() -> VaultLocation:
    loc = parse_s3_uri(get_settings().EVIDENCE_ARTIFACTS_S3_URI)
    region = get_settings().EVIDENCE_ARTIFACTS_S3_REGION.strip() or loc.region
    if region:
        return VaultLocation(bucket=loc.bucket, prefix=loc.prefix, region=region)
    return loc


def _s3_client(loc: VaultLocation):
    region = loc.region or get_settings().EVIDENCE_ARTIFACTS_S3_REGION or "us-east-1"
    return boto3.client("s3", region_name=region)


def is_s3_storage_path(storage_path: str | None) -> bool:
    return bool(storage_path and storage_path.startswith(_S3_SCHEME))


def _parse_s3_storage_path(storage_path: str) -> tuple[str, str]:
    without_scheme = storage_path[len(_S3_SCHEME) :]
    bucket, _, key = without_scheme.partition("/")
    if not bucket or not key:
        raise EvidenceArtifactStorageError(f"invalid S3 storage path: {storage_path!r}")
    return bucket, key


def save_artifact_bytes(
    *,
    org_id: uuid.UUID,
    stored_name: str,
    raw: bytes,
    content_type: str | None = None,
) -> str:
    if not artifacts_s3_enabled():
        if get_settings().APP_ENV != "dev":
            raise EvidenceArtifactStorageError(
                "EVIDENCE_ARTIFACTS_S3_URI must be configured outside dev"
            )
    if artifacts_s3_enabled():
        loc = _artifacts_s3_location()
        prefix = loc.prefix.strip("/")
        key_parts = [p for p in (prefix, "evidence", str(org_id), stored_name) if p]
        key = "/".join(key_parts)
        client = _s3_client(loc)
        try:
            client.put_object(
                Bucket=loc.bucket,
                Key=key,
                Body=raw,
                ContentType=content_type or "application/octet-stream",
                ServerSideEncryption="AES256",
            )
        except ClientError as e:
            log.exception("evidence_artifact.s3_upload_failed", key=key)
            raise EvidenceArtifactStorageError("failed to store evidence in S3") from e
        return f"{_S3_SCHEME}{loc.bucket}/{key}"

    relative = Path("evidence") / str(org_id) / stored_name
    full_path = _upload_root() / relative
    full_path.parent.mkdir(parents=True, exist_ok=True)
    full_path.write_bytes(raw)
    return str(relative)


def read_artifact_bytes(storage_path: str) -> bytes:
    if is_s3_storage_path(storage_path):
        bucket, key = _parse_s3_storage_path(storage_path)
        loc = _artifacts_s3_location()
        client = _s3_client(loc)
        try:
            resp = client.get_object(Bucket=bucket, Key=key)
            return resp["Body"].read()
        except ClientError as e:
            log.exception("evidence_artifact.s3_read_failed", storage_path=storage_path)
            raise EvidenceArtifactStorageError("failed to read evidence from S3") from e

    full_path = _upload_root() / storage_path
    if not full_path.is_file():
        raise EvidenceArtifactStorageError(f"evidence file not found: {storage_path}")
    return full_path.read_bytes()


def delete_artifact(storage_path: str) -> None:
    if not storage_path:
        return
    if is_s3_storage_path(storage_path):
        bucket, key = _parse_s3_storage_path(storage_path)
        client = _s3_client(_artifacts_s3_location())
        try:
            client.delete_object(Bucket=bucket, Key=key)
        except ClientError:
            log.exception("evidence_artifact.s3_delete_failed", storage_path=storage_path)
        return

    try:
        (_upload_root() / storage_path).unlink(missing_ok=True)
    except OSError:
        log.exception("evidence_artifact.local_delete_failed", storage_path=storage_path)


def storage_backend_label() -> str:
    return "s3" if artifacts_s3_enabled() else "local"


def presigned_download_url(
    storage_path: str,
    *,
    filename: str | None = None,
    ttl_seconds: int | None = None,
) -> str:
    if not is_s3_storage_path(storage_path):
        raise EvidenceArtifactStorageError("presigned download requires S3 storage path")
    bucket, key = _parse_s3_storage_path(storage_path)
    ttl = ttl_seconds or get_settings().EVIDENCE_ARTIFACTS_DOWNLOAD_TTL_SECONDS
    client = _s3_client(_artifacts_s3_location())
    params: dict[str, str] = {"Bucket": bucket, "Key": key}
    if filename:
        safe = filename.replace('"', "")
        params["ResponseContentDisposition"] = f'attachment; filename="{safe}"'
    try:
        return client.generate_presigned_url("get_object", Params=params, ExpiresIn=ttl)
    except ClientError as e:
        log.exception("evidence_artifact.s3_presign_failed", storage_path=storage_path)
        raise EvidenceArtifactStorageError("failed to create download URL") from e
