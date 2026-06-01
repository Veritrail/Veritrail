import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
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
      {status === "error" && (error ?? "Could not save")}
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
      setSaveError((err as Error).message);
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
    <div className="w-full max-w-5xl space-y-5 pb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-950">Detection coverage</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            Scanning domains, benchmark checks, and optional operational modules.
          </p>
        </div>
        <SaveIndicator status={saveStatus} error={saveError} />
      </div>

      <div className="flex flex-wrap items-center gap-5 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm shadow-zinc-950/[0.02]">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-100 text-emerald-700">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
          </span>
          <div><span className="text-lg font-bold tabular-nums text-zinc-950">{BENCHMARK_CHECK_COUNT}</span> <span className="text-xs text-zinc-500">benchmark checks</span></div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-100 text-indigo-700">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.821 3.298c.775-.757 1.923-.997 2.927-.997 1.004 0 2.152.24 2.927.997m0 0l2.25 2.25m-2.25-2.25v4.5" /></svg>
          </span>
          <div><span className="text-sm font-semibold text-zinc-800">{FRAMEWORKS.map((f) => f.label).join(" · ")}</span> <Link to="/controls" className="text-xs font-medium text-indigo-600 hover:text-indigo-800">View posture →</Link></div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-sky-100 text-sky-700">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </span>
          <div><span className="text-sm font-semibold text-zinc-800">{enabledOptional}</span><span className="text-xs text-zinc-500">/{optionalTotal} optional enabled</span></div>
        </div>
      </div>

      <section className="space-y-3">
        <div className="border-b border-zinc-200/80 pb-2">
          <h2 className="text-sm font-bold text-zinc-900">Core detection domains</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Benchmark-backed modules — always active. Pass/fail on{" "}
            <Link to="/controls" className="font-medium text-indigo-600 hover:text-indigo-800">
              Compliance
            </Link>
            .
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/50 p-4">
        <div className="border-b border-zinc-200/80 pb-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-sm font-bold text-zinc-900">Optional security checks</h2>
            <span className="text-xs font-medium text-zinc-500">
              {enabledOptional} of {optionalTotal} enabled
            </span>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            Extend visibility beyond benchmark requirements.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
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
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      enabled
                        ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200/60"
                        : "bg-zinc-50 text-zinc-600 ring-1 ring-zinc-200/70"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-sky-500" : "bg-zinc-300"}`}
                      aria-hidden
                    />
                    {enabled ? "Active" : "Not enabled"}
                  </span>
                  <Toggle checked={enabled} onChange={() => toggleOptionalCheck(check.check_id)} />
                </div>
                <div className="mt-2 flex items-start gap-1.5">
                  <h3 className="text-sm font-semibold text-zinc-900">{check.label}</h3>
                  <InfoTip text={check.description} />
                </div>
                <p className="mt-0.5 text-xs leading-snug text-zinc-600">{check.summary}</p>
                <p className="mt-1.5 font-mono text-[10px] text-zinc-400">{check.check_id}</p>
                {enabled && (
                  <p className="mt-1.5 text-[11px] text-sky-700">
                    Included in Findings and evidence on next scan.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {(data?.optional_checks ?? []).length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-400">No optional capabilities available.</p>
        )}
      </section>
    </div>
  );
}
