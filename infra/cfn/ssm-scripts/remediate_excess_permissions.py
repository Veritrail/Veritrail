import datetime, hashlib, json
import boto3

ALLOWED = {
    "iam.policy.wildcard_resource",
    "iam.role.full_admin_policy",
}


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


def role_name(arn):
    return arn.split("/")[-1] if "/" in arn else arn


def handler(event, context):
    plan = json.loads(event["PlanJson"])
    err = verify(plan)
    if err:
        return finish(plan, {"ok": False, "error": err})

    ev = plan.get("evidence") or {}
    role_arn = (
        plan.get("resource_arn") or ev.get("role_arn") or ""
    )
    rname = role_name(role_arn)
    action = plan.get("supported_action", "detach_full_admin")

    iam = boto3.client("iam")
    results = []

    if action == "detach_full_admin":
        policies = ev.get("attached_policies_full_admin", [])
        for policy_name in policies:
            account_id = (
                boto3.client("sts")
                .get_caller_identity()["Account"]
            )
            policy_arn = (
                f"arn:aws:iam::{account_id}:policy/{policy_name}"
            )
            iam.detach_role_policy(
                RoleName=rname, PolicyArn=policy_arn
            )
            results.append(
                {"policy": policy_name, "action": "detached"}
            )
        return finish(
            plan,
            {
                "ok": True,
                "action": "detach_full_admin",
                "role_name": rname,
                "results": results,
            },
        )

    if action == "replace_wildcard_inline":
        replacement = plan.get("replacement_policy")
        if not replacement:
            return finish(
                plan,
                {
                    "ok": False,
                    "error": "missing replacement_policy in plan",
                },
            )
        inline_names = ev.get("policy_names", [])
        for pname in inline_names:
            iam.put_role_policy(
                RoleName=rname,
                PolicyName=pname,
                PolicyDocument=json.dumps(replacement),
            )
            results.append(
                {"inline_policy": pname, "action": "replaced"}
            )
        return finish(
            plan,
            {
                "ok": True,
                "action": "replace_wildcard_inline",
                "role_name": rname,
                "results": results,
            },
        )

    return finish(
        plan,
        {"ok": False, "error": f"unsupported action: {action}"},
    )
