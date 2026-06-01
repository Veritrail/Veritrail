import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "../api";
import { PageCard, PageShell } from "../components/PageShell";
import { CHECK_FRAMEWORK_MAP } from "../data/checkFrameworkMap";
import { FRAMEWORKS } from "../data/frameworks";
import { InfoTip, Toggle } from "../components/SettingsUi";

type OptionalCheck = {
  check_id: string;
  label: string;
  summary: string;
  description: string;
  default_enabled: boolean;
  enabled: boolean;
};

type SettingsChecksData = {
  optional_checks: OptionalCheck[];
  evidence_classes?: Record<string, string>;
};

const EVIDENCE_CLASS_LEGEND = [
  { id: "benchmark", label: "Required benchmark mapping", desc: "Mapped to SOC 2 / CIS / ISO controls; drives pass/fail." },
  { id: "supporting", label: "Supporting evidence", desc: "Corroborates control objectives; extended-tier checks." },
  { id: "hygiene", label: "Operational checks", desc: "Optional operational checks not used in compliance scoring." },
] as const;

type SaveStatus = "idle" | "saving" | "saved" | "error";

const BENCHMARK_CHECK_COUNT = Object.keys(CHECK_FRAMEWORK_MAP).length;

const COVERAGE_AREAS = [
  {
    key: "identity",
    label: "Identity & access",
    descriptor: "IAM users, roles, keys, and org identity",
    prefix: /^iam\.|^github\.org|^gitlab\.org/,
    accent: "indigo",
  },
  {
    key: "storage",
    label: "Storage & encryption",
    descriptor: "S3, KMS, secrets, and data at rest",
    prefix: /^s3\.|^kms\.|^secretsmanager\.|^ssm\./,
    accent: "violet",
  },
  {
    key: "network",
    label: "Network & compute",
    descriptor: "EC2, VPC, RDS, load balancers, Lambda",
    prefix: /^ec2\.|^vpc\.|^elb\.|^rds\.|^lambda\.|^acm\./,
    accent: "sky",
  },
  {
    key: "logging",
    label: "Logging & monitoring",
    descriptor: "CloudTrail, GuardDuty, Config, Security Hub",
    prefix: /^cloudtrail\.|^guardduty\.|^aws\.|^vpc\.flow/,
    accent: "amber",
  },
  {
    key: "change",
    label: "Change management",
    descriptor: "Branch protection, reviews, repo policy",
    prefix: /^github\.repo|^gitlab\.repo/,
    accent: "emerald",
  },
] as const;

const accentStyles: Record<string, { icon: string; ring: string; card: string }> = {
  indigo: {
    icon: "bg-indigo-50 text-indigo-600 ring-indigo-100",
    ring: "hover:border-indigo-200/80",
    card: "from-indigo-50/30",
  },
  violet: {
    icon: "bg-violet-50 text-violet-600 ring-violet-100",
    ring: "hover:border-violet-200/80",
    card: "from-violet-50/30",
  },
  sky: {
    icon: "bg-sky-50 text-sky-600 ring-sky-100",
    ring: "hover:border-sky-200/80",
    card: "from-sky-50/30",
  },
  amber: {
    icon: "bg-amber-50 text-amber-600 ring-amber-100",
    ring: "hover:border-amber-200/80",
    card: "from-amber-50/25",
  },
  emerald: {
    icon: "bg-emerald-50 text-emerald-600 ring-emerald-100",
    ring: "hover:border-emerald-200/80",
    card: "from-emerald-50/25",
  },
  zinc: {
    icon: "bg-zinc-100 text-zinc-600 ring-zinc-200/80",
    ring: "hover:border-zinc-300",
    card: "from-zinc-50/40",
  },
};

function areaCounts() {
  const ids = Object.keys(CHECK_FRAMEWORK_MAP);
  const used = new Set<string>();
  const rows = COVERAGE_AREAS.map((area) => {
    const matched = ids.filter((id) => area.prefix.test(id));
    matched.forEach((id) => used.add(id));
    return { ...area, count: matched.length };
  }).filter((r) => r.count > 0);
  const other = ids.filter((id) => !used.has(id)).length;
  if (other > 0) {
    rows.push({
      key: "other",
      label: "Other services",
      descriptor: "DynamoDB, SNS, SQS, and additional AWS services",
      prefix: /^$/,
      accent: "zinc" as const,
      count: other,
    });
  }
  return rows;
}

