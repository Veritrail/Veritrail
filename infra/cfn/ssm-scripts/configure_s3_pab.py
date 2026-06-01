import datetime, hashlib, json
import boto3

ALLOWED = {"s3.bucket.public_access_not_blocked"}


def finish(plan, result):
    result["plan_id"] = plan.get("plan_id")
    return result


def verify(plan):
    if plan.get("check_id") not in ALLOWED:
        return "unsupported check_id"
    exp = datetime.datetime.fromisoformat(
        plan["expires_at"].replace("Z", "+00:00")
    )
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=datetime.timezone.utc)
    if datetime.datetime.now(datetime.timezone.utc) > exp:
        return "plan_expired"
    expected = plan.get("content_sha256")
    if expected:
        body = {
            k: v
            for k, v in plan.items()
            if k not in ("content_sha256", "signature")
        }
        canonical = json.dumps(
            body, sort_keys=True, separators=(",", ":")
        )
        if hashlib.sha256(canonical.encode()).hexdigest() != expected:
            return "content_sha256_mismatch"
    return None


def bucket_name(plan):
    ev = plan.get("evidence") or {}
    if ev.get("bucket_name"):
        return str(ev["bucket_name"])
    arn = plan.get("resource_arn") or ""
    prefix = "arn:aws:s3:::"
    if arn.startswith(prefix):
        return arn[len(prefix):].split("/", 1)[0]
    return ""


def handler(event, context):
    plan = json.loads(event["PlanJson"])
    err = verify(plan)
    if err:
        return finish(plan, {"ok": False, "error": err})

    name = bucket_name(plan)
    if not name:
        return finish(
            plan, {"ok": False, "error": "missing bucket name"}
        )

    s3 = boto3.client("s3")
    s3.put_public_access_block(
        Bucket=name,
        PublicAccessBlockConfiguration={
            "BlockPublicAcls": True,
            "IgnorePublicAcls": True,
            "BlockPublicPolicy": True,
            "RestrictPublicBuckets": True,
        },
    )

    return finish(
        plan,
        {
            "ok": True,
            "action": "block_public_access",
            "bucket_name": name,
        },
    )
