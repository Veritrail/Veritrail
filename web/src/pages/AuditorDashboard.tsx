import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { auditorApi } from "../api";
import { useAuditorAsOf } from "../components/AuditorAsOf";
import "../styles/auditor.css";

type DashboardData = {
  org_name: string;
  auditor_name: string | null;
  expires_at: string | null;
  active_frameworks: string[];
  connected_accounts: number;
  last_scan_at: string | null;
  findings_total: number;
  findings_by_severity: Record<string, number>;
  evidence_snapshot_count: number;
};

const SEV_META = [
  { key: "critical", label: "Critical", color: "#ef4444" },
  { key: "high", label: "High", color: "#f97316" },
  { key: "medium", label: "Medium", color: "#f59e0b" },
  { key: "low", label: "Low", color: "#22c55e" },
];

const FW_LABELS: Record<string, { name: string; abbr: string }> = {
  soc2: { name: "SOC 2", abbr: "SOC" },
  cis_aws_l1: { name: "CIS AWS L1", abbr: "CIS" },
  iso27001: { name: "ISO 27001", abbr: "ISO" },
};

function frameworkLabel(fw: string) {
  return FW_LABELS[fw] ?? { name: fw.toUpperCase().replace(/_/g, " "), abbr: fw.slice(0, 3).toUpperCase() };
}

function formatWhen(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function expiresLabel(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 3600 * 1000));
  if (days < 0) return "Expired";
  if (days === 0) return "Expires today";
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

function ArrowRight({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
    </svg>
  );
}

function ShieldCheck() {
  return (
    <svg className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.96 11.96 0 0 1 3.6 6 12 12 0 0 0 3 9.75c0 5.6 3.82 10.3 9 11.62 5.18-1.33 9-6.03 9-11.62 0-1.31-.21-2.57-.6-3.75h-.15A11.96 11.96 0 0 1 12 2.71Z" />
    </svg>
  );
}

const METRIC_TONES: Record<string, { bg: string; color: string }> = {
  indigo: { bg: "#eef2ff", color: "#4f46e5" },
  blue: { bg: "#eff6ff", color: "#2563eb" },
  emerald: { bg: "#ecfdf5", color: "#059669" },
};

function Metric({ tone, icon, label, value }: { tone: string; icon: React.ReactNode; label: string; value: string | number }) {
  const t = METRIC_TONES[tone];
  return (
    <div className="aud-metric">
      <span className="aud-metric__icon" style={{ background: t.bg, color: t.color }}>
        {icon}
      </span>
      <span className="aud-metric__label">{label}</span>
      <span className="aud-metric__value">{value}</span>
    </div>
  );
}

export default function AuditorDashboard() {
  const { asOf } = useAuditorAsOf();
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["auditor-dashboard", asOf],
    queryFn: () => auditorApi(`/auditor/dashboard${asOf ? `?as_of=${asOf}` : ""}`),
  });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center text-sm text-zinc-400">Loading…</div>;
  }
  if (!data) return null;

  const sevTotal = SEV_META.reduce((s, m) => s + (data.findings_by_severity[m.key] || 0), 0) || 1;
  const lastScanMs = data.last_scan_at ? Date.now() - new Date(data.last_scan_at).getTime() : null;
  const evidenceCurrent = lastScanMs != null && lastScanMs < 26 * 3600 * 1000;
  const expires = expiresLabel(data.expires_at);

  return (
    <div className="aud-page space-y-5 pb-10">
      {/* Hero */}
      <div className="aud-hero">
        <div className="min-w-0">
          <p className="aud-hero__eyebrow">Auditor workspace</p>
          <h1 className="aud-hero__title">{data.org_name}</h1>
          <div className="aud-hero__meta">
            <span className="aud-hero-pill aud-hero-pill--readonly">
              <span className="aud-hero-pill__dot" aria-hidden />
              Read-only access
            </span>
            <span className="aud-hero-pill aud-hero-pill--muted">{data.auditor_name || "External auditor"}</span>
            {expires && <span className="aud-hero-pill aud-hero-pill--muted">{expires}</span>}
            {evidenceCurrent && (
              <span className="aud-hero-pill aud-hero-pill--fresh">
                <span className="aud-hero-pill__dot" aria-hidden />
                Evidence current
              </span>
            )}
          </div>
        </div>
        <div className="aud-hero__shield">
          <ShieldCheck />
        </div>
      </div>

      {/* Overview */}
      <div className="aud-overview">
        {/* Findings posture */}
        <div className="aud-posture-card">
          <p className="aud-section-label">Open findings</p>
          <p className="aud-posture-card__num">
            {data.findings_total.toLocaleString()}
            <span>across {data.connected_accounts} account{data.connected_accounts === 1 ? "" : "s"}</span>
          </p>

          <div className="aud-sevbar">
            {SEV_META.map((m) => {
              const count = data.findings_by_severity[m.key] || 0;
              if (!count) return null;
              return <span key={m.key} className="aud-sevbar__seg" style={{ width: `${(count / sevTotal) * 100}%`, background: m.color }} />;
            })}
          </div>

          <div className="aud-sevlegend">
            {SEV_META.map((m) => (
              <div key={m.key} className="aud-sevlegend__item">
                <span className="aud-sevlegend__dot" style={{ background: m.color }} aria-hidden />
                <span className="aud-sevlegend__count">{data.findings_by_severity[m.key] || 0}</span>
                <span className="aud-sevlegend__label">{m.label}</span>
              </div>
            ))}
          </div>

          <div className="mt-5 border-t border-zinc-100 pt-4">
            <Link to="/auditor/findings" className="aud-link">
              Review all findings
              <ArrowRight />
            </Link>
          </div>
        </div>

        {/* Key metrics */}
        <div className="aud-metric-card">
          <Metric
            tone="indigo"
            label="Connected accounts"
            value={data.connected_accounts}
            icon={
              <svg fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
              </svg>
            }
          />
          <Metric
            tone="blue"
            label="Evidence snapshots"
            value={data.evidence_snapshot_count.toLocaleString()}
            icon={
              <svg fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            }
          />
          <Metric
            tone="emerald"
            label="Last scan"
            value={formatWhen(data.last_scan_at)}
            icon={
              <svg fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            }
          />
        </div>
      </div>

      {/* Frameworks in scope */}
      <div>
        <p className="aud-section-label" style={{ marginBottom: "0.75rem" }}>
          Frameworks in scope
        </p>
        <div className="aud-fw-grid">
          {data.active_frameworks.map((fw) => {
            const meta = frameworkLabel(fw);
            return (
              <Link key={fw} to="/auditor/controls" className="aud-fw-entry">
                <span className="aud-fw-entry__mark">{meta.abbr}</span>
                <div className="min-w-0">
                  <div className="aud-fw-entry__name">{meta.name}</div>
                  <div className="aud-fw-entry__sub">View control matrix</div>
                </div>
                <span className="aud-fw-entry__arrow">
                  <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
