# SAML 2.0 Enterprise SSO — dark/internal

**Search terms:** SAML, SSO, Entra ID, Azure AD, `auth_saml.py`, `OrgSamlConfig`, ACS, IdP, `python3-saml`, xmlsec, migration 0045

SAML is backend-capable but intentionally hidden from the product UI. Veritrail's current product boundary is AWS-native SOC 2 CC6/CC7 evidence and evidence packs, not enterprise identity administration.

> **Status:** dark/internal. Code-complete, **not yet tested against a live IdP**, and not part of the current launch surface. Do one real round-trip (Entra ID or Azure AD) in staging before exposing this to users. See [Limitations](#limitations).

## Code map

| Piece | Location |
|-------|----------|
| Model | `api/app/models/saml.py` → `OrgSamlConfig` |
| Migration | `api/migrations/versions/0045_org_saml_config.py` |
| Routes | `api/app/routes/auth_saml.py` |
| Admin UI | Hidden; `web/src/components/SamlSettings.tsx` remains unused dark code |
| Login entry | Hidden; no visible SAML login button |
| Tests | `api/tests/test_saml_acs.py` |

Endpoints (mounted under `/v1/auth`):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/auth/saml/{slug}/metadata` | SP metadata XML (give to IdP) |
| GET | `/v1/auth/saml/{slug}/login` | Start SP-initiated login → redirect to IdP |
| POST | `/v1/auth/saml/{slug}/acs` | Assertion Consumer Service (IdP posts here) |
| GET/PUT | `/v1/auth/saml/config` | Authenticated per-org admin config |

## 1. One-time deploy (only if intentionally re-enabled)

The native crypto dependency (`python3-saml` → `xmlsec`/`libxml2`) is in the Dockerfile and `requirements.txt` but **not in the currently-running image**. Until rebuilt, every SAML route returns `503 "SAML support is not installed on this server"`.

```bash
# 1. Rebuild the API image (pulls xmlsec/libxml2 + python3-saml)
docker compose build api

# 2. Apply migration 0045 (creates org_saml_configs)
docker compose run --rm api alembic upgrade head

# 3. Restart
docker compose up -d api
```

Required env (already in config defaults — confirm for prod in `api/app/core/config.py`):

| Var | Meaning |
|-----|---------|
| `API_PUBLIC_URL` | Public **https** base of the API, e.g. `https://api.veritrail.example.com`. Used to build SP entity ID / ACS URLs and the SAML audience — must match what the IdP is told. |
| `FRONTEND_URL` | Where ACS redirects after login (`{FRONTEND_URL}/auth/callback?token=…`). |
| `ALLOW_SSO_SIGNUP` | `true` = provision unknown emails on first SAML login. `false` = only pre-existing users may log in. |

## 2. Configure an org (admin, hidden feature)

The Settings UI does not expose SAML. If this is re-enabled for a specific customer, restore the hidden admin UI or configure through the API:

| Field | Value |
|-------|-------|
| Organization slug | URL-safe id used in the login URL, e.g. `acme` (3–60 chars: `a-z 0-9 -`). |
| IdP entity ID / issuer | From the IdP metadata. |
| IdP SSO URL | IdP's HTTP-Redirect SSO endpoint. |
| IdP x509 signing certificate | The IdP's public signing cert (PEM body). |
| Enable | Turn on once the above are set and tested. |

After saving, the **Service provider details** card shows the four values to hand to the IdP admin (also fetchable at the metadata URL):

- **SP entity ID** — `{API_PUBLIC_URL}/v1/auth/saml/{slug}/metadata`
- **ACS (reply) URL** — `{API_PUBLIC_URL}/v1/auth/saml/{slug}/acs`
- **Metadata URL** — same as SP entity ID (serves the XML)
- **Login URL** — `{API_PUBLIC_URL}/v1/auth/saml/{slug}/login`

## 3. Configure the IdP

NameID format expected: **emailAddress**. If the IdP can't send an email NameID, send email as an attribute — the ACS accepts `email`, `Email`, `mail`, `user.email`, `urn:oid:0.9.2342.19200300.100.1.3`, or the WS-Fed `.../emailaddress` claim.

### Entra ID (SAML 2.0 enterprise app)
- Single sign-on URL → **ACS URL**
- Audience URI (SP Entity ID) → **SP entity ID**
- Name ID format → EmailAddress; Application username → Email
- Copy the IdP **Entity ID** → *IdP entity ID*, **Sign-On URL** → *IdP SSO URL*, **x509 cert** → *certificate*.

### Azure AD (Enterprise app → SAML)
- Identifier (Entity ID) → **SP entity ID**
- Reply URL (ACS) → **ACS URL**
- Unique User Identifier (Name ID) → `user.mail`
- From "SAML Certificates" copy the **Login URL** → *IdP SSO URL*, **Azure AD Identifier** → *IdP entity ID*, and the **Certificate (Base64)** → *certificate*.

## 4. How users sign in

SP-initiated only: **/login ▸ "Sign in with SSO" ▸ enter workspace slug** → redirected to the IdP → back to the ACS → logged in.

Behavior:
- **JIT provisioning** (when `ALLOW_SSO_SIGNUP=true`): unknown email → new user created in that org with role `member`.
- **MFA** is delegated to the IdP. Local TOTP is *not* additionally enforced on SAML logins.
- **Email is globally unique.** If the asserted email already belongs to a *different* org, login is rejected (`saml_email_other_org`) — that identity can't be claimed by another workspace.

## 5. Security notes

- `strict` mode on; `wantAssertionsSigned` true. Signature, audience, destination, and time conditions are validated by `python3-saml`.
- `_prepare_request` reads `X-Forwarded-Proto` / `X-Forwarded-Host`, so destination/audience checks reconstruct the **public https** URL behind the Caddy/nginx TLS proxy. The proxy must set those headers (it does for the existing OAuth flows).
- The IdP cert is public; stored plaintext (no decryption needed).

## Limitations

- **Untested against a live IdP.** Unit tests (`tests/test_saml_acs.py`) mock the OneLogin auth object — they cover provisioning/redirect/error logic, **not** signature/crypto validation. Do a real Entra/Azure round-trip before going live.
- **Replay protection = assertion `NotOnOrAfter` only.** No one-time-use assertion-ID store yet — a captured assertion could be replayed within its (short) validity window. Add ID tracking before high-assurance use.
- **SP-initiated only** — no IdP-initiated login.
- **No SLO** (single logout); sessions are local JWT + refresh cookie as with OAuth.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `503 SAML support is not installed` | Image not rebuilt with `python3-saml`. Run step 1. |
| `404 SAML is not configured` | No `OrgSamlConfig` for that slug, or `enabled=false`. |
| `/login?error=saml_invalid_response` | Signature/audience/destination/time check failed. Check the IdP cert, that ACS/entity ID match exactly, and that the proxy sets `X-Forwarded-Proto: https`. |
| `…saml_no_email` | IdP didn't send an email NameID or a recognized email attribute. |
| `…saml_email_other_org` | That email already exists in a different org. |
| `…no_account_for_idp` | `ALLOW_SSO_SIGNUP=false` and the user doesn't exist yet. |
| Destination mismatch in logs | `API_PUBLIC_URL` doesn't match the host the IdP posts to, or `X-Forwarded-*` not forwarded. |
