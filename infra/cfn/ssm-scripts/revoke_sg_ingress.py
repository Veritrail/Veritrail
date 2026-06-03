import datetime
import hashlib
import json

import boto3

PLAN_SCHEMA = "vigil_remediation_plan/v2"
ALLOWED = {
    "ec2.security_group.unrestricted_ssh",
    "ec2.security_group.unrestricted_rdp",
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


def region(plan):
    if plan.get("resource_region"):
        return plan["resource_region"]
    ev = plan.get("evidence") or {}
    if ev.get("region"):
        return ev["region"]
    arn = plan.get("resource_arn") or ""
    parts = arn.split(":")
    if len(parts) > 3 and parts[3]:
        return parts[3]
    return "us-east-1"


def group_id(plan):
    ev = plan.get("evidence") or {}
    if ev.get("group_id"):
        return str(ev["group_id"])
    arn = plan.get("resource_arn") or ""
    if "/security-group/" in arn:
        return arn.split("/security-group/")[-1]
    return arn.rsplit("/", 1)[-1]


def rule_matches(perm, rule, cidr):
    if cidr != rule.get("cidr"):
        return False
    proto = str(perm.get("IpProtocol", ""))
    wanted = rule.get("protocol")
    if wanted not in ("all", proto, "-1") and proto not in ("-1", str(wanted)):
        return False
    for key in ("from_port", "to_port"):
        pkey = "FromPort" if key == "from_port" else "ToPort"
        rv, pv = rule.get(key), perm.get(pkey)
        if rv is None and pv is None:
            continue
        if rv is None or pv is None or int(rv) != int(pv):
            return False
    return True


def handler(event, context):
    plan = json.loads(event["PlanJson"])
    err = verify(plan)
    if err:
        return finish(plan, {"ok": False, "error": err})

    sg_id = group_id(plan)
    rules = plan.get("exact_match_rules") or []
    if not sg_id or not rules:
        return finish(plan, {"ok": False, "error": "stale_plan"})

    ec2 = boto3.client("ec2", region_name=region(plan))
    sg = ec2.describe_security_groups(GroupIds=[sg_id])["SecurityGroups"][0]

    revoked = 0
    for perm in sg.get("IpPermissions", []):
        for key, cidr_key, public in (
            ("IpRanges", "CidrIp", "0.0.0.0/0"),
            ("Ipv6Ranges", "CidrIpv6", "::/0"),
        ):
            for rng in perm.get(key, []):
                cidr = rng.get(cidr_key)
                if cidr != public:
                    continue
                if not any(rule_matches(perm, rule, cidr) for rule in rules):
                    continue
                ip_perm = {"IpProtocol": perm.get("IpProtocol")}
                if perm.get("IpProtocol") != "-1":
                    ip_perm["FromPort"] = perm.get("FromPort")
                    ip_perm["ToPort"] = perm.get("ToPort")
                ip_perm[key] = [{cidr_key: cidr}]
                ec2.revoke_security_group_ingress(
                    GroupId=sg_id, IpPermissions=[ip_perm]
                )
                revoked += 1

    if revoked == 0:
        return finish(
            plan,
            {
                "ok": False,
                "error": "stale_plan",
                "region": region(plan),
                "group_id": sg_id,
                "revoked": 0,
            },
        )

    return finish(
        plan,
        {
            "ok": True,
            "action": "revoke_exact_ingress",
            "region": region(plan),
            "group_id": sg_id,
            "revoked": revoked,
        },
    )
