import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { BASE } from "../api";

type TrustFrameworkScore = {
  framework: string;
  framework_label: string;
  control_count: number;
  passed: number;
  failed: number;
  no_data: number;
  score_pct: number;
};

type TrustControlGap = {
  control_id: string;
  title: string;
  framework: string;
  framework_label: string;
  open_findings: number;
};

type TrustCenterData = {
  company_name: string;
  company_logo_url: string | null;
  custom_message: string | null;
  is_enabled: boolean;
  frameworks: TrustFrameworkScore[];
  last_scan_at: string | null;
  connected_accounts: number;
  recent_activity: Record<string, unknown>;
  open_findings_count: number;
  controls_evaluated: number;
  top_gaps: TrustControlGap[];
};

const MONITORING_AREAS = [
  "IAM users, roles, and access keys",
  "Root account and MFA posture",
  "S3 bucket public access and encryption",
  "KMS key rotation and policies",
];

function formatWhen(iso: string | null) {
  if (!iso) return "Not yet scanned";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function relativeScanAge(iso: string | null): string {
  if (!iso) return "Awaiting first scan";
  const hours = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
  if (hours < 24) return "Updated within the last day";
  if (hours < 48) return "Updated within the last 2 days";
  const days = Math.floor(hours / 24);
  return `Last updated ${days} day${days === 1 ? "" : "s"} ago`;
}

export default function TrustCenter() {
  const { slug } = useParams<{ slug: string }>();

  const { data, isLoading, error } = useQuery<TrustCenterData>({
    queryKey: ["trust-center", slug],
    queryFn: async () => {
      const res = await fetch(`${BASE}/trust/${slug}`);
      if (!res.ok) {
        throw new Error(res.status === 404 ? "Trust center not found" : "Failed to load");
      }
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <TrustShell>
        <div className="text-center py-20 text-zinc-400">Loading trust center…</div>
      </TrustShell>
    );
  }
  if (error || !data) {
    return (
      <TrustShell>
        <div className="text-center py-20">
          <h1 className="text-2xl font-bold text-zinc-700">Trust Center Not Found</h1>
          <p className="mt-2 text-zinc-500">This organization&apos;s trust center is not available.</p>
        </div>
      </TrustShell>
    );
  }

  const totalFailed = data.frameworks.reduce((n, fw) => n + fw.failed, 0);
  const totalPassed = data.frameworks.reduce((n, fw) => n + fw.passed, 0);

  return (
    <TrustShell>
      <div className="max-w-4xl mx-auto px-4 space-y-10 py-10">
        {/* Header */}
        <div className="text-center">
          {data.company_logo_url && (
            <img src={data.company_logo_url} alt={data.company_name} className="mx-auto h-16 mb-4 object-contain" />
          )}
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{data.company_name}</h1>
          <p className="mt-2 text-zinc-500">Compliance &amp; Security Trust Center</p>
          {data.custom_message && (
            <p className="mt-3 max-w-xl mx-auto text-sm text-zinc-600 italic">&ldquo;{data.custom_message}&rdquo;</p>
          )}
        </div>

        {/* Status bar */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="AWS accounts monitored" value={String(data.connected_accounts)} />
          <StatCard label="Controls evaluated" value={String(data.controls_evaluated || "—")} />
          <StatCard label="Open security findings" value={String(data.open_findings_count)} tone={data.open_findings_count > 0 ? "warn" : "ok"} />
          <StatCard label="Last automated scan" value={formatWhen(data.last_scan_at)} sub={relativeScanAge(data.last_scan_at)} />
        </div>

        {/* What we monitor */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-zinc-900">What we monitor</h2>
          <p className="text-sm text-zinc-600">
            Read-only scans run daily against connected AWS accounts. Evidence is mapped to the frameworks below.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2 text-sm text-zinc-700">
            {MONITORING_AREAS.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-emerald-600 shrink-0">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 pt-1">
            {data.frameworks.map((fw) => (
              <span
                key={fw.framework}
                className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100"
              >
                {fw.framework_label}
              </span>
            ))}
          </div>
        </section>

        {/* Framework scores */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-lg font-bold text-zinc-900">Compliance posture</h2>
            <p className="text-xs text-zinc-500">
              {totalPassed} controls passing · {totalFailed} need attention
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.frameworks.map((fw) => (
              <div key={fw.framework} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{fw.framework_label}</p>
                <div className="mt-3 flex items-end gap-2">
                  <span className="text-3xl font-bold tabular-nums text-zinc-900">{fw.score_pct}%</span>
                  <span className="text-sm text-zinc-500">passing</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-zinc-200 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${fw.score_pct}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-zinc-500">{fw.control_count} mapped controls</p>
                <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
                  <span className="text-emerald-600 font-semibold">{fw.passed} passed</span>
                  <span className="text-red-500 font-semibold">{fw.failed} gaps</span>
                  {fw.no_data > 0 && <span className="text-zinc-500">{fw.no_data} awaiting data</span>}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Top gaps */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-zinc-900">Open control gaps</h2>
          {data.top_gaps.length === 0 ? (
            <p className="text-sm text-zinc-600">
              No open control gaps in the selected frameworks — posture is green for published frameworks.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {data.top_gaps.map((gap) => (
                <li key={`${gap.framework}-${gap.control_id}`} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-zinc-900">
                        {gap.control_id} · {gap.title}
                      </p>
                      <p className="text-xs text-zinc-500 mt-0.5">{gap.framework_label}</p>
                    </div>
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">
                      {gap.open_findings} open finding{gap.open_findings === 1 ? "" : "s"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-zinc-400 border-t border-zinc-100 pt-3">
            Summary only — no resource names or account IDs are shown on this public page.
          </p>
        </section>

        {/* Footer */}
        <div className="text-center pt-4 pb-8">
          <div className="flex items-center justify-center gap-2 text-xs text-zinc-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
              />
            </svg>
            <span>
              Powered by <strong>Vigil</strong> — continuous compliance evidence
            </span>
          </div>
        </div>
      </div>
    </TrustShell>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  const valueClass =
    tone === "warn" ? "text-amber-800" : tone === "ok" ? "text-emerald-800" : "text-zinc-900";
  const borderClass =
    tone === "warn"
      ? "border-amber-200 bg-amber-50/40"
      : tone === "ok"
        ? "border-emerald-200 bg-emerald-50/40"
        : "border-zinc-200 bg-white";

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${borderClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-1 text-lg font-bold leading-snug ${valueClass}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

function TrustShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white">{children}</div>;
}
