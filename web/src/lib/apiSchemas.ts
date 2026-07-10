import { z } from "zod";
import type { ApiInit } from "../api";
import type { ComplianceHistoryResponse } from "./complianceHistory";

/** Thrown when an API response does not match its Zod schema (dev only). */
export class ApiValidationError extends Error {
  readonly path: string;
  readonly issues: z.ZodIssue[];

  constructor(path: string, issues: z.ZodIssue[]) {
    super(`API response validation failed for ${path}`);
    this.name = "ApiValidationError";
    this.path = path;
    this.issues = issues;
  }
}

/** Paths already reported this session — one log per path, not one per refetch. */
const _reportedValidationPaths = new Set<string>();

/** Validate JSON at the fetch boundary; warn and pass through on mismatch (never throw). */
export function parseApiResponse<T>(path: string, schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  if (!_reportedValidationPaths.has(path)) {
    _reportedValidationPaths.add(path);
    const issues = result.error.issues;
    const summary = issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("  |  ");
    const extra = issues.length > 3 ? `  (+${issues.length - 3} more)` : "";
    console.warn(`[api] schema drift on ${path} — ${summary}${extra}`);
    if (import.meta.env.DEV) {
      console.debug("[api] full validation issues for", path, issues);
    }
  }
  return data as T;
}

/** In dev mode, warn once when a GET call omits a schema. Surfaces untyped boundaries. */
const _reportedMissingSchemaPaths = new Set<string>();

export function warnMissingSchema(path: string, init?: ApiInit): void {
  if (import.meta.env.DEV && !init?.schema) {
    const method = (init?.method ?? "GET").toUpperCase();
    if (
      method === "GET" &&
      !path.includes("export") &&
      !path.includes("download") &&
      !_reportedMissingSchemaPaths.has(path)
    ) {
      _reportedMissingSchemaPaths.add(path);
      console.warn(`[api] missing schema for GET ${path}`);
    }
  }
}

const orgRole = z.enum(["owner", "admin", "editor", "viewer"]);
const evidenceRole = z.enum(["contributor", "reviewer", "auditor-viewer"]);

export const accessTokenSchema = z.object({
  access_token: z.string(),
});

export const tokenPairSchema = accessTokenSchema.extend({
  refresh_token: z.string().optional(),
});

export const meSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  role: orgRole,
  evidence_role: evidenceRole,
  org_id: z.string(),
  org_name: z.string(),
  has_workspace: z.boolean().default(true),
  github_id: z.string().nullable().optional(),
  gitlab_id: z.string().nullable().optional(),
  google_id: z.string().nullable().optional(),
  totp_enabled: z.boolean().optional(),
  has_password: z.boolean().optional(),
  mfa_backup_codes_remaining: z.number().optional(),
});

export type Me = z.infer<typeof meSchema>;

// `.passthrough()` is required: the Accounts page shares this query cache
// (queryKey ["accounts"]) but needs the richer fields (remediation_modules,
// cfn_*, …). Without passthrough, Zod strips them, so when the Accounts page
// renders from a cache entry the lean Layout query populated first, those
// fields are undefined and CapabilityBadges crashes.
export const accountSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    account_id: z.string().nullable(),
    status: z.string(),
    external_id: z.string().optional(),
    pending_external_id: z.string().nullable().optional(),
    external_id_rotation_requested_at: z.string().nullable().optional(),
    role_arn: z.string().nullable().optional(),
    enable_advanced_policy_generation: z.boolean().optional(),
    last_scan_at: z.string().nullable().optional(),
  })
  .passthrough();

export const accountListSchema = z.array(accountSchema);

export type Account = z.infer<typeof accountSchema>;

export const findingSchema = z
  .object({
    id: z.string(),
    // GCP/Azure findings use gcp_project_id / azure_subscription_id; account_id is null or omitted.
    account_id: z.string().nullish(),
    aws_account_id: z.string().nullish(),
    account_label: z.string().nullish(),
    account_name: z.string().nullish(),
    account_provider: z.string().optional(),
    check_id: z.string(),
    resource_arn: z.string(),
    title: z.string(),
    severity: z.string(),
    risk_score: z.coerce.number(),
    status: z.string(),
    evidence: z
      .record(z.string(), z.unknown())
      .nullish()
      .transform((value) => value ?? {}),
    first_seen: z.string(),
    last_seen: z.string(),
    exception_reason: z.string().nullish(),
    exception_approved_by: z.string().nullish(),
    exception_expires_at: z.string().nullish(),
  })
  .passthrough();

