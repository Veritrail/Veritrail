# Google Workspace identity integration

Read-only Admin Directory sync for identity governance evidence (MFA enforcement, inactive users, admin roster).

## Prerequisites

- A **Google Workspace** organization (not a personal `@gmail.com` account — Admin SDK requires a Workspace super-admin).
- A Google Cloud **OAuth 2.0 client** (Web application) with the Admin SDK API enabled.

## Redirect URIs (fix `redirect_uri_mismatch`)

OAuth callbacks hit the **API** host, not the Vite dev server. Google redirects to `API_PUBLIC_URL` + callback path on port **8000** in local dev — **not** `http://localhost:5173`.

In [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials** → your OAuth client → **Authorized redirect URIs**, register:

| Flow | Redirect URI |
|------|----------------|
| Google login (if same OAuth app) | `{API_PUBLIC_URL}/v1/auth/google/callback` |
| Workspace integration | `{API_PUBLIC_URL}/v1/integrations/google-workspace/callback` |

### Local dev (`API_PUBLIC_URL=http://localhost:8000`)

```
http://localhost:8000/v1/auth/google/callback
http://localhost:8000/v1/integrations/google-workspace/callback
```

Use `localhost`, not `127.0.0.1`, unless you also set `API_PUBLIC_URL=http://127.0.0.1:8000` — the redirect URI must match **exactly**.

### Production

```
https://api.your-domain.com/v1/integrations/google-workspace/callback
```

(`API_PUBLIC_URL` is set to `https://${API_DOMAIN}` by `scripts/bootstrap-ec2.sh`.)

## Environment variables

| Variable | Purpose |
|----------|---------|
| `GOOGLE_WORKSPACE_CLIENT_ID` | OAuth client ID. Falls back to `GOOGLE_CLIENT_ID` when empty. |
| `GOOGLE_WORKSPACE_CLIENT_SECRET` | OAuth client secret. Falls back to `GOOGLE_CLIENT_SECRET` when empty. |
| `GOOGLE_WORKSPACE_INTEGRATION_CALLBACK_PATH` | Default `/v1/integrations/google-workspace/callback`. Override with a full URL if needed. |
| `API_PUBLIC_URL` | Public API base used to build the redirect URI sent to Google. |

## OAuth scopes

The integration requests Admin Directory read-only scopes plus OpenID profile/email. The connecting user must be a **Workspace super-admin** with consent rights for those scopes.

## Code map

| Piece | Location |
|-------|----------|
| Routes | `api/app/routes/google_workspace_integration.py` |
| Token refresh | `api/app/services/google_workspace_tokens.py` |
| Directory sync | `api/app/services/google_workspace_sync.py` |
| UI | `web/src/pages/GoogleWorkspaceIntegration.tsx` |
