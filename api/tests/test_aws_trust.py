from app.core.aws_trust import merge_trust_principal, parse_role_account, trust_allows_principal

SSO = "arn:aws:iam::946796614687:role/aws-reserved/sso.amazonaws.com/eu-central-1/AWSReservedSSO_AdministratorAccess_33bebb4004caf898"
CP = "arn:aws:iam::016266969060:role/VeritrailControlPlane"
EID = "6rMsX0_XhnxnWfPYEko1SPJAqA_ilnBf"


def test_merge_adds_principal():
    doc = {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"AWS": CP},
            "Action": "sts:AssumeRole",
            "Condition": {"StringEquals": {"sts:ExternalId": EID}},
        }],
    }
    merged = merge_trust_principal(doc, SSO, EID)
    assert trust_allows_principal(merged, SSO, EID)
    assert trust_allows_principal(merged, CP, EID)


def test_parse_role_account_iam():
    arn = "arn:aws:iam::946796614687:role/VeritrailReadOnly"
    assert parse_role_account(arn) == "946796614687"


def test_merge_idempotent():
    doc = {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"AWS": SSO},
            "Action": "sts:AssumeRole",
            "Condition": {"StringEquals": {"sts:ExternalId": EID}},
        }],
    }
    merged = merge_trust_principal(doc, SSO, EID)
    assert merged == doc


def test_trust_allows_principal_with_roles_anywhere_chain_actions():
    doc = {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"AWS": SSO},
            "Action": ["sts:AssumeRole", "sts:SetSourceIdentity", "sts:TagSession"],
            "Condition": {"StringEquals": {"sts:ExternalId": EID}},
        }],
    }
    assert trust_allows_principal(doc, SSO, EID)