export const findingPageSchema = z.object({
  items: z.array(findingSchema).default([]),
  total: z.number().optional().default(0),
  next_cursor: z.string().nullish(),
});

export type FindingPage = z.infer<typeof findingPageSchema>;

export const findingSummarySchema = z.object({
  total: z.number(),
  by_status: z.record(z.string(), z.number()).default({}),
  by_severity: z.record(z.string(), z.number()).default({}),
  top_checks: z
    .array(z.object({ check_id: z.string(), count: z.number() }).passthrough())
    .default([]),
});

export type FindingSummary = z.infer<typeof findingSummarySchema>;

export const trustCenterSettingsSchema = z.object({
  is_enabled: z.boolean(),
  subdomain_slug: z.string().nullable(),
  company_name: z.string().nullable(),
  company_logo_url: z.string().nullable(),
  frameworks_to_show: z.array(z.string()),
  custom_message: z.string().nullable(),
  configured: z.boolean(),
  last_updated_at: z.string().nullable(),
});

export type TrustCenterSettings = z.infer<typeof trustCenterSettingsSchema>;

export const auditorAccessSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  access_token: z.string(),
  expires_at: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
  last_accessed_at: z.string().nullable(),
});

export const auditorListSchema = z.array(auditorAccessSchema);

export const evidenceExportSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  framework: z.string(),
  period_days: z.number(),
  as_of: z.string().nullable(),
  report_id: z.string().nullable(),
  zip_sha256: z.string(),
  file_size_bytes: z.number(),
  vault_s3_uri: z.string().nullable(),
  created_at: z.string(),
});

export const evidenceExportListSchema = z.array(evidenceExportSchema);

/** Public key for verifying pack_signature.json (GET /v1/meta/evidence-pack-signing-key). */
export const signingKeySchema = z.object({
  enabled: z.boolean(),
  key_id: z.string(),
  algorithm: z.string(),
  public_key_base64: z.string().nullable(),
});
export type SigningKey = z.infer<typeof signingKeySchema>;

export const scopedExportLinkSchema = z.object({
  export_id: z.string(),
  report_id: z.string().nullable(),
  link_type: z.string(),
  url: z.string(),
  expires_at: z.string(),
  instructions: z.string().nullable().optional(),
  share_id: z.string().nullable().optional(),
});

export const vaultShareSchema = z.object({
  id: z.string(),
  export_id: z.string(),
  auditor_access_id: z.string(),
  auditor_email: z.string(),
  link_type: z.string(),
  share_url: z.string(),
  expires_at: z.string(),
  status: z.string(),
  created_at: z.string(),
  approved_by: z.string().nullable().optional(),
});

export const vaultShareListSchema = z.array(vaultShareSchema);

export const auditorInviteSchema = auditorAccessSchema.extend({
  email_sent: z.boolean().optional(),
  email_delivery_note: z.string().nullable().optional(),
  verify_url: z.string().optional(),
});

export const loginResponseSchema = z.object({
  access_token: z.string().nullable().optional(),
  refresh_token: z.string().nullable().optional(),
  org_id: z.string().nullable().optional(),
  mfa_required: z.boolean().optional(),
  mfa_token: z.string().nullable().optional(),
});

