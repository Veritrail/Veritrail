from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.services.workspace_creation_invites import (
    ALLOWED_EXPIRY_DAYS,
    DEFAULT_EXPIRY_DAYS,
    MAX_EXPIRY_HOURS,
    normalize_plan,
)


class AdminPlanOut(BaseModel):
    slug: str
    label: str
    max_accounts: int | None


class WorkspaceInviteCreateIn(BaseModel):
    email: EmailStr
    org_name: str = Field(
        default="",
        max_length=200,
        description="Optional suggested workspace name shown to the invitee; they choose the final name on accept.",
    )
    plan: str = "trial"
    expiry_days: int | None = None
    expiry_hours: int | None = Field(
        default=None,
        description="Exceptional short TTL in hours (1–72). When set, overrides expiry_days.",
    )

    @field_validator("plan")
    @classmethod
    def validate_plan(cls, v: str) -> str:
        return normalize_plan(v)

    @field_validator("expiry_days")
    @classmethod
    def validate_expiry_days(cls, v: int | None) -> int | None:
        if v is not None and v not in ALLOWED_EXPIRY_DAYS:
            raise ValueError(f"expiry_days must be one of: {', '.join(str(d) for d in sorted(ALLOWED_EXPIRY_DAYS))}")
        return v

    @field_validator("expiry_hours")
    @classmethod
    def validate_expiry_hours(cls, v: int | None) -> int | None:
        if v is not None and not (1 <= v <= MAX_EXPIRY_HOURS):
            raise ValueError(f"expiry_hours must be between 1 and {MAX_EXPIRY_HOURS}")
        return v

    @model_validator(mode="after")
    def validate_expiry_mode(self) -> WorkspaceInviteCreateIn:
        if self.expiry_hours is not None and self.expiry_days is not None:
            raise ValueError("Set either expiry_days or expiry_hours, not both")
        if self.expiry_hours is None and self.expiry_days is None:
            self.expiry_days = DEFAULT_EXPIRY_DAYS
        return self


class WorkspaceInviteOut(BaseModel):
    id: str
    email: str
    org_name: str | None
    plan: str
    status: str
    expires_at: str | None
    created_at: str | None
    invite_url: str


class WorkspacePlanPatchIn(BaseModel):
    plan: str

    @field_validator("plan")
    @classmethod
    def validate_plan(cls, v: str) -> str:
        return normalize_plan(v)
