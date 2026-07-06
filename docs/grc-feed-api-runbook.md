# GRC feed — API runbook (Vanta + Drata)

Concrete API details pulled from the live developer docs (2026-07), plus how to get a **free** account
to actually run the push test. Use this with [`grc-feed-validation.md`](./grc-feed-validation.md) — that
doc is the *why/what-counts*, this is the *how, with real calls*.

**Bottom line up front:**
- **Vanta** — cleaner evidence→control model: upload a file to a **document** that's tied to an
  evidence request mapped to controls. Auth is OAuth2 client-credentials.
- **Drata** — more indirect: push data via a **custom connection → resource → records**, then map a
  **custom test** to a control. Auth is a self-serve bearer API key. More steps to reach "counts for
  control CC6.1."
- **Neither has self-serve signup.** Both are sales-gated. Fastest free path = a **design-partner
  customer's account** (they mint the token/key). Drata also grants a **free trial, no credit card**,
  via a short sales touch.

---

## Vanta

**Docs:** [developer hub](https://developer.vanta.com/docs/quickstart/manage-vanta) ·
[managing documents](https://help.vanta.com/en/articles/11345479-managing-documents)

### Access / free account
- No self-serve signup. Account via sales demo/trial, or a design partner.
- Once in an account: **Settings → Developer Console** → create an OAuth app → get `client_id` +
  `client_secret`. That's all you need for the API.

### Auth — OAuth2 client credentials
- Base URL: `https://api.vanta.com`
- Token endpoint: `POST https://api.vanta.com/oauth/token` (token lives ~1 hour)
- Scopes: `vanta-api.all:read` (read frameworks/documents), `vanta-api.documents:upload` (attach evidence)

```bash
curl --location 'https://api.vanta.com/oauth/token' \
  --header 'Content-Type: application/json' \
  --data '{
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET",
    "scope": "vanta-api.all:read vanta-api.documents:upload",
    "grant_type": "client_credentials"
  }'
# -> { "access_token": "...", "expires_in": 3600 }
```

### The push test (evidence → control)
Model: **documents** are tied to **evidence requests**, and each evidence request maps to compliance
controls. So: list documents filtered by framework → find the SOC 2 one you want → upload your
artifact to it.

```bash
# 1. Find the target document (SOC 2, e.g. an access-control evidence request)
curl 'https://api.vanta.com/v1/documents?frameworkMatchesAny=soc2&pageSize=25' \
  --header 'Authorization: Bearer YOUR_TOKEN'
# response items include: id, title, category, uploadStatus, url (dashboard deep link)

# 2. Attach your Veritrail artifact to that document
curl -X POST 'https://api.vanta.com/v1/documents/{documentId}/upload' \
  --header 'Authorization: Bearer YOUR_TOKEN' \
  --form 'file=@veritrail-CC6.1-evidence.pdf'
```

Also useful: `GET /v1/frameworks` (list active frameworks), `POST /v1/documents` (create a document).

### What to confirm in the sandbox
- Uploaded file shows on the document's **control(s)** (via the evidence request mapping), not just a
  generic library.
- It's **auditor-visible** and moves the control toward satisfied.
- Re-uploading **supersedes** cleanly (no dupes) — check `uploadStatus` behavior.

---

## Drata

**Docs:** [public API](https://help.drata.com/en/articles/6695964-drata-public-api) ·
[automate evidence submission](https://help.drata.com/en/articles/11825486-part-2-automate-evidence-submission) ·
[developer portal](https://developers.drata.com/)

### Access / free account
- No self-serve signup, but **free trial with no credit card** via sales request — quickest
  vendor-granted sandbox. Or a design-partner customer's account.
- API key is **self-serve inside the account**: **Settings → API Keys → Create API Key**. Set name
  (immutable), expiry (12mo default / Never / custom), optional IP allowlist, scopes (All read /
  All read+write / Custom). **Key shown once — save it.**

### Auth — bearer API key
- Base URL: `https://public-api.drata.com/public`
- Header: `Authorization: Bearer YOUR_API_KEY`, `Content-Type: application/json`
- Rate limit: **500 req/min per source IP**

### The push test (custom connection → records → custom test → control)
Drata's programmatic evidence path is the **custom-connections** model — you push resource records,
then map a **custom test** to a control that evaluates them. More indirect than Vanta.

```bash
# List controls to find your target (e.g. SOC 2 CC6.1)
curl 'https://public-api.drata.com/public/controls' \
  --header 'Authorization: Bearer YOUR_API_KEY'

# Submit evidence records into a custom connection resource
curl -X POST 'https://public-api.drata.com/public/custom-connections/{connectionId}/resources/{resourceId}/records' \
  --header 'Authorization: Bearer YOUR_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "data": { "resource_arn": "arn:aws:s3:::example", "status": "pass", "collected_at": "2026-07-06" }
  }'
```

Then, in Drata, **Create/Run/Map a Custom Test** that reads those records and maps to the control.
(The record→control link is via the custom test, not a direct field on the upload.)

### What to confirm in the sandbox
- Whether you can attach evidence to a **control/requirement** directly, or only via the custom
  connection + custom test path (the docs show the latter as the automated route).
- Whether pushed records **count** toward the control and are **auditor-visible**.
- Idempotent re-submission (upsert on record id) so quarterly re-push doesn't duplicate.

---

## Scytale

No clear public API. Sales-led. You named it as heavily manual (Jira + screenshots) — highest pain,
but likely the weakest/absent push API. **Confirm by asking their team; don't expect a docs-testable
API.** Treat as export-only unless they surprise you.

---

## Free-access reality (all three)

| Platform | Self-serve signup? | Free path to test | API access |
|---|---|---|---|
| **Vanta** | No | Sales demo/trial, or design-partner account | OAuth app in Developer Console (self-serve in-account) |
| **Drata** | No | **Free trial, no credit card** (sales request), or design-partner account | API key self-serve in Settings |
| **Scytale** | No | Contact sales | Unknown / likely none |

**Fastest, zero-cost, zero-approval:** a design partner already on Vanta or Drata mints you a scoped
token/key against **their** instance — no vendor approval (they own their data), and it doubles as your
first reference customer. If no design partner: Drata's free no-CC trial is the quickest self-obtained
sandbox.

**Do not pay or join a partner program to validate.** Partner programs are for an *official listed*
integration later — not for the spike.

---

## Suggested order

1. **Drata free trial (no CC) or a design partner** → mint API key → run the custom-connection push +
   custom-test map. Confirm it reaches a control.
2. **Vanta** (design partner or trial) → OAuth app → upload to a SOC 2 evidence-request document.
   Vanta's model is more directly "evidence → control," so it's the cleaner proof of the thesis.
3. **Scytale** → email them; treat as export-only until proven otherwise.

Run the [validation checklist](./grc-feed-validation.md#per-platform-capability-checklist) against each.
Pass on **one** platform (attaches to control, auditor-visible, counts, idempotent) → build the
destination adapter. Otherwise → ship export-only.