export const settingsSchema = z
  .object({
    checks: z
      .record(z.string(), z.object({ enabled: z.boolean() }).passthrough())
      .optional()
      .default({}),
    optional_checks: z.array(
    z.object({
      check_id: z.string(),
      label: z.string(),
      summary: z.string(),
      description: z.string(),
      enabled: z.boolean(),
      default_enabled: z.boolean(),
    }),
  ),
  features: z.object({
    ai_finding_review_enabled: z.boolean(),
  }),
  security: z
    .object({
      sso_required: z.boolean(),
    })
    .optional()
    .default({ sso_required: false }),
  scheduled_exports: z
    .object({
      enabled: z.boolean(),
      framework: z.string(),
      period_days: z.number(),
      cadence: z.enum(["weekly", "monthly"]),
      notify_email: z.boolean(),
      last_run_at: z.string().nullable().optional(),
      last_export_id: z.string().nullable().optional(),
    })
    .passthrough()
    .optional()
    .default({
      enabled: false,
      framework: "soc2",
      period_days: 90,
      cadence: "monthly",
      notify_email: true,
      last_run_at: null,
      last_export_id: null,
    }),
  scanning: z.object({
    enabled: z.boolean(),
    interval: z.enum(["daily", "weekly", "custom", "manual"]),
    custom_hours: z.number().nullable(),
  }),
  notifications: z
    .object({
      email_digest_enabled: z.boolean(),
      digest_email: z.string().nullable(),
      slack_webhook_url: z.string().nullable(),
      scan_failure_email_enabled: z.boolean(),
      critical_alert_enabled: z.boolean(),
    })
    .passthrough(),
  evidence_classes: z.record(z.string(), z.string()).optional().default({}),
  cis_benchmark_coverage: z.record(z.string(), z.unknown()).nullable().optional(),
  scan_status: z.object({
    account_connected: z.boolean(),
    last_scan_at: z.string().nullable(),
    next_scan_at: z.string().nullable(),
    max_interval: z.enum(["daily", "weekly"]),
    min_custom_hours: z.number(),
  }),
  account_email: z.string().nullable(),
  evidence_source_categories: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        composite_ids: z.array(z.string()),
        entry: z
          .object({
            vendor: z.string(),
            owner: z.string().nullable().optional(),
            cadence: z.string().nullable().optional(),
            scope_description: z.string().nullable().optional(),
            source_type: z.string().nullable().optional(),
            updated_at: z.string().nullable().optional(),
          })
          .nullable()
          .optional(),
      }),
    )
    .optional()
    .default([]),
  custom_evidence_categories: z
    .array(z.object({ key: z.string(), label: z.string() }))
    .optional()
    .default([]),
})
  .passthrough();

export type SettingsData = z.infer<typeof settingsSchema>;

export const workspaceSchema = z.object({
  // Backend WorkspaceOut returns org_id (used by the workspace switcher); not `id`.
  org_id: z.string(),
  org_name: z.string(),
  role: orgRole,
});

export const workspaceListSchema = z.array(workspaceSchema);

export const checklistControlSchema = z.object({
  id: z.string(),
  control_id: z.string(),
  title: z.string(),
  description: z.string(),
  guidance: z.string().nullable(),
  group: z.string(),
  kind: z.string(), // "auto" | "manual"
  status: z.string(),
  check_ids: z.array(z.string()).default([]),
  finding_count: z.number().default(0),
  owner: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  evidence_filename: z.string().nullable().optional(),
  reviewed_at: z.string().nullable().optional(),
});

export const checklistSchema = z.object({
  framework: z.string(),
  summary: z.object({
    total: z.number(),
    met: z.number(),
    not_applicable: z.number(),
    percent: z.number(),
  }),
  controls: z.array(checklistControlSchema),
});

export type ChecklistControl = z.infer<typeof checklistControlSchema>;
export type Checklist = z.infer<typeof checklistSchema>;

export const auditLogEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  actor_email: z.string().nullable().optional(),
  target_type: z.string().nullable().optional(),
  target_id: z.string().nullable().optional(),
  target_label: z.string().nullable().optional(),
  detail: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().nullable().optional(),
});

export const auditLogSchema = z.array(auditLogEntrySchema);

export const auditLogPageSchema = z.object({
  items: z.array(auditLogEntrySchema),
  total: z.number(),
  offset: z.number(),
  limit: z.number(),
});

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
export type AuditLogPage = z.infer<typeof auditLogPageSchema>;

export const scanRunSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  status: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  stats: z.record(z.string(), z.unknown()).nullable(),
});

export const scanRunListSchema = z.array(scanRunSchema);

/** Latest scan run (accounts + cloud integrations). Matches API ScanRunOut. */
export const scanRunLatestSchema = z.object({
  id: z.string(),
  status: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  error: z.string().nullable().optional(),
  failed_at: z.string().nullable().optional(),
  error_type: z.string().nullable().optional(),
  findings_opened: z.number().optional(),
  findings_resolved: z.number().optional(),
  progress_step: z.number().nullable().optional(),
  progress_total: z.number().nullable().optional(),
  progress_phase: z.number().nullable().optional(),
  progress_step_name: z.string().nullable().optional(),
  progress_collector_index: z.number().nullable().optional(),
  progress_collector_total: z.number().nullable().optional(),
  duration_seconds: z.number().nullable().optional(),
  checks_run_count: z.number().nullable().optional(),
  check_error_count: z.number().nullable().optional(),
  resources_collected: z.number().nullable().optional(),
  regions_collected: z.number().nullable().optional(),
});

export const scanRunLatestNullableSchema = scanRunLatestSchema.nullable();

