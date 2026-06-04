from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.models.resources import LambdaFunction

CHECK_ID = "lambda.function.public_url"


def run(db: Session, account_id) -> list[FindingDraft]:
    rows = db.scalars(
        select(LambdaFunction).where(
            LambdaFunction.account_id == account_id,
            LambdaFunction.function_url_auth_type == "NONE",
        )
    ).all()
    return [
        FindingDraft(
            check_id=CHECK_ID,
            resource_arn=r.arn,
            title=f"Lambda function `{r.function_name}` has a public function URL",
            severity="high",
            risk_score=score("high"),
            evidence={
                "function_name": r.function_name,
                "region": r.region,
                "function_url": r.function_url,
                "auth_type": r.function_url_auth_type,
            },
        )
        for r in rows
    ]
