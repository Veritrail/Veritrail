from pydantic import BaseModel, EmailStr, Field, field_validator

from app.services.workspace_creation_invites import normalize_plan


class AdminPlanOut(BaseModel):
    slug: str
    label: str
    max_accounts: int | None


class WorkspaceInviteCreateIn(BaseModel):
    email: EmailStr
    org_name: str = Field(default="", max_length=200)
    plan: str = "trial"
    expiry_days: int | None = 14

    @field_validator("plan")
    @classmethod
    def validate_plan(cls, v: str) -> str:
        return normalize_plan(v)

    @field_validator("expiry_days")
    @classmethod
    def validate_expiry(cls, v: int | None) -> int | None:
        if v is not None and v not in (7, 14, 30):
            raise ValueError("expiry_days must be 7, 14, or 30, or omitted for no expiration")
        return v


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
