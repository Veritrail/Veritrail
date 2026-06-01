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

type TrustCenterData = {
  company_name: string;
  company_logo_url: string | null;
  custom_message: string | null;
  is_enabled: boolean;
  frameworks: TrustFrameworkScore[];
  last_scan_at: string | null;
  connected_accounts: number;
  recent_activity: Record<string, unknown>;
};

function formatWhen(iso: string | null) {
  if (!iso) return "N/A";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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
    return <TrustShell><div className="text-center py-20 text-zinc-400">Loading trust center…</div></TrustShell>;
  }
  if (error || !data) {
    return (
      <TrustShell>
        <div className="text-center py-20">
          <h1 className="text-2xl font-bold text-zinc-700">Trust Center Not Found</h1>
          <p className="mt-2 text-zinc-500">This organization's trust center is not available.</p>
        </div>
      </TrustShell>
    );
  }

  return (
    <TrustShell>
      <div className="max-w-4xl mx-auto space-y-10">
        {/* Header */}
        <div className="text-center">
          {data.company_logo_url && (
            <img src={data.company_logo_url} alt={data.company_name} className="mx-auto h-16 mb-4" />
          )}
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{data.company_name}</h1>
          <p className="mt-2 text-zinc-500">Compliance & Security Trust Center</p>
          {data.custom_message && (
            <p className="mt-3 max-w-xl mx-auto text-sm text-zinc-600 italic">"{data.custom_message}"</p>
          )}
        </div>

        {/* Status bar */}
        <div className="flex flex-wrap items-center justify-center gap-6 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
          <div className="text-center">
            <div className="text-xs font-semibold uppercase text-emerald-700">Connected Accounts</div>
            <div className="mt-1 text-2xl font-bold text-emerald-800">{data.connected_accounts}</div>
          </div>
          <div className="text-center">
            <div className="text-xs font-semibold uppercase text-emerald-700">Last Scan</div>
            <div className="mt-1 text-sm font-medium text-emerald-800">{formatWhen(data.last_scan_at)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs font-semibold uppercase text-emerald-700">Frameworks</div>
            <div className="mt-1 text-2xl font-bold text-emerald-800">{data.frameworks.length}</div>
          </div>
        </div>

        {/* Framework scores */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-zinc-900">Compliance Scores</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.frameworks.map((fw) => (
              <div key={fw.framework} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{fw.framework_label}</p>
                <div className="mt-3 flex items-end gap-2">
                  <span className="text-3xl font-bold tabular-nums text-zinc-900">{fw.score_pct}%</span>
                  <span className="text-sm text-zinc-500">compliant</span>
                </div>
                {/* Score bar */}
                <div className="mt-3 h-2 rounded-full bg-zinc-200 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${fw.score_pct}%` }}
                  />
                </div>
                <div className="mt-3 flex gap-3 text-[11px] text-zinc-500">
                  <span className="text-emerald-600 font-semibold">{fw.passed} passed</span>
                  <span className="text-red-500 font-semibold">{fw.failed} failed</span>
                  {fw.no_data > 0 && <span>{fw.no_data} no data</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pt-8 pb-4">
          <div className="flex items-center justify-center gap-2 text-xs text-zinc-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <span>Powered by <strong>Vigil</strong></span>
          </div>
        </div>
      </div>
    </TrustShell>
  );
}

function TrustShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white">
      {children}
    </div>
  );
}