function DomainIcon({ areaKey }: { areaKey: string }) {
  const cls = "h-5 w-5";
  if (areaKey === "identity") {
    return (
      <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
      </svg>
    );
  }
  if (areaKey === "storage") {
    return (
      <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
      </svg>
    );
  }
  if (areaKey === "network") {
    return (
      <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008H12v-.008z" />
      </svg>
    );
  }
  if (areaKey === "logging") {
    return (
      <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    );
  }
  if (areaKey === "change") {
    return (
      <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    );
  }
  return (
    <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function SaveIndicator({ status, error }: { status: SaveStatus; error?: string }) {
  if (status === "idle") return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
        status === "error" ? "text-red-600" : status === "saved" ? "text-emerald-600" : "text-zinc-400"
      }`}
    >
      {status === "saving" && (
        <>
          <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Saving…
        </>
      )}
      {status === "saved" && "All changes saved"}
      {status === "error" && "Could not save changes"}
    </span>
  );
}

export default function DetectionCoverage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<SettingsChecksData>({
    queryKey: ["settings"],
    queryFn: () => api("/v1/settings"),
  });

  const [optionalChecks, setOptionalChecks] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!data) return;
    const optional: Record<string, boolean> = {};
    for (const check of data.optional_checks ?? []) {
      optional[check.check_id] = check.enabled;
    }
    setOptionalChecks(optional);
    setHydrated(true);
  }, [data]);

  const enabledOptional = useMemo(
    () => (data?.optional_checks ?? []).filter((c) => optionalChecks[c.check_id] ?? c.default_enabled).length,
    [data, optionalChecks],
  );

  const optionalTotal = data?.optional_checks.length ?? 0;
  const areas = useMemo(() => areaCounts(), []);

  const mutation = useMutation({
    mutationFn: (checks: Record<string, { enabled: boolean }>) =>
      api("/v1/settings", { method: "PATCH", body: JSON.stringify({ checks }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      setSaveStatus("saved");
      setSaveError("");
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
    onError: (err) => {
      setSaveStatus("error");
      setSaveError(formatApiError(err));
    },
  });

  const persistChecks = useCallback(
    (next: Record<string, boolean>) => {
      const checks: Record<string, { enabled: boolean }> = {};
      for (const [checkId, enabled] of Object.entries(next)) {
        checks[checkId] = { enabled };
      }
      setSaveStatus("saving");
      mutation.mutate(checks);
    },
    [mutation],
  );

  function toggleOptionalCheck(checkId: string) {
    setOptionalChecks((prev) => {
      const fallback =
        data?.optional_checks.find((c) => c.check_id === checkId)?.default_enabled ?? false;
      const current = prev[checkId] ?? fallback;
      const next = { ...prev, [checkId]: !current };
      if (hydrated) {
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => persistChecks(next), 450);
      }
      return next;
    });
  }

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  if (isLoading) {
    return (
      <div className="flex h-64 w-full items-center justify-center text-sm text-zinc-400">
        Loading detection coverage…
      </div>
    );
  }

  return (
    <PageShell
      eyebrow="Scan scope"
      title="Detection"
      description="What Vigil evaluates in your environment and what counts toward compliance pass/fail."
      actions={<SaveIndicator status={saveStatus} error={saveError} />}
      width="max-w-none"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Benchmark checks</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-950">{BENCHMARK_CHECK_COUNT}</p>
          <p className="mt-0.5 text-xs text-zinc-500">Always on · drives Compliance</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Optional modules</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-950">
            {enabledOptional}
            <span className="text-base font-medium text-zinc-400">/{optionalTotal}</span>
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">Adds visibility beyond pass/fail</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Frameworks</p>
          <p className="mt-1 text-sm font-semibold text-zinc-900">{FRAMEWORKS.map((f) => f.label).join(" · ")}</p>
          <Link to="/controls" className="mt-1 inline-block text-xs font-medium text-indigo-600 hover:text-indigo-800">
            View compliance posture
          </Link>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-8">
          <PageCard title="How checks are classified" description="Pass/fail uses benchmark mapping only. Optional checks add Findings without changing control scores unless enabled.">
            <div className="grid gap-3 p-4 sm:grid-cols-3">
              {EVIDENCE_CLASS_LEGEND.map((item) => (
                <div key={item.id} className="rounded-lg border border-zinc-100 bg-zinc-50/80 px-3 py-2.5">
                  <p className="text-xs font-bold text-zinc-900">{item.label}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{item.desc}</p>
                </div>
              ))}
            </div>
          </PageCard>

          <PageCard
            title="Core detection domains"
            description="Benchmark-backed areas — always scanned. Results map to SOC 2, CIS, and ISO controls."
          >
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {areas.map((area) => {
                const style = accentStyles[area.accent] ?? accentStyles.zinc;
                return (
                  <div
                    key={area.key}
                    className={`rounded-lg border border-zinc-200 bg-white p-3 shadow-sm shadow-zinc-950/[0.02] transition ${style.ring}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className={`rounded-md p-1.5 ring-1 ${style.icon}`}>
                        <DomainIcon areaKey={area.key} />
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold tabular-nums leading-none text-zinc-900">{area.count}</p>
                        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">checks</p>
                      </div>
                    </div>
                    <h3 className="mt-2 text-sm font-semibold text-zinc-900">{area.label}</h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{area.descriptor}</p>
                    <p className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                      Scanning
                    </p>
                  </div>
                );
              })}
            </div>
          </PageCard>

          <PageCard
            title="Optional security checks"
            description="Optional modules are not included in compliance scoring unless enabled. Changes apply after the next scan."
            action={
              <span className="text-xs font-medium text-zinc-500">
                {enabledOptional} of {optionalTotal} enabled
              </span>
            }
          >
            <div className="grid grid-cols-1 gap-2.5 p-4 lg:grid-cols-2">
              {(data?.optional_checks ?? []).map((check) => {
                const enabled = optionalChecks[check.check_id] ?? check.default_enabled;
                return (
                  <div
                    key={check.check_id}
                    className={`rounded-lg border p-3 transition ${
                      enabled
                        ? "border-sky-200/70 bg-white shadow-sm shadow-sky-950/[0.03] ring-1 ring-sky-500/5"
                        : "border-dashed border-zinc-200/90 bg-white shadow-sm shadow-zinc-950/[0.02] hover:border-zinc-300/90"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          enabled
                            ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200/60"
                            : "bg-zinc-50 text-zinc-600 ring-1 ring-zinc-200/70"
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-sky-500" : "bg-zinc-300"}`} aria-hidden />
                        {enabled ? "On" : "Off"}
                      </span>
                      <Toggle checked={enabled} onChange={() => toggleOptionalCheck(check.check_id)} />
                    </div>
                    <div className="mt-2 flex items-start gap-1.5">
                      <h3 className="text-sm font-semibold text-zinc-900">{check.label}</h3>
                      <InfoTip text={check.description} />
                    </div>
                    <p className="mt-0.5 text-xs leading-snug text-zinc-600">{check.summary}</p>
                    <p className="mt-1.5 font-mono text-[10px] text-zinc-400">{check.check_id}</p>
                    {enabled ? (
                      <p className="mt-1.5 text-[11px] text-sky-700">Shows in Findings. Compliance pass/fail unchanged unless benchmark-mapped.</p>
                    ) : (
                      <p className="mt-1.5 text-[11px] text-zinc-400">Off — not scanned.</p>
                    )}
                  </div>
                );
              })}
            </div>

            {(data?.optional_checks ?? []).length === 0 && (
              <p className="py-8 text-center text-sm text-zinc-400">No optional capabilities available.</p>
            )}
          </PageCard>
        </div>

        <div className="space-y-5 lg:col-span-4">
          <PageCard title="Scan behavior" description="How changes on this page affect scanning and compliance.">
            <div className="space-y-3 px-4 py-3 text-sm">
              <div>
                <p className="text-sm font-semibold text-zinc-900">Benchmark checks always run</p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                  These checks map to SOC 2, CIS, and ISO controls and drive pass/fail.
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-900">Optional modules add visibility</p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                  Optional checks surface additional Findings and evidence. They only affect compliance when they are benchmark-mapped and enabled.
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-900">Changes appear after the next scan</p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                  Turning modules on/off updates what gets evaluated on the next scheduled or manual scan.
                </p>
              </div>
              <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
                <p className="text-xs font-semibold text-zinc-700">Tip</p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                  If you enable a module, run a scan to populate its findings sooner.
                </p>
              </div>
            </div>
          </PageCard>
        </div>
      </div>
    </PageShell>
  );
}
