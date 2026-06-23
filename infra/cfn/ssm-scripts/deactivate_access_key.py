import datetime
import hashlib
import json

import boto3

PLAN_SCHEMA = "veritrail_remediation_plan/v2"
ALLOWED = {
    "iam.access_key.unused_45d",
    "iam.access_key.unused_90d",
}


def finish(plan, result):
    result["plan_id"] = plan.get("plan_id")
    return result


def verify(plan):
    if plan.get("schema") != PLAN_SCHEMA:
        return "unsupported schema"
    if plan.get("check_id") not in ALLOWED:
        return "unsupported check_id"
    expires = plan.get("expires_at")
    if not expires:
        return "missing expires_at"
    try:
        exp = datetime.datetime.fromisoformat(expires.replace("Z", "+00:00"))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=datetime.timezone.utc)
    except ValueError:
        return "invalid expires_at"
    if datetime.datetime.now(datetime.timezone.utc) > exp:
        return "plan_expired"
    expected = plan.get("content_sha256")
    if expected:
        body = {
            k: v
            for k, v in plan.items()
            if k not in ("content_sha256", "signature")
        }
        canonical = json.dumps(body, sort_keys=True, separators=(",", ":"))
        if hashlib.sha256(canonical.encode()).hexdigest() != expected:
            return "content_sha256_mismatch"
    return None


def key_context(plan):
    ev = plan.get("evidence") or {}
    user_arn = ev.get("user_arn")
    key_id = ev.get("key_id")
    if not user_arn or not key_id:
        raw = plan.get("resource_arn") or ""
        if "#" in raw:
            user_arn, key_id = raw.split("#", 1)
    user_name = (
        user_arn.split("/")[-1] if user_arn and "/" in user_arn else user_arn
    )
    return user_arn, user_name, key_id


def handler(event, context):
    plan = json.loads(event["PlanJson"])
    err = verify(plan)
    if err:
        return finish(plan, {"ok": False, "error": err})

    user_arn, user_name, key_id = key_context(plan)
    if not user_name or not key_id:
        return finish(
            plan, {"ok": False, "error": "missing user_arn or key_id"}
        )

    boto3.client("iam").update_access_key(
        UserName=user_name,
        AccessKeyId=key_id,
        Status="Inactive",
    )

    return finish(
        plan,
        {
            "ok": True,
            "action": "deactivate_access_key",
            "user_arn": user_arn,
            "user_name": user_name,
            "key_id": key_id,
            "status": "Inactive",
        },
    )
