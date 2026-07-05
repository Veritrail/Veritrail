"""Create a password login for local dev — DEV ONLY.

Run manually (never wired into startup, so it can never seed a prod backdoor):

    docker exec veritrail-api-1 python -m scripts.seed_dev_user

Refuses to run unless APP_ENV == "dev". Attaches the user to the org with the
most connected AWS accounts (your working org) so you see real data. Idempotent:
re-running just resets the password.
"""
from __future__ import annotations

import sys

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.passwords import hash_password
from app.models.aws_account import AwsAccount
from app.models.org import Org, User
from app.models.org_team import OrgMembership

DEV_EMAIL = "dev@veritrail.io"
DEV_PASSWORD = "dev-veritrail-2026"


def main() -> int:
    settings = get_settings()
    if settings.APP_ENV != "dev":
        print(f"refusing: APP_ENV is {settings.APP_ENV!r}, not 'dev'. This user is dev-only.")
        return 1

    db = SessionLocal()
    try:
        # Org with the most connected accounts = the real working org.
        org_id = db.execute(
            select(AwsAccount.org_id, func.count(AwsAccount.id).label("n"))
            .group_by(AwsAccount.org_id)
            .order_by(func.count(AwsAccount.id).desc())
            .limit(1)
        ).first()
        org = db.get(Org, org_id[0]) if org_id else db.scalars(select(Org).limit(1)).first()
        if org is None:
            org = Org(name="Dev Org", slug="dev-org")
            db.add(org)
            db.flush()

        user = db.scalars(select(User).where(User.email == DEV_EMAIL)).first()
        if user is None:
            user = User(org_id=org.id, email=DEV_EMAIL, password_hash=hash_password(DEV_PASSWORD), role="owner")
            db.add(user)
            action = "created"
        else:
            user.org_id = org.id
            user.password_hash = hash_password(DEV_PASSWORD)
            user.role = "owner"
            action = "reset"
        db.flush()

        membership = db.scalars(
            select(OrgMembership).where(
                OrgMembership.user_id == user.id, OrgMembership.org_id == org.id
            )
        ).first()
        if membership is None:
            db.add(
                OrgMembership(
                    user_id=user.id, org_id=org.id, role="owner", evidence_role="reviewer"
                )
            )
        else:
            membership.role = "owner"
            membership.evidence_role = "reviewer"
        db.commit()

        print(f"dev user {action}.")
        print(f"  email:    {DEV_EMAIL}")
        print(f"  password: {DEV_PASSWORD}")
        print(f"  org:      {org.name} ({org.id})")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
