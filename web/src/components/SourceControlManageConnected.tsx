import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { IntegrationBrandId } from "../lib/integrationBrands";
import {
  formatSync,
  IconRepo,
  IntegrationBrandIcon,
  ProgressBar,
  Spinner,
  StatusDot,
} from "./IntegrationsUi";
import "../styles/source-control-manage.css";

type HealthTone = "ok" | "warn" | "idle" | "sync";

type ProviderBase = {
  last_synced_at: string | null;
  identity_users: number;
  repos: number;
  protected_branches: number;
  pull_requests: number;
  selected_repos: string[];
};

type RepoRow = {
  full_name: string;
  short_name: string;
  protection_status: "protected" | "missing" | "review";
  last_evidence_at: string | null;
  activity_count: number;
};

type EvidenceType = { key: string; label: string };

export type SourceControlManageConfig = {
  brand: IntegrationBrandId;
  title: string;
  scopeReposPath: string;
  editScopeHref: string;
  findingsUrl: string;
  findingsLinkLabel: string;
  disconnectLabel: string;
  evidenceTypes: readonly EvidenceType[];
  mergedMetricLabel: string;
  accountLabel: (provider: ProviderBase & Record<string, unknown>) => string;
  subtitleSuffix?: (provider: ProviderBase & Record<string, unknown>) => string;
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function formatEvidenceDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function EvidenceRowStatus({ status }: { status: "collected" | "review" | "pending" }) {
  const label = status === "collected" ? "Collected" : status === "review" ? "Needs review" : "Pending";
  return (
    <span className={`scm-evidence-status scm-evidence-status--${status}`}>
      <span className="scm-evidence-status__icon" aria-hidden>
        {status === "collected" ? (
          <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        ) : status === "review" ? (
          <span className="text-[10px] font-bold leading-none">!</span>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
        )}
      </span>
      <span>{label}</span>
    </span>
  );
}

function ProtectionStatusIcon({ status }: { status: RepoRow["protection_status"] }) {
  if (status === "protected") {
    return (
      <span className="scm-protection-icon scm-protection-icon--ok" aria-hidden>
        <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </span>
    );
  }
  return (
    <span className="scm-protection-icon scm-protection-icon--warn" aria-hidden>
      <span className="text-[10px] font-bold leading-none">!</span>
    </span>
  );
}

function ProtectionRepoStatus({ status }: { status: RepoRow["protection_status"] }) {
  const label = status === "protected" ? "Protected" : status === "missing" ? "Missing" : "Needs review";
  return (
    <span className="scm-protection-status">
      <ProtectionStatusIcon status={status} />
      <span className="scm-protection-status__label">{label}</span>
    </span>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: HealthTone }) {
  return (
    <div className={`scm-summary-card scm-summary-card--${tone}`}>
      <span className="scm-summary-label">{label}</span>
      <span className="scm-summary-value">
        {tone === "sync" ? <Spinner className="h-3.5 w-3.5 text-sky-600" /> : <StatusDot tone={tone} />}
        {value}
      </span>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  );
}

const HEADER_ACTION_BTN =
  "inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";

type Props = {
  config: SourceControlManageConfig;
  provider: ProviderBase & Record<string, unknown>;
  isSyncing: boolean;
  onSync: () => void;
  syncDisabled?: boolean;
  onDisconnect: () => void;
  disconnectPending?: boolean;
};

export function SourceControlManageConnected({
  config,
  provider: p,
  isSyncing,
  onSync,
  syncDisabled,
  onDisconnect,
  disconnectPending,
}: Props) {
  const scopeRepos = useQuery({
    queryKey: [config.scopeReposPath],
    queryFn: () => api<RepoRow[]>(config.scopeReposPath),
  });

  const selectedRepoCount = p.selected_repos?.length || 0;
  const scannedRepoCount = p.repos || 0;
  const currentScopeCount = selectedRepoCount || scannedRepoCount;
  const hasScopeDrift =
    !!p.last_synced_at && selectedRepoCount > 0 && scannedRepoCount > 0 && selectedRepoCount !== scannedRepoCount;
  const scopeDriftCount = Math.abs(selectedRepoCount - scannedRepoCount);
  const lastSyncAgeMs = p.last_synced_at ? Date.now() - new Date(p.last_synced_at).getTime() : null;
  const syncState = !p.last_synced_at
    ? "Pending"
    : hasScopeDrift
      ? "Needs refresh"
      : lastSyncAgeMs && lastSyncAgeMs > 7 * 24 * 60 * 60 * 1000
        ? "Stale"
        : "Synced";
  const syncTone: HealthTone = syncState === "Synced" ? "ok" : syncState === "Pending" ? "idle" : "warn";
  const scopeRepoList = scopeRepos.data ?? [];
  const protectedReposFromScope = scopeRepoList.filter((r) => r.protection_status === "protected").length;
  const reviewReposFromScope = scopeRepoList.filter((r) => r.protection_status === "review").length;
  const missingReposFromScope = scopeRepoList.filter((r) => r.protection_status === "missing").length;
  const protectedRepos =
    scopeRepoList.length > 0 ? protectedReposFromScope : p.protected_branches || 0;
  const notFullyProtected =
    scopeRepoList.length > 0
      ? scopeRepoList.length - protectedReposFromScope
      : Math.max((p.repos || 0) - protectedRepos, 0);
  const protectedCoveragePercent = p.repos ? Math.round((protectedRepos / p.repos) * 100) : 0;
  const scopeDriftSummary =
    selectedRepoCount < scannedRepoCount
      ? `${scopeDriftCount} ${pluralize(scopeDriftCount, "repository")} excluded after latest collection.`
      : `${scopeDriftCount} ${pluralize(scopeDriftCount, "repository")} added after latest collection.`;
  const protectionAccent: "warn" | "ok" | "none" = !p.repos ? "none" : notFullyProtected ? "warn" : "ok";
  const protectionTone: "ok" | "warn" | "neutral" = !p.repos ? "neutral" : notFullyProtected ? "warn" : "ok";
  const protectionNote = !p.repos
    ? "Run a sync to collect branch protection evidence."
    : hasScopeDrift
      ? `Scope drift detected. ${scopeDriftSummary}`
      : notFullyProtected === 0
        ? "All scoped repositories had branch protection evidence in the last collection."
        : reviewReposFromScope > 0 && missingReposFromScope === 0
          ? `${reviewReposFromScope} ${pluralize(reviewReposFromScope, "repository")} have branch rules but required reviews are not configured.`
          : missingReposFromScope > 0 && reviewReposFromScope > 0
            ? `${missingReposFromScope} ${pluralize(missingReposFromScope, "repository")} missing protection; ${reviewReposFromScope} ${pluralize(reviewReposFromScope, "repository")} need review.`
            : "No branch protection evidence was found in the last collection.";
  const protectionTitle = protectionAccent === "warn" ? "Branch protection needs review" : "Branch protection";
  const previewRepos = (scopeRepos.data ?? []).slice(0, 5);
  const activityLabel = config.brand === "gitlab" ? "MRs" : "PRs";
  const repoBrandName = config.brand === "gitlab" ? "GitLab" : "GitHub";
  const repoHostBase =
    config.brand === "gitlab"
      ? typeof p.base_url === "string" && p.base_url
        ? p.base_url.replace(/\/+$/, "")
        : "https://gitlab.com"
      : "https://github.com";
  const repoWebUrl = (fullName: string) => `${repoHostBase}/${fullName.split("/").map(encodeURIComponent).join("/")}`;

  return (
    <div className="scm-page space-y-5">
      <p className="scm-breadcrumb">
        <Link to="/integrations">Integrations</Link>
        {" / "}Source control
      </p>

      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <IntegrationBrandIcon brand={config.brand} size={48} />
            <h1 className="text-2xl font-bold tracking-tight text-zinc-950">{config.title}</h1>
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200">
              Connected
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            to={config.editScopeHref}
            className={`${HEADER_ACTION_BTN} border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-zinc-300 hover:bg-zinc-50`}
          >
            Edit scope
          </Link>
          <button
            type="button"
            onClick={onSync}
            disabled={isSyncing || syncDisabled}
            className={`${HEADER_ACTION_BTN} bg-[#2563eb] text-white shadow-sm shadow-blue-600/20 hover:bg-[#1d4ed8]`}
          >
            {isSyncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </header>

      <div className="scm-summary">
        <SummaryCard label="Sync health" value={syncState} tone={isSyncing ? "sync" : syncTone} />
        <SummaryCard label="Permissions" value="OAuth healthy" tone="ok" />
        <SummaryCard
          label="Scope"
          value={currentScopeCount ? `${currentScopeCount} repos` : "Not collected"}
          tone={currentScopeCount ? "ok" : "idle"}
        />
        <SummaryCard label="Last collection" value={formatSync(p.last_synced_at)} tone={p.last_synced_at ? "ok" : "idle"} />
      </div>

      <div className="scm-main-grid">
        <section className={`scm-card ${protectionAccent === "warn" ? "scm-card--warn" : protectionAccent === "ok" ? "scm-card--ok" : ""}`}>
          <div className="scm-card__header">
            <div>
              <div className="scm-card__title-row">
                {protectionAccent === "warn" && (
                  <img
                    src="/icons/branch-protection-shield.png"
                    alt=""
                    className="scm-branch-protection-icon"
                    aria-hidden
                  />
                )}
                <h2 className="scm-card__title">{protectionTitle}</h2>
              </div>
              <p className="scm-card__subtitle">Branch rules and repository activity from the last collection</p>
            </div>
            <EvidenceRowStatus status={protectionAccent === "warn" ? "review" : protectionAccent === "ok" ? "collected" : "pending"} />
          </div>

          <p className="scm-stat-line">
            {protectedRepos} of {p.repos || 0} repositories protected
          </p>
          <p className="scm-stat-note">{protectionNote}</p>

          {hasScopeDrift && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Coverage changed after the latest sync. Run sync to refresh metrics.
            </div>
          )}

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium text-zinc-500">Coverage</span>
              <span className="font-semibold tabular-nums text-zinc-800">{protectedCoveragePercent}%</span>
            </div>
            <ProgressBar value={protectedCoveragePercent} tone={protectionTone} />
          </div>

          <div className="scm-mini-metrics">
            <div className="scm-mini-metric">
              <div className="scm-mini-metric__label">Members</div>
              <div className="scm-mini-metric__value">{p.identity_users}</div>
            </div>
            <div className="scm-mini-metric">
              <div className="scm-mini-metric__label">{config.mergedMetricLabel}</div>
              <div className="scm-mini-metric__value">{p.pull_requests}</div>
            </div>
          </div>

          <div className="scm-card__footer">
            <Link to={config.findingsUrl} className="scm-link-action">
              {config.findingsLinkLabel}
              <ArrowIcon />
            </Link>
          </div>
        </section>

        <section className="scm-card">
          <h2 className="scm-card__title">Evidence coverage</h2>
          <p className="scm-card__subtitle">Change-management and identity artifacts in your evidence pack</p>
          <ul className="scm-evidence-list">
            {config.evidenceTypes.map(({ key, label }) => {
              const collected = !!p.last_synced_at;
              const branchGap = key === "branch" && collected && notFullyProtected > 0;
              const status: "collected" | "review" | "pending" = !collected ? "pending" : branchGap ? "review" : "collected";
              return (
                <li key={key} className="scm-evidence-row">
                  <span className="scm-evidence-row__label">{label}</span>
                  <EvidenceRowStatus status={status} />
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="scm-repos-section">
        <div className="scm-repos-table-wrap">
          <table className="scm-repos-table">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Protection status</th>
                <th>Last evidence</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {scopeRepos.isLoading && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-zinc-500">
                    Loading repositories…
                  </td>
                </tr>
              )}
              {!scopeRepos.isLoading && previewRepos.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-sm text-zinc-500">
                    Run a sync to populate repository evidence.
                  </td>
                </tr>
              )}
              {previewRepos.map((repo) => (
                <tr key={repo.full_name}>
                  <td>
                    <a
                      href={repoWebUrl(repo.full_name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="scm-repo-cell scm-repo-link"
                      title={`Open ${repo.full_name} on ${repoBrandName}`}
                    >
                      <span className="scm-repo-icon">
                        <IconRepo />
                      </span>
                      {repo.short_name}
                    </a>
                  </td>
                  <td>
                    <ProtectionRepoStatus status={repo.protection_status} />
                  </td>
                  <td>{formatEvidenceDate(repo.last_evidence_at)}</td>
                  <td className="scm-repos-activity-cell">
                    <div className="scm-repos-activity-cell__inner">
                      <span>
                        {repo.activity_count} {activityLabel}
                      </span>
                      <a
                        href={repoWebUrl(repo.full_name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="scm-repos-row-chevron"
                        aria-label={`Open ${repo.short_name} on ${repoBrandName}`}
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 17 17 7M7 7h10v10" />
                        </svg>
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {currentScopeCount > 5 && (
            <div className="scm-repos-footer">
              <Link to={config.editScopeHref} className="scm-link-action">
                View all {currentScopeCount} repositories
                <ArrowIcon />
              </Link>
            </div>
          )}
        </div>
      </section>

      <div className="scm-settings">
        <details className="scm-settings__details">
          <summary className="scm-settings__summary">
            <span>Connection settings</span>
            <svg className="scm-settings__chevron h-4 w-4 text-zinc-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </summary>
          <div className="scm-danger-zone scm-danger-zone--nested">
            <div className="scm-danger-zone__inner">
              <div>
                <p className="scm-danger-zone__label">Danger zone</p>
                <p className="scm-danger-zone__text">
                  Disconnecting {config.brand === "gitlab" ? "GitLab" : "GitHub"} stops future evidence collection. Existing findings remain until the next sync clears them.
                </p>
              </div>
              <button type="button" className="scm-danger-btn" onClick={onDisconnect} disabled={disconnectPending}>
                {disconnectPending ? "Disconnecting…" : config.disconnectLabel}
              </button>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
