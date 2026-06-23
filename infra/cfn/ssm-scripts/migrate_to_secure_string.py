import datetime
import hashlib
import json

import boto3

PLAN_SCHEMA = "veritrail_remediation_plan/v2"
ALLOWED = {"ssm.parameter.plaintext_secret"}


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


def parameter_name(plan):
    ev = plan.get("evidence") or {}
    if ev.get("parameter_name"):
        return str(ev["parameter_name"])
    arn = plan.get("resource_arn") or ""
    if ":parameter/" in arn:
        return "/" + arn.split(":parameter/", 1)[-1]
    if ":parameter" in arn:
        return arn.split(":parameter", 1)[-1]
    return ""


def region(plan):
    if plan.get("resource_region"):
        return plan["resource_region"]
    ev = plan.get("evidence") or {}
    if ev.get("region"):
        return ev["region"]
    return "us-east-1"


def handler(event, context):
    plan = json.loads(event["PlanJson"])
    err = verify(plan)
    if err:
        return finish(plan, {"ok": False, "error": err})

    name = parameter_name(plan)
    if not name:
        return finish(plan, {"ok": False, "error": "missing SSM parameter name"})

    ssm = boto3.client("ssm", region_name=region(plan))
    current = ssm.get_parameter(Name=name, WithDecryption=False)["Parameter"]
    ptype = current.get("Type")

    if ptype == "SecureString":
        return finish(
            plan,
            {
                "ok": True,
                "changed": False,
                "parameter_name": name,
                "parameter_type": "SecureString",
            },
        )

    if ptype == "StringList":
        return finish(
            plan,
            {"ok": False, "error": "unsupported parameter type StringList"},
        )

    if ptype != "String":
        return finish(
            plan,
            {
                "ok": False,
                "error": "unsupported parameter type {}".format(ptype),
            },
        )

    ssm.put_parameter(
        Name=name,
        Type="SecureString",
        Value=current["Value"],
        Overwrite=True,
    )

    return finish(
        plan,
        {
            "ok": True,
            "changed": True,
            "action": "migrate_ssm_string_to_secure_string",
            "parameter_name": name,
            "parameter_type": "SecureString",
        },
    )
