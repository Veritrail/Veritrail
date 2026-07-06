# Finding drawer — resource multi-select (bulk exception + Jira ticket)

Spec for selecting multiple **resources** inside a finding drawer and acting on them at once:
bulk exception, and a single Jira ticket covering the selected resources. **Spec only — no code
in this doc.**

---

## Current model (verified)

A "finding" in the drawer is a **group of underlying `Finding` rows** — same `check_id`, one row
per affected resource (`resource_arn`). Everything below is **per-resource (per `Finding` row)**:

- **Exception:** `POST /v1/findings/{finding_id}/exception` ([`api/app/routes/findings.py:600`](../api/app/routes/findings.py)) — sets `status="excepted"` + reason/approver/expiry on **one** finding.
- **Jira ticket:** `POST /v1/integrations/jira/issues/from-finding/{finding_id}` ([`api/app/routes/jira_integration.py:429`](../api/app/routes/jira_integration.py)) — creates **one** Jira issue for **one** finding, stores `remediation_ticket_key` / `remediation_ticket_url` on that `Finding` row. `_finding_jira_issue` reads those columns back for the drawer badge (the `KAN-4` chip is that resource's ticket, **not** a group ticket).
- **Sync status:** `POST /v1/integrations/jira/issues/sync-from-finding/{finding_id}`.
- Resource rows rendered by [`FindingResourcesTab.tsx`](../web/src/components/FindingResourcesTab.tsx) (deduped by `resource_arn`). The drawer's footer **Create exception** / **View Ticket** act on the **focused** resource today.
- The Jira create UI is [`JiraFindingAction.tsx`](../web/src/components/JiraFindingAction.tsx) (`create` mutation, project/assignee pickers).

**Related but different — do not touch:** the Findings-page **bulk bar** ([`Findings.tsx`](../web/src/pages/Findings.tsx)) already multi-selects whole **finding groups** for except/resolve/export. That is a *coarser* grain (whole checks). This spec adds a *finer* grain (individual resources inside one drawer). Keep both.

---

## Goals

1. Multi-select resource rows in the finding drawer's Resources tab.
2. **Bulk exception** — except all selected resources in one action (bundles freely: an exception
   is a risk decision, not a work item).
3. **Bulk Jira ticket, default one ticket per resource.** A finding groups resources by `check_id`,
   which does **not** imply shared remediation or owner — e.g. "Encryption at rest not enforced"
   spans EBS + S3 + DynamoDB + CloudTrail, different services/teams/fixes. So the **default** is a
   **separate ticket per selected resource** (batched clicks, correct remediation grain, not spam —
   the user explicitly asked for tickets on those resources).
4. **Combined ticket = explicit opt-in.** When the selected resources genuinely share a fix (same
   type, one owner), the user may choose "one combined ticket." The system cannot detect relatedness,
   so this is a human choice, never the default.
5. Reuse existing per-finding endpoints/patterns where possible; add one batch endpoint only for the
   opt-in combined mode (a client loop can't express "one ticket, many findings").

---

## UX

### Resource rows

- Add a checkbox per resource row in [`FindingResourcesTab.tsx`](../web/src/components/FindingResourcesTab.tsx) (quiet until hover/checked, mirror the Findings-page row checkbox style).
- Header "select all / none" checkbox for the visible resource set.
- Selection state lives in the drawer (lifted from the tab), scoped to the current finding group; cleared when the drawer closes or the finding changes.

### Drawer action bar (appears when ≥1 resource selected)

A slim bar (mirror the Findings-page floating bulk bar), inside the drawer:

```
N selected   [ Except selected ]   [ Create tickets ▾ ]   [ Clear ]
```

- **Except selected** → inline reason + approver (same fields as single exception), then apply to all selected findings.
- **Create tickets** → opens the existing Jira project/assignee picker (`JiraFindingAction`) scoped to the selected findings, with a **mode toggle**:
  - **Separate ticket per resource** (default, pre-selected) → one Jira issue per selected finding.
  - **One combined ticket** → a single issue listing all selected resources. Show a hint next to it: "Use only when these resources share an owner/fix." Not the default.
- Buttons gated on `RequireEditor` role (same as single actions).
- The single-resource footer actions can stay for the focused-row case, or be replaced by "select this row → bar"; either is fine. Recommend keeping single-row actions and adding the bar for multi-select.

---

## Backend

### Exception — reuse per-finding endpoint (client loop)

No new endpoint. The Findings-page bulk bar already loops `POST /{finding_id}/exception` with
`Promise.allSettled` and reports partial failures ([`Findings.tsx` `runBulkExcept`](../web/src/pages/Findings.tsx)). Reuse the **same pattern** from the drawer over the selected finding ids.

- Optional (nice-to-have, defer): a real batch endpoint `POST /v1/findings/bulk-exception`
  (`{ finding_ids: [...], reason, approved_by, expires_at }`) for atomicity + one audit action.
  Not required for v1 — the client loop is acceptable and already proven.

### Jira — default: separate ticket per resource (client loop)

**Default mode needs no new endpoint.** Loop the existing
`POST /v1/integrations/jira/issues/from-finding/{finding_id}` over the selected finding ids with
`Promise.allSettled` (same batching pattern as bulk exception). Each selected resource gets its own
issue + its own `remediation_ticket_key`, exactly like creating them one by one — just fewer clicks.
Report per-finding success/failure; a partial failure must not block the rest.

- Rate-limit awareness: creating N issues hits the Jira API N times. Cap N (e.g. 50) and, if needed,
  throttle client-side. This is the same real cost as the user creating them manually.

### Jira — opt-in: **new** batch endpoint (one combined ticket)

Only for the explicit "One combined ticket" mode. A client loop can't produce one ticket, so add:

```
POST /v1/integrations/jira/issues/from-findings
body: { finding_ids: [uuid, ...], project_key, issue_type, assignee_account_id? }
```

Behavior:

1. Load the findings; verify all belong to the caller's org (reuse `_get_owned` / org check). Reject empty list → 400. Reject > N (e.g. 50) → 400 with a clear message.
2. Build **one** Jira issue:
   - Summary: the shared check title (e.g. "Least privilege policy violation — 2 resources").
   - Description: list every selected resource (`resource_arn` + per-resource reason), reuse `_issue_description` building blocks ([`jira_integration.py:158`](../api/app/routes/jira_integration.py)) extended to accept multiple resources / a checklist.
3. Create the issue once via the existing Jira client.
4. Set `remediation_ticket_key` + `remediation_ticket_url` on **every** selected finding (same key/url), and log a `FindingEvent` per finding. So each resource row shows the same ticket chip, and "View Ticket" works from any of them.
5. Return the issue key/url + count linked.

Notes:
- **Sync/unlink:** `sync-from-finding` and `clear_finding_remediation_ticket` already work per finding; because all selected findings share the same key, syncing any one reflects the shared ticket. Unlinking one finding only unlinks that row (others keep the link) — acceptable; document it.
- **Idempotency:** if some selected findings already have a ticket, either (a) skip those and link only the unlinked ones to the new issue, or (b) reject with 409 listing already-ticketed findings. Recommend (a) with a response field `skipped_already_linked: [...]`. Confirm in open questions.

### Cross-finding selection (Findings page) — unchanged

If multi-select ever spans **different checks** (different finding groups), keep **one ticket per
group** (different remediation). This spec is **within one drawer / one check** only, where a single
ticket is correct.

---

## Frontend files to touch

| File | Change |
|---|---|
| [`web/src/components/FindingResourcesTab.tsx`](../web/src/components/FindingResourcesTab.tsx) | Row checkboxes + header select-all; emit selected finding ids upward |
| [`web/src/components/FindingDrawer.tsx`](../web/src/components/FindingDrawer.tsx) | Hold selection state; render the drawer action bar; wire Except-selected (client loop) + Create-ticket-for-selected |
| [`web/src/components/JiraFindingAction.tsx`](../web/src/components/JiraFindingAction.tsx) | Accept a list of finding ids; call the new `from-findings` endpoint; keep single-finding path working |
| [`api/app/routes/jira_integration.py`](../api/app/routes/jira_integration.py) | New `POST /jira/issues/from-findings`; extend `_issue_description` for multiple resources |
| [`web/src/hooks/useJiraIssueStatus.ts`](../web/src/hooks/useJiraIssueStatus.ts) (if present) | Invalidate all affected findings' ticket status after batch create |

---

## Out of scope

- Findings-page bulk bar (whole-group grain) — unchanged.
- Auto-bundling a whole finding into one ticket by default (rejected — resources in a finding are
  grouped by `check_id`, not by owner/fix; combined is opt-in only).
- Cross-check single ticket (different checks stay separate regardless of mode).
- SSM remediation dispatch (`/{finding_id}/remediation/dispatch`) — single-finding, unchanged.
- Bulk resolve inside the drawer (resolve requires verification per finding; defer unless asked).
- Auto-grouping resources by type/owner into ticket sets (too clever; the user chooses separate vs
  combined).

---

## Test checklist

### Backend
- [ ] **Separate mode:** looping `from-finding` over N ids yields N distinct issues, each finding its own key
- [ ] **Separate mode:** a single-finding failure doesn't block the others (partial success)
- [ ] **Combined mode:** `from-findings` creates exactly one Jira issue for N finding ids
- [ ] **Combined mode:** all N findings get the same `remediation_ticket_key` / url + a `FindingEvent`
- [ ] Findings from another org rejected (404/403)
- [ ] Combined: empty list → 400; over-cap list → 400; description lists every selected resource_arn
- [ ] Combined: already-ticketed findings skipped (or 409 per chosen policy); response reports them
- [ ] Per-finding exception loop still marks each selected finding `excepted` with reason/approver

### Frontend
- [ ] Resource rows selectable; select-all works; selection clears on finding change / drawer close
- [ ] Action bar shows count; hidden when nothing selected
- [ ] Except selected → all selected rows become excepted; partial-failure surfaced
- [ ] Create tickets defaults to **Separate**; toggling to **Combined** is a deliberate action
- [ ] Separate → N chips (one per row, distinct keys); Combined → same chip on every row
- [ ] View Ticket works from any row in both modes
- [ ] Editor-role gating on both actions
- [ ] Single-row footer actions unaffected

---

## Open questions

Resolved for v1 (2026-07-06):

1. **Ticket default:** Separate per resource (default); Combined is opt-in with hint.
2. **Already-ticketed findings:** Skip already-linked rows in both modes; report `skipped_already_linked` (no 409 mid-batch).
3. **Cap:** 50 resources per batch (backend + UI).
4. **Exception batch:** Client loop via existing `POST /v1/findings/{finding_id}/exception` + `Promise.allSettled`.
5. **Combined description:** Checklist in Jira description (not sub-tasks).
6. **Bulk resolve:** Out of scope for drawer v1.
