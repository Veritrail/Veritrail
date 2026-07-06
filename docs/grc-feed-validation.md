# GRC feed — validation spike (do this before building)

**Goal:** answer one binary question before any product build — *can Veritrail push a control-mapped
evidence artifact into Vanta / Drata / Scytale so it counts as usable audit evidence?*

Best case = automated feed (a strong distribution wedge). Worst case = export-only (Vanta/Drata-ready
ZIP + upload instructions), still a real product. Either way, **validate first — do not build the
destination abstraction, mapping table, or schema until the push works on one platform.**

**Spec only — no product code in this doc.**

---

## What the public docs already tell us (2026-07)

- **Vanta** — has a public API. Evidence model: documents are tied to an **"Evidence Request,"** and
  each evidence request maps to compliance controls. You can **upload a file to a document** via API
  (scope `vanta-api.documents:upload`). So the feed shape exists: *find the control-mapped evidence
  request → upload the artifact to it.* Confirm the exact attach-to-control behavior in the sandbox.
  ([developer hub](https://developer.vanta.com/docs/quickstart/manage-vanta),
  [managing documents](https://help.vanta.com/en/articles/11345479-managing-documents),
  [automated test evidence](https://help.vanta.com/en/articles/11345529-automated-test-evidence))
- **Drata** — has a robust public API with an **"Automate Evidence Submission"** recipe, self-serve
  API keys (admin creates, read/write scopes, 500 req/min). The clearest *documented* upload path is
  **personnel/user-scoped** evidence — confirm whether control-level (non-personnel) evidence upload
  is supported before assuming full feed.
  ([public API](https://help.drata.com/en/articles/6695964-drata-public-api),
  [automate evidence submission](https://help.drata.com/en/articles/11825486-part-2-automate-evidence-submission),
  [developer portal](https://developers.drata.com/))
- **Scytale** — smaller; least public API surface. Highest *manual pain* (Jira + screenshots) but
  likely the weakest push API. Expect the inverse correlation: most pain ↔ least API.

**Read the full API reference first — it may answer "is it possible" for free, before you need any account.**

---

## The one test (per platform)

One evidence object → one SOC 2 control → confirm it lands and counts. Binary.

1. Get admin API access to a sandbox/instance (see [Access](#access-how-to-get-a-test-account)).
2. Read: list controls / evidence requests / tests; find the CC6.1 (or similar) target.
3. Push: upload one Veritrail artifact (a real control folder from an evidence pack — findings +
   exceptions + provenance) and attach/map it to that control.
4. Verify the three things that actually matter:
   - **Attaches to the control** (not just dumped in a generic document library).
   - **Auditor-visible** — shows up where the auditor reviews evidence, not just an internal upload.
   - **Counts** — moves the control toward satisfied / shows as evidence, with a collection date.
5. Then the durability checks: can you **update/supersede** the same evidence idempotently (re-push
   next quarter without dupes)? Can you **read sync status/errors**?

**Pass = all of 4 + idempotent supersede. Anything less → export-only fallback, revisit push later.**

---

## Per-platform capability checklist

Mark each Yes / No / Partial from docs first, then confirm in sandbox:

- [ ] Create / upload an evidence object (file or URL)
- [ ] Attach it to a specific **control / test** (not just a document library)
- [ ] Set framework + control mapping (SOC 2 CC IDs)
- [ ] Set collection date / evidence period
- [ ] Set source system / owner / reviewer (provenance)
- [ ] Update / supersede existing evidence idempotently
- [ ] Read existing controls + current evidence + sync errors
- [ ] Evidence is **auditor-visible** and **counts** toward the control
- [ ] API key is **self-serve** (admin mints it) vs **partner-approval-gated**

If the API only allows "upload a generic file to a document library" with no control mapping →
feed mode is weak; export-only is the play.

---

## Access — how to get a test account

Neither Vanta nor Drata has open self-serve signup (both sales-led). **But you do NOT need their
approval to test the API** — you need an *account with admin access* to mint an API key. Options,
fastest first:

1. **Design-partner customer (best).** A company already on Vanta/Drata mints a scoped API key and
   lets you test against their instance. Zero cost, zero vendor approval (the customer owns their
   data + API), fastest, and it doubles as your first reference customer / gap-map source.
2. **Vendor sandbox / trial via sales.** Contact Vanta/Drata sales, say you're building an evidence
   integration, ask for a sandbox. May grant, may route you to their partner program.
3. **Partner / integrations program.** Only needed for an *official listed* marketplace integration —
   **not** for validation. Slower (application + review). Don't block the spike on it.
4. **Docs-only, step zero (free, now).** The API reference alone answers "does an attach-to-control
   evidence endpoint exist." Do this before chasing any account.

**Do not pay for a seat just to validate** — a design-partner key or the docs answer it. Payment /
partner approval is a *later* concern for the productized integration, not the spike.

Scytale: no clear public API — you'll likely have to contact them directly. Given the inverse-
correlation risk, treat Scytale as "confirm by asking," not "test via docs."

---

## Sizing willingness-to-pay (run alongside the API test)

The customer already pays the GRC tool. Your budget = **manual-collection hours you eliminate.**
Build a gap map with a design partner:

| Control area | Manual today in Vanta/Drata? | Veritrail auto-produces? | Feed value |
|---|---|---|---|
| Cloud config (S3/MFA/encryption) | Often auto-tested | Yes (+ resource detail) | Low — overlap |
| Change management / PR reviews (CC8) | Usually manual | Yes (Git evidence) | **High** |
| Access reviews | Usually manual | Partial | **High** |
| Exceptions (approver/reason/expiry) | Manual tracking | Yes | **High** |
| Point-in-time config snapshots | Manual screenshots | Yes | **High** |
| Multi-cloud (GCP/Azure) gaps | Varies | Yes | Medium–High |
| Blast radius / remediation trail | Not available | Yes (only in Veritrail) | **Unique** |

Lead the pitch (and the feed) with the **High/Unique** rows — the fully-manual controls — not cloud
config the GRC tool already auto-tests. The number that sells: "you screenshot ~N controls per
quarter; we eliminate ~M." Get N and M from the design partner.

---

## Decision gate

- **Push works (attaches to control, auditor-visible, counts, idempotent)** → build the destination
  adapter (`EvidenceSource → NormalizedEvidence → ControlMapping → DestinationAdapter`), the control-
  mapping UI, and sync-status. Feed becomes a real channel.
- **Push is weak / gated / read-only** → ship **export-only**: a Vanta/Drata-ready ZIP, one file per
  control, a CSV control-mapping, and upload instructions. Still kills the *collection* pain (the hard
  part). Revisit push when partner access is worth it.

Either outcome is shippable. The spike just tells you which product you're building — so run it before
writing the adapter.
