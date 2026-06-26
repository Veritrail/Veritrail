import time
import uuid
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.ratelimit import limiter

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.client_ip import client_ip_from_request
from app.routes import accounts, accounts_onboard, accounts_scan, accounts_remediate, accounts_analysis, findings, auth, auth_oauth, auth_saml, github_integration, gitlab_integration, google_workspace_integration, entra_integration, slack_integration, jira_integration, linear_integration, gcp_integration, azure_integration, scanner_integration, cloud_integration, integration_requests, iac, settings as settings_router, members
from app.routes import controls, exports, meta, public, domains, join_requests, audit_log
from app.routes import auditor, auditor_portal, trust_center

log = structlog.get_logger()
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_settings.cache_clear()
    # Seed compliance controls on every startup (idempotent upsert)
    try:
        from app.services.seed_controls import seed_controls
        db = SessionLocal()
        n = seed_controls(db)
        db.close()
        if n:
            log.info("controls.seeded", count=n)
        from app.services.composite_controls import assert_control_mapping_composite_coverage

        assert_control_mapping_composite_coverage()
    except Exception:
        log.exception("controls.seed_failed")
    yield


app = FastAPI(title="Veritrail API", version="0.1.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_cors_origins = [settings.FRONTEND_URL]
if settings.APP_ENV == "dev" and settings.FRONTEND_URL not in ("http://localhost:5173",):
    _cors_origins.append("http://localhost:5173")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if settings.APP_ENV != "dev":
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
            frontend_origin = (settings.FRONTEND_URL or settings.API_PUBLIC_URL).rstrip("/")
            response.headers["Content-Security-Policy"] = (
                "default-src 'none'; "
                "frame-ancestors 'none'; "
                "base-uri 'none'; "
                f"form-action 'self' {frontend_origin};"
            )
        return response


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Attach a request-id to every request, log start+end with timing.

    - Honours an inbound `X-Request-Id` header (proxy passthrough) if present
      and well-formed; otherwise generates a UUID4.
    - Echoes the id back on the response as `X-Request-Id` so clients can
      correlate.
    - Binds the id to structlog's contextvars so any log line emitted during
      this request automatically carries `request_id=`.
    - Emits a single `http.request` log line per request with method, path,
      status, duration_ms, and remote_addr. Health checks are silenced.
    """

    _MAX_ID_LEN = 64

    async def dispatch(self, request: Request, call_next) -> Response:
        inbound = request.headers.get("x-request-id", "")
        if inbound and 1 <= len(inbound) <= self._MAX_ID_LEN and inbound.replace("-", "").isalnum():
            request_id = inbound
        else:
            request_id = uuid.uuid4().hex

        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

        start = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        except Exception:
            log.exception(
                "http.request_failed",
                method=request.method,
                path=request.url.path,
            )
            raise
        finally:
            duration_ms = int((time.perf_counter() - start) * 1000)
            # silence health-check noise
            if request.url.path not in ("/healthz",):
                log.info(
                    "http.request",
                    method=request.method,
                    path=request.url.path,
                    status=status_code,
                    duration_ms=duration_ms,
                    remote=client_ip_from_request(request),
                )
            # tag the response so clients/proxies can correlate
            try:
                response.headers["X-Request-Id"] = request_id  # type: ignore[unbound-local]
            except Exception:  # noqa: BLE001
                pass
            structlog.contextvars.unbind_contextvars("request_id")


app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestLoggingMiddleware)

_upload_root = Path(settings.LOCAL_UPLOAD_DIR)
_upload_root.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_upload_root)), name="uploads")


@app.get("/healthz")
def healthz():
    return {"ok": True, "env": settings.APP_ENV}


app.include_router(auth.router, prefix="/v1/auth", tags=["auth"])
app.include_router(auth_oauth.router, prefix="/v1/auth", tags=["auth"])
app.include_router(auth_saml.router, prefix="/v1/auth", tags=["auth"])
app.include_router(accounts.router, prefix="/v1/accounts", tags=["accounts"])
app.include_router(accounts_onboard.router, prefix="/v1/accounts", tags=["accounts"])
app.include_router(accounts_scan.router, prefix="/v1/accounts", tags=["accounts"])
app.include_router(accounts_remediate.router, prefix="/v1/accounts", tags=["accounts"])
app.include_router(accounts_analysis.router, prefix="/v1/accounts", tags=["accounts"])
app.include_router(findings.router, prefix="/v1/findings", tags=["findings"])
app.include_router(iac.router, prefix="/v1/iac", tags=["iac"])
app.include_router(settings_router.router, prefix="/v1/settings", tags=["settings"])
app.include_router(domains.router, prefix="/v1/domains", tags=["domains"])
app.include_router(join_requests.router, prefix="/v1/join-requests", tags=["join-requests"])
app.include_router(controls.router, prefix="/v1/controls", tags=["controls"])
app.include_router(exports.router, prefix="/v1/exports", tags=["exports"])
app.include_router(meta.router, prefix="/v1/meta", tags=["meta"])
app.include_router(public.router, prefix="/v1/public", tags=["public"])
app.include_router(auditor.router, prefix="/v1/auditor", tags=["auditor"])
app.include_router(members.router, prefix="/v1/members", tags=["members"])
app.include_router(audit_log.router, prefix="/v1/audit-log", tags=["audit-log"])
app.include_router(auditor_portal.router, prefix="/auditor", tags=["auditor-portal"])
app.include_router(trust_center.router, prefix="/trust", tags=["trust-center"])
app.include_router(github_integration.router, prefix="/v1/integrations", tags=["integrations"])
app.include_router(gitlab_integration.router, prefix="/v1/integrations", tags=["integrations"])
app.include_router(google_workspace_integration.router, prefix="/v1/integrations", tags=["integrations"])
app.include_router(entra_integration.router, prefix="/v1/integrations", tags=["integrations"])
app.include_router(slack_integration.router, prefix="/v1/integrations", tags=["integrations"])
app.include_router(jira_integration.router, prefix="/v1/integrations", tags=["integrations"])
app.include_router(linear_integration.router, prefix="/v1/integrations", tags=["integrations"])
app.include_router(gcp_integration.router, prefix="/v1/integrations", tags=["integrations"])
app.include_router(gcp_integration.wif_router, prefix="/v1/integrations/gcp/wif", tags=["integrations"])
app.include_router(azure_integration.router, prefix="/v1/integrations", tags=["integrations"])
app.include_router(scanner_integration.router, prefix="/v1/integrations", tags=["integrations"])
app.include_router(cloud_integration.router, prefix="/v1/integrations", tags=["integrations"])
app.include_router(integration_requests.router, prefix="/v1/integrations", tags=["integrations"])