export type ScanRunLatest = z.infer<typeof scanRunLatestSchema>;

export const scanRunLatestListSchema = z.array(scanRunLatestSchema);

export const cloudAccountRowSchema = z.object({
  provider: z.string(),
  id: z.string(),
  external_id: z.string().nullable(),
  label: z.string(),
  status: z.string(),
  last_scan_at: z.string().nullable().default(null),
  last_error: z.string().nullable().optional(),
  open_findings_count: z
    .number()
    .nullish()
    .transform((value) => value ?? 0),
});

export const cloudAccountListSchema = z.array(cloudAccountRowSchema);

export type CloudAccountRow = z.infer<typeof cloudAccountRowSchema>;

export const checkFrameworksSchema = z.object({
  frameworks: z.array(z.record(z.string(), z.string())).default([]),
  checks: z.record(z.string(), z.array(z.string())).default({}),
  coverage_tiers: z.record(z.string(), z.string()).default({}),
  evidence_classes: z.record(z.string(), z.string()).default({}),
  evidence_class_labels: z.record(z.string(), z.string()).default({}),
  cis_benchmark_coverage: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type CheckFrameworks = z.infer<typeof checkFrameworksSchema>;

export const digestSnapshotSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  sent_at: z.string().nullable(),
  stats: z.record(z.string(), z.unknown()).nullable(),
});

export const digestSnapshotListSchema = z.array(digestSnapshotSchema);

export const memberSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  created_at: z.string(),
});

export const memberListSchema = z.array(memberSchema);

export const planUsageSchema = z.object({
  plan: z.string(),
  plan_label: z.string(),
  max_accounts: z.number().nullable(),
  used: z.number(),
  can_add: z.boolean(),
});

export type PlanUsage = z.infer<typeof planUsageSchema>;

export const scanStatsSchema = z.object({
  scans_last_7_days: z.number(),
  scans_prev_7_days: z.number(),
});

export type ScanStats = z.infer<typeof scanStatsSchema>;

export const evidenceCoverageSchema = z
  .object({
    period_days: z.number().optional(),
    period_start: z.string(),
    period_end: z.string(),
    coverage_ratio: z.number(),
    coverage_label: z.string(),
    warning: z.string().nullable(),
    days_with_data: z.number().optional(),
    days_requested: z.number().optional(),
    successful_scans_in_period: z.number().optional().default(0),
    coverage_start: z.string().nullable().optional(),
    scope_limitations: z.array(z.string()).optional(),
  })
  .passthrough();

export type EvidenceCoverageData = z.infer<typeof evidenceCoverageSchema>;

const cloudMetricTrendPointSchema = z.object({
  timestamp: z.string(),
  posture_score: z.number(),
});

const cloudOpenFindingsTrendPointSchema = z.object({
  timestamp: z.string(),
  open_findings_count: z.number(),
});

/** GCP/Azure account overview for the Accounts detail pane. Matches API CloudAccountOverviewOut. */
export const cloudAccountOverviewSchema = z.object({
  provider: z.string(),
  resource_id: z.string(),
  resources_covered: z.number(),
  regions_count: z.number(),
  open_findings_count: z.number().default(0),
  soc2_controls_passed: z.number().nullable(),
  soc2_controls_total: z.number().nullable(),
  compliance_posture_pct: z.number().nullable(),
  coverage: evidenceCoverageSchema,
  posture_trend: z.array(cloudMetricTrendPointSchema).default([]),
  open_findings_trend: z.array(cloudOpenFindingsTrendPointSchema).default([]),
});

export type CloudAccountOverview = z.infer<typeof cloudAccountOverviewSchema>;

export const controlListItemSchema = z
  .object({
    id: z.string(),
    framework: z.string().optional(),
    control_id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    guidance: z.string().nullable().optional(),
    status: z.string(),
    finding_count: z.number().default(0),
    check_ids: z.array(z.string()).default([]),
    kind: z.string().optional(),
  })
  .passthrough();

export const controlListSchema = z.array(controlListItemSchema);

export const controlMappingItemSchema = z.object({
  framework: z.string(),
  control_id: z.string(),
  global_check_ids: z.array(z.string()),
  added_check_ids: z.array(z.string()),
  removed_check_ids: z.array(z.string()),
  effective_check_ids: z.array(z.string()),
  has_override: z.boolean(),
});

export const controlMappingListSchema = z.array(controlMappingItemSchema);

