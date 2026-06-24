# History page — dashboard + graphs (deepsearch)

**Search terms:** History page, `/history`, ComplianceHistory, dashboard, graphs, compliance timeline, posture trend

**User goal:** History should feel like a **compliance dashboard** (KPIs + charts), not only a vertical event list.

## Current implementation (session 29+)

| Piece | Path | Role |
|-------|------|------|
| Page | `web/src/pages/ComplianceHistory.tsx` | Framework / period / account filters |
| **Dashboard** | `web/src/components/HistoryDashboard.tsx` | KPI cards, control status bar, change sparkline, trend chart |
| Trend chart | `web/src/components/ComplianceTrendChart.tsx` | Posture % line + findings-opened bars (SVG, no chart lib) |
| Timeline list | `ComplianceHistory.tsx` | Audit timeline cards + evidence drawer |
| API | `GET /v1/accounts/{id}/compliance-timeline?framework=&days=&limit=` | `compliance_scan_timeline.py` |

### API fields used by dashboard

| Field | Meaning |
|-------|---------|
| `current_posture_score` | Latest pass rate % |
| `current_summary` | `{ controls_passed, controls_failed, controls_no_data }` |
| `period_summary` | `{ compliance_changes, controls_regressed, controls_improved }` |
| `scan_count` | Successful scans in window (all runs, not only posture-changing) |
| `events[]` | Posture-changing snapshots only (baseline + diffs) |

## UX layout (target)

```
┌ KPI row: score | failing | improved | regressed | scans ─────────┐
├ Control status bar (pass/fail/no-data) │ Changes sparkline ─────┤
├ ComplianceTrendChart (score line + findings bars) ──────────────┤
└ Audit timeline (collapsible / secondary) ───────────────────────┘
```

## Gaps / deepsearch should suggest next

| Idea | Effort | Notes |
|------|--------|-------|
| **Per-control sparklines** | Medium | Needs time-series per `control_id` in API (today: event diffs only) |
| **Scan cadence heatmap** | Low | `scan_runs.started_at` by day — shows coverage gaps for Type II |
| **Framework comparison** | Medium | Overlay SOC2 vs CIS scores (multi-series chart) |
| **Export dashboard PNG/PDF** | Medium | Auditor slide — reuse `pdf_report.py` patterns |
| **recharts / visx** | Low decision | Today: inline SVG to avoid deps; evaluate if interaction needs grow |
| **Demote timeline default** | Low UX | Dashboard first; timeline accordion collapsed on mobile |
| **Infrastructure overlay** | Partial | `infrastructure_events_count` on events — could be second chart series |
| **Empty state** | Done | Dashboard KPIs still show when scans ran but no control flips |

## Anti-patterns

- Do not replace History with raw CloudTrail list (`Timeline.tsx` is demoted; compliance story lives here).
- Do not chart every scan if posture unchanged — API already filters to meaningful events; use `scan_count` for volume.

## Related

- [deepsearch-v4-map.md](./deepsearch-v4-map.md) — History row
- `api/app/services/compliance_timeline.py` — control-level history for Controls drawer
- `README.md` — launch scope and current architecture
