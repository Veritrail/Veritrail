import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

/* No-account first-run screen. Design 2 skeleton (three capability cards across)
   in a light theme, with Design 1's "What to expect" value beat. Capabilities
   are ADDITIVE, not exclusive: Core scanner is required + locked on; IAM
   analysis and Remediation are optional add-ons. "Continue" hands off to the
   real CloudFormation deploy flow on /accounts. */

type CapabilityId = "core" | "iam" | "remediation";

type Capability = {
  id: CapabilityId;
  name: string;
  blurb: string;
  required?: boolean;
  access: { label: string; tone: "read" | "approval" };
  icon: JSX.Element;
};

const CAPABILITIES: Capability[] = [
  {
    id: "core",
    name: "Core scanner",
    blurb: "Read-only cloud evidence to scan configurations and resources.",
    required: true,
    access: { label: "Read-only", tone: "read" },
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" />,
  },
  {
    id: "iam",
    name: "IAM analysis",
    blurb: "Analyze identities and permissions to surface least-privilege gaps.",
    access: { label: "Read-only", tone: "read" },
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.5a3 3 0 00-6 0M12 11a3 3 0 100-6 3 3 0 000 6zM19.5 19.5a2.5 2.5 0 00-4-2M4.5 19.5a2.5 2.5 0 014-2" />,
  },
  {
    id: "remediation",
    name: "Remediation",
    blurb: "Create and apply fixes through approval workflows you control.",
    access: { label: "Approval", tone: "approval" },
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L6.34 20.25a2 2 0 01-2.83-2.83l5.08-5.08m2.83 2.83l4.24-4.24m-4.24 4.24a4 4 0 015.5-5.46l-2.3 2.3 1.83 1.83 2.3-2.3a4 4 0 01-5.46 5.5" />,
  },
];

const EXPECT = [
  {
    title: "Discover",
    text: "We scan your environment using read-only access.",
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 110-14 7 7 0 010 14z" />,
  },
  {
    title: "Understand",
    text: "See findings and risks mapped to controls.",
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  },
  {
    title: "Improve",
    text: "Prioritize and remediate with confidence.",
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8M21 7v6m0-6h-6" />,
  },
];

const STEPS = ["Capabilities", "Deploy", "Verify"] as const;

function AccessBadge({ tone, label }: { tone: "read" | "approval"; label: string }) {
  const cls =
    tone === "approval"
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : "bg-emerald-50 text-emerald-700 ring-emerald-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${cls}`}>
      <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V7.5a4.5 4.5 0 00-9 0v3M6 10.5h12a1.5 1.5 0 011.5 1.5v6A1.5 1.5 0 0118 19.5H6A1.5 1.5 0 014.5 18v-6A1.5 1.5 0 016 10.5z" />
      </svg>
      {label}
    </span>
  );
}

export default function ConnectAwsEmptyState() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Record<CapabilityId, boolean>>({
    core: true,
    iam: false,
    remediation: false,
  });

  const toggle = (cap: Capability) => {
    if (cap.required) return;
    setSelected((s) => ({ ...s, [cap.id]: !s[cap.id] }));
  };

  const summary = useMemo(() => {
    const names = CAPABILITIES.filter((c) => selected[c.id]).map((c) => c.name);
    return { count: names.length, names };
  }, [selected]);

  return (
    <div className="flex w-full flex-1 items-start justify-center py-6">
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        {/* Stepper */}
        <div className="flex items-center gap-3 border-b border-zinc-100 px-7 py-5">
          {STEPS.map((label, i) => {
            const active = i === 0;
            return (
              <div key={label} className="flex flex-1 items-center gap-3 last:flex-none">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    active ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-400"
                  }`}
                >
                  {i + 1}
                </span>
                <span className={`text-sm font-medium ${active ? "text-zinc-900" : "text-zinc-400"}`}>{label}</span>
                {i < STEPS.length - 1 && <span className="h-px flex-1 bg-zinc-200" />}
              </div>
            );
          })}
        </div>

        <div className="px-7 py-7">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">Connect your cloud account</h2>
          <p className="mt-1.5 text-sm text-zinc-500">Choose the capabilities you want to enable.</p>

          {/* Capability cards — three across */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {CAPABILITIES.map((cap) => {
              const on = selected[cap.id];
              return (
                <button
                  key={cap.id}
                  type="button"
                  onClick={() => toggle(cap)}
                  aria-pressed={on}
                  disabled={cap.required}
                  className={`group relative flex flex-col rounded-xl border p-4 text-left transition-all ${
                    on
                      ? "border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500/20"
                      : "border-zinc-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/30"
                  } ${cap.required ? "cursor-default" : "cursor-pointer"}`}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                        on
                          ? "bg-indigo-100 text-indigo-600"
                          : "bg-zinc-100 text-zinc-500 group-hover:bg-indigo-100 group-hover:text-indigo-600"
                      }`}
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                        {cap.icon}
                      </svg>
                    </span>
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-md border transition-colors ${
                        on ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-300 bg-white text-transparent"
                      }`}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-zinc-900">{cap.name}</span>
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                        cap.required ? "bg-indigo-50 text-indigo-700" : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {cap.required ? "Required" : "Optional"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500">{cap.blurb}</p>
                  <div className="mt-3">
                    <AccessBadge tone={cap.access.tone} label={cap.access.label} />
                  </div>
                </button>
              );
            })}
          </div>

          {/* What to expect — Design 1's value beat */}
          <div className="mt-7 grid grid-cols-1 gap-5 border-t border-zinc-100 pt-6 sm:grid-cols-3">
            {EXPECT.map((e) => (
              <div key={e.title} className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                    {e.icon}
                  </svg>
                </span>
                <div>
                  <p className="text-sm font-semibold text-zinc-900">{e.title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-zinc-500">{e.text}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Trust line */}
          <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-zinc-50 px-4 py-3 text-[13px] text-zinc-500">
            <svg className="h-4 w-4 text-zinc-400" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V7.5a4.5 4.5 0 00-9 0v3M6 10.5h12a1.5 1.5 0 011.5 1.5v6A1.5 1.5 0 0118 19.5H6A1.5 1.5 0 014.5 18v-6A1.5 1.5 0 016 10.5z" />
            </svg>
            <span className="font-medium text-zinc-600">Read-only by default.</span>
            <span>Secure, auditable, revocable anytime · No changes to your resources · You're in control.</span>
          </div>
        </div>

        {/* Footer: selection summary + continue */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 bg-zinc-50/60 px-7 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-indigo-600 ring-1 ring-zinc-200">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 12h9.75m-9.75 6h9.75M3.75 6h.008v.008H3.75V6zm.375 6a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 6a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
            </span>
            <div className="text-sm">
              <p className="font-medium text-zinc-900">
                {summary.count} capabilit{summary.count === 1 ? "y" : "ies"} selected
              </p>
              <p className="text-[13px] text-zinc-500">{summary.names.join(" · ")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/accounts")}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            Continue
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