export const compositeControlItemSchema = z
  .object({
    id: z.string(),
    control_id: z.string(),
    title: z.string(),
    description: z.string(),
    guidance: z.string().nullable(),
    soc2_criteria: z.array(z.string()).default([]),
    cis_criteria: z.array(z.string()).optional().default([]),
    iso_criteria: z.array(z.string()).optional().default([]),
    check_ids: z.array(z.string()).default([]),
    status: z.enum(["pass", "fail", "at_risk", "no_data"]),
    finding_count: z.number().default(0),
    open_finding_ids: z.array(z.string()).default([]),
  })
  .passthrough();

export const compositeControlListSchema = z.array(compositeControlItemSchema);

export const mappedControlSchema = z
  .object({
    framework: z.string(),
    control_id: z.string(),
    title: z.string(),
    description: z.string(),
    guidance: z.string().nullable(),
    narrative: z.string().nullable(),
    reference_url: z.string(),
    reference_label: z.string(),
    reference_note: z.string().nullable().optional(),
  })
  .passthrough();

export const compositeControlSummarySchema = z
  .object({
    id: z.string(),
    control_id: z.string(),
    title: z.string(),
    description: z.string(),
    guidance: z.string().nullable(),
    soc2_criteria: z.array(z.string()).default([]),
    cis_criteria: z.array(z.string()).optional().default([]),
    iso_criteria: z.array(z.string()).optional().default([]),
  })
  .passthrough();

/** GET /v1/controls/by-check/{check_id} — finding drawer Compliance tab. */
export const controlsByCheckSchema = z
  .object({
    check_id: z.string(),
    framework_priority: z.array(z.string()).optional(),
    primary: mappedControlSchema.nullable(),
    controls: z.array(mappedControlSchema).default([]),
    frameworks: z.array(z.string()).optional(),
    composites: z.array(compositeControlSummarySchema).optional(),
    primary_composite: compositeControlSummarySchema.nullable().optional(),
  })
  .passthrough();

export type ControlsByCheck = z.infer<typeof controlsByCheckSchema>;

export const externalEvidenceArtifactSchema = z
  .object({
    id: z.string(),
    control_id: z.string().nullable(),
    composite_control_id: z.string().nullable(),
    check_id: z.string().nullable(),
    framework: z.string(),
    control_ref: z.string().nullable(),
    title: z.string(),
    source: z.string().nullable(),
    evidence_type: z.string().nullable(),
    period_start: z.string().nullable(),
    period_end: z.string().nullable(),
    external_url: z.string().nullable(),
    owner: z.string().nullable(),
    status: z.string(),
    expires_at: z.string().nullable(),
    filename: z.string().nullable(),
    size_bytes: z.number(),
    note: z.string().nullable(),
    created_at: z.string().nullable(),
    checksum_sha256: z.string().nullable(),
    review_notes: z.string().nullable(),
    reviewed_at: z.string().nullable(),
    reviewed_by_email: z.string().nullable(),
    superseded_by: z.string().nullable(),
    policy_ref: z.string().nullable().optional(),
  })
  .passthrough();

export const externalEvidenceListSchema = z.array(externalEvidenceArtifactSchema);

export const complianceTimelineSchema = z
  .object({
    framework: z.string(),
    period_days: z.number(),
    events: z.array(z.record(z.string(), z.unknown())).default([]),
    current_summary: z
      .object({
        controls_passed: z.number(),
        controls_failed: z.number(),
        controls_no_data: z.number(),
        open_findings_count: z.number().optional(),
      })
      .nullable()
      .optional(),
    current_posture_score: z.number().nullable(),
    total_failing: z.number().optional(),
    scan_count: z.number().optional(),
    posture_trend: z
      .array(
        z.object({
          timestamp: z.string(),
          posture_score: z.number(),
        }),
      )
      .optional(),
    period_summary: z.record(z.string(), z.unknown()).optional(),
    persistent_gaps: z.array(z.record(z.string(), z.unknown())).optional(),
    scan_cadence: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough() as unknown as z.ZodType<ComplianceHistoryResponse>;

export type ComplianceTimelineData = ComplianceHistoryResponse;

export const jiraIntegrationSchema = z
  .object({
    connected: z.boolean(),
    status: z.string().optional(),
    site_url: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    project_key: z.string().nullable().optional(),
    issue_type: z.string().optional(),
    has_api_token: z.boolean().optional(),
  })
  .passthrough();

export type JiraIntegration = z.infer<typeof jiraIntegrationSchema>;

/** GET /v1/integrations/{github|gitlab|google-workspace|entra} — null when disconnected. */
export const integrationStatusSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    last_synced_at: z.string().nullable().default(null),
    identity_users: z.number().default(0),
    admin_users: z.number().default(0),
    repos: z.number().default(0),
    protected_branches: z.number().default(0),
    pull_requests: z.number().default(0),
    selected_repos: z.array(z.string()).default([]),
    login: z.string().nullable().optional(),
    org_login: z.string().nullable().optional(),
    org_logins: z.array(z.string()).default([]),
    username: z.string().nullable().optional(),
    group_id: z.string().nullable().optional(),
    group_ids: z.array(z.string()).default([]),
    base_url: z.string().nullable().optional(),
    admin_email: z.string().nullable().optional(),
    domain: z.string().nullable().optional(),
    two_step_verification_enforced: z.boolean().nullable().optional(),
    tenant_id: z.string().nullable().optional(),
    security_defaults_enabled: z.boolean().nullable().optional(),
  })
  .passthrough();

