from functools import lru_cache
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    APP_ENV: str = "dev"
    APP_SECRET: str = "dev-secret"
    JWT_SECRET: str = "dev-jwt"
    JWT_ALG: str = "HS256"
    AUTH_ACCESS_TOKEN_HOURS: int = 24
    AUTH_REFRESH_REMEMBER_DAYS: int = 30
    AUTH_REFRESH_SESSION_HOURS: int = 24

    DATABASE_URL: str = "postgresql+psycopg://hygiene:hygiene@db:5432/hygiene"
    REDIS_URL: str = "redis://redis:6379/0"

    DEV_MODE: bool = False
    TRUST_PRINCIPAL_ARN: str = "arn:aws:iam::000000000000:root"
    API_PUBLIC_URL: str = "http://localhost:8000"
    FRONTEND_URL: str = "http://localhost:5173"
    # Comma-separated browser origins allowed for CORS (prod: https://app.veritrail.io).
    # When empty, FRONTEND_URL is used.
    CORS_ORIGINS: str = ""

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    # If set, only emails from this domain are accepted via Google OAuth (login + link).
    GOOGLE_ALLOWED_DOMAIN: str = ""
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""
    GITHUB_INTEGRATION_CALLBACK_PATH: str = "/v1/auth/github/callback"
    # GitHub App for least-privilege IaC repository access. The GitHub App setup URL should
    # point to {API_PUBLIC_URL}/v1/integrations/iac-repository/github-app/setup.
    GITHUB_APP_ID: str = ""
    GITHUB_APP_SLUG: str = ""
    GITHUB_APP_PRIVATE_KEY: str = ""
    # Shared secret for verifying inbound GitHub webhook signatures (X-Hub-Signature-256) on the
    # IaC PR/push scan trigger. Empty => the webhook endpoint rejects everything (fail closed).
    GITHUB_WEBHOOK_SECRET: str = ""

    GITLAB_CLIENT_ID: str = ""
    GITLAB_CLIENT_SECRET: str = ""
    GITLAB_INTEGRATION_CALLBACK_PATH: str = "/v1/integrations/gitlab/callback"
    # Shared secret for verifying inbound GitLab webhook tokens (X-Gitlab-Token header) on the
    # IaC push/MR scan trigger. Empty => the webhook endpoint rejects everything (fail closed).
    GITLAB_WEBHOOK_SECRET: str = ""

    # Google Workspace Admin Directory (identity evidence). Optional separate OAuth app;
    # when GOOGLE_WORKSPACE_* are empty, effective_* fall back to GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
    GOOGLE_WORKSPACE_CLIENT_ID: str = ""
    GOOGLE_WORKSPACE_CLIENT_SECRET: str = ""
    GOOGLE_WORKSPACE_INTEGRATION_CALLBACK_PATH: str = "/v1/integrations/google-workspace/callback"

    @property
    def effective_google_workspace_client_id(self) -> str:
        return (self.GOOGLE_WORKSPACE_CLIENT_ID or self.GOOGLE_CLIENT_ID).strip()

    @property
    def effective_google_workspace_client_secret(self) -> str:
        return (self.GOOGLE_WORKSPACE_CLIENT_SECRET or self.GOOGLE_CLIENT_SECRET).strip()

    # Microsoft Entra ID directory read (identity evidence)
    ENTRA_CLIENT_ID: str = ""
    ENTRA_CLIENT_SECRET: str = ""
    ENTRA_INTEGRATION_CALLBACK_PATH: str = "/v1/integrations/entra/callback"

    # Outbound email (SMTP). Gmail: smtp.gmail.com:587 + app password.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = True
    MAIL_FROM: str = ""
    # Legacy alias — falls back when MAIL_FROM is empty.
    DIGEST_FROM: str = "hygiene@example.com"
    SUPPORT_EMAIL: str = "elazar.chodjayev@cloud-castles.com"
    RESEND_API_KEY: str = ""  # unused; kept so old .env files do not break load

    # Fernet key for encrypting role_arn + external_id at rest.
    # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    ENCRYPTION_KEY: str = ""

    # Local filesystem uploads (Trust Center logos in dev).
    LOCAL_UPLOAD_DIR: str = "data/uploads"

    # Public URL of the read-only CloudFormation template a customer launches
    # in their own AWS account. Must be fetchable by CloudFormation in the
    # customer's account (S3 object URL — GitHub raw URLs are not reliable).
    # Override in prod to pin a versioned object when the template changes.
    CFN_TEMPLATE_URL: str = (
        "https://amzn-s3-veritrail.s3.us-east-1.amazonaws.com/infra/veritrail-stack.yaml"
    )
    # Current version of the Veritrail connector template (bumped with each release).
    # Used by the UI to label CloudFormation update actions.
    CFN_TEMPLATE_VERSION: str = "2026.06"
    # Parent connector stack + IAM role names (nested child templates).
    CFN_STACK_NAME: str = "VeritrailAccountConnector"
    CFN_STACK_NAME_LEGACY: str = "VeritrailReadOnly"
    CFN_SCANNER_ROLE_NAME: str = "VeritrailScannerRole"
    # Legacy split-stack policy-gen role (pre-unified connector); derive_advanced_role_arn maps these.
    CFN_POLICY_GENERATION_ROLE_NAME: str = "VeritrailPolicyGenerationRole"
    CFN_SCANNER_ROLE_NAME_LEGACY: str = "VeritrailReadOnlyScannerRole"
    CFN_REMEDIATION_AUTOMATION_ROLE_NAME: str = "VeritrailRemediationAutomationRole"
    CFN_REMEDIATION_TEMPLATE_URL: str = (
        "https://amzn-s3-veritrail.s3.us-east-1.amazonaws.com/infra/2026.06/veritrail-remediation-ssm.yaml"
    )
    CFN_REMEDIATION_SSM_TEMPLATE_URL: str = (
        "https://amzn-s3-veritrail.s3.us-east-1.amazonaws.com/infra/2026.06/veritrail-remediation-ssm.yaml"
    )

    # CloudFormation console deep links (customer deploys connector stack).
    CFN_CONSOLE_REGION: str = "us-east-1"
    # Customer remediation automation home region.
    REMEDIATION_AUTOMATION_REGION: str = "us-east-1"
    REMEDIATION_SSM_DOCUMENT_NAME: str = "Veritrail-RemediationPlanExecutor"
    REMEDIATION_PLAN_TTL_MINUTES: int = 60

    # When True (default) hitting /v1/auth/{github,gitlab,google} *without*
    # a link_token creates a new user+org if no existing user matches the
    # IdP id or email. Set False to require explicit signup (recommended
    # once you have paying customers — prevents accidental fragmentation
    # when a user signs in via a personal IdP under a different email).
    ALLOW_SSO_SIGNUP: bool = True

    # Optional Ed25519 seed (32 bytes, base64) to sign evidence pack checksum manifests.
    # Generate: python -c "import base64,os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
    EVIDENCE_PACK_SIGNING_KEY: str = ""

    # Immutable evidence vault (WORM) — uploads on evidence-pack export when enabled.
    # Base S3 location for archived packs, e.g. s3://veritrail-worm-storage/veritrail
    EVIDENCE_VAULT_ENABLED: bool = False
    EVIDENCE_VAULT_S3_URI: str = ""
    EVIDENCE_VAULT_S3_REGION: str = ""
    EVIDENCE_VAULT_OBJECT_LOCK_MODE: str = "GOVERNANCE"
    EVIDENCE_VAULT_RETENTION_DAYS: int = 365
    # none | presigned | approved_link (future auditor read path)
    EVIDENCE_VAULT_AUDITOR_ACCESS_MODE: str = "none"

    # External evidence artifact storage (uploaded PDFs, exports). When set, files go to S3
    # instead of LOCAL_UPLOAD_DIR. Example: s3://amzn-s3-veritrail/external-evidence
    EVIDENCE_ARTIFACTS_S3_URI: str = ""
    EVIDENCE_ARTIFACTS_S3_REGION: str = ""
    EVIDENCE_ARTIFACTS_DOWNLOAD_TTL_SECONDS: int = 900
    EVIDENCE_ARTIFACTS_DEFAULT_EXPIRY_DAYS: int = 365
    # Purge rejected/expired artifact rows (+ S3 objects) older than this many days. 0 = keep rows.
    EVIDENCE_ARTIFACTS_RETENTION_DAYS: int = 0

    # Optional ClamAV INSTREAM scan before persisting uploaded evidence files.
    EVIDENCE_CLAMAV_ENABLED: bool = False
    EVIDENCE_CLAMAV_HOST: str = "127.0.0.1"
    EVIDENCE_CLAMAV_PORT: int = 3310
    # When true, uploads are rejected until ClamAV returns clean (no dev skip on scan failure).
    EVIDENCE_UPLOAD_QUARANTINE_ENABLED: bool = False

    # Go HCL patch binary (repo-aware Terraform PRs). Default: /usr/local/bin/hclpatch
    HCLPATCH_BIN: str = "/usr/local/bin/hclpatch"
    # Skip terraform fmt/validate when binary missing (dev only).
    TERRAFORM_VALIDATE_SKIP: bool = False

    # AI-assisted finding triage.
    AI_TRIAGE_ENABLED: bool = False
    AI_TRIAGE_API_URL: str = ""
    AI_TRIAGE_API_KEY: str = ""
    AI_TRIAGE_MODEL: str = "gpt-4o-mini"

    # GCP Workload Identity Federation (production cross-cloud access — no customer JSON keys).
    GCP_WIF_ISSUER_URI: str = ""  # defaults to {API_PUBLIC_URL}/v1/integrations/gcp/wif
    GCP_WIF_VERITRAIL_AUDIENCE: str = "veritrail-gcp"
    GCP_WIF_JWT_PRIVATE_KEY: str = ""  # PEM PKCS8 RSA; required when APP_ENV != dev
    GCP_WIF_JWT_KEY_ID: str = "veritrail-wif-1"
    GCP_WIF_DEFAULT_POOL_ID: str = "veritrail"
    GCP_WIF_DEFAULT_PROVIDER_ID: str = "veritrail-oidc"
    GCP_WIF_DEFAULT_SA_NAME: str = "veritrail-scanner"
    ALLOW_GCP_SA_JSON: bool = False  # legacy dev-only service account key upload

    # Veritrail platform SA — impersonates per-customer scanner SAs (service_account_impersonation auth).
    VERITRAIL_GCP_PLATFORM_SA_EMAIL: str = ""
    VERITRAIL_GCP_PLATFORM_SA_JSON: str = ""  # inline JSON; operator secret, not per-customer
    VERITRAIL_GCP_PLATFORM_SA_JSON_PATH: str = ""  # alternative to inline JSON


    @model_validator(mode="after")
    def _validate_secrets_not_default(self):
        if self.APP_ENV == "dev":
            return self
        if self.APP_SECRET == "dev-secret":
            raise ValueError("APP_SECRET must not be the dev default in non-dev environments")
        if self.JWT_SECRET == "dev-jwt":
            raise ValueError("JWT_SECRET must not be the dev default in non-dev environments")
        if not self.ENCRYPTION_KEY:
            raise ValueError("ENCRYPTION_KEY is required in non-dev environments")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