export const integrationStatusNullableSchema = integrationStatusSchema.nullable();

export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

/** GET /v1/integrations/{github|gitlab|google-workspace|entra}/connect-url */
export const integrationConnectUrlSchema = z.object({
  url: z.string(),
});

export type IntegrationConnectUrl = z.infer<typeof integrationConnectUrlSchema>;

/** PUT /v1/integrations/google-workspace/scope */
export const googleWorkspaceScopeSchema = z.object({
  domain: z.string().nullable(),
});

export type GoogleWorkspaceScope = z.infer<typeof googleWorkspaceScopeSchema>;

/** POST /v1/integrations/google-workspace/sync */
export const googleWorkspaceSyncSchema = z.object({
  identity_users: z.number(),
  admin_users: z.number(),
});

export type GoogleWorkspaceSync = z.infer<typeof googleWorkspaceSyncSchema>;

export const scannerIntegrationSchema = z
  .object({
    connected: z.boolean(),
    status: z.string(),
    vendor: z.string(),
    config: z
      .object({
        last_synced_at: z.string().nullable().optional(),
        open_findings_count: z.number().optional(),
      })
      .passthrough()
      .default({}),
  })
  .passthrough();

export type ScannerIntegration = z.infer<typeof scannerIntegrationSchema>;

export const accountTimelineSchema = z
  .object({
    events: z.array(z.record(z.string(), z.unknown())).default([]),
    total: z.number().optional(),
    meta: z
      .object({
        cloudtrail_logging: z.boolean(),
        has_logging_trail: z.boolean().optional(),
        trail_count: z.number().optional(),
        events_in_account: z.number().optional(),
        last_scan_at: z.string().nullable().optional(),
        filtered_compliance_only: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type AccountTimeline = z.infer<typeof accountTimelineSchema>;

export const blastRadiusSchema = z
  .object({
    resource_type: z.string(),
    confidence: z.string(),
    warnings: z.array(z.string()).default([]),
  })
  .passthrough();

/** GET /v1/meta/client-ip — public IP for CLI remediation placeholders. */
export const clientIpSchema = z
  .object({
    ip: z.string().nullable(),
  })
  .passthrough();

/** GET /v1/accounts/{id}/roles/policy-generation/status — CloudTrail policy-gen job. */
export const policyGenerationStatusSchema = z
  .object({
    status: z.string().optional(),
    job_id: z.string().optional(),
    started_on: z.string().optional(),
    completed_on: z.string().optional(),
    region: z.string().optional(),
    detail: z.string().optional(),
  })
  .passthrough();

export type PolicyGenerationStatus = z.infer<typeof policyGenerationStatusSchema>;

/** GET /v1/accounts/{id}/roles/generated-policy — least-privilege proposal. */
export const generatedPolicySchema = z
  .object({
    has_inline_policies: z.boolean().optional(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
    improve_via_cloudtrail: z.boolean().optional(),
    observed_action_count: z.number().optional(),
    source_label: z.string().nullable().optional(),
    cleaned_policies: z.record(z.string(), z.unknown()).nullable().optional(),
    original_policies: z.record(z.string(), z.unknown()).nullable().optional(),
    cloudtrail_analysis: z
      .object({
        ready: z.boolean(),
        status: z.string(),
        message: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
    access_analyzer: z
      .object({
        available: z.boolean().optional(),
        reason: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type GeneratedPolicyResponse = z.infer<typeof generatedPolicySchema>;
