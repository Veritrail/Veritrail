import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { SafeExternalImage } from "../components/SafeExternalImage";
import { publicApi } from "../api";

type TrustFrameworkRef = {
  framework: string;
  framework_label: string;
};

type TrustDocumentRef = {
  id: string;
  label: string;
  availability: string;
};

type TrustCenterData = {
  company_name: string;
  company_logo_url: string | null;
  custom_message: string | null;
  monitoring_active: boolean;
  refresh_cadence: string;
  scan_freshness: string;
  scan_freshness_label: string;
  auditor_access_model: string;
  frameworks: TrustFrameworkRef[];
  monitoring_areas: string[];
  documents: TrustDocumentRef[];
};

const REFRESH_LABELS: Record<string, string> = {
  daily: "Daily automated scans",
};

const ACCESS_LABELS: Record<string, string> = {
  private_invite: "Private auditor portal (invite only)",
};

function documentAvailabilityLabel(code: string): string {
  if (code === "on_request") return "Available on request";
  if (code === "not_published") return "Not published";
  return code.replace(/_/g, " ");
}

function RequestReportCard({ slug, companyName }: { slug?: string; companyName: string }) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const submit = useMutation({
    mutationFn: () =>
      publicApi(`/trust/${slug}/request-access`, {
        method: "POST",
        body: JSON.stringify({ email, company, message }),
      }),
  });

  if (submit.isSuccess) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6 text-center">
        <p className="text-sm font-semibold text-emerald-800">Request sent</p>
        <p className="mt-1 text-sm text-emerald-700">
          {companyName} has been notified and will follow up with the report under NDA.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (email) submit.mutate();
      }}
      className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-base font-bold text-zinc-900">Request the report</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">
        SOC&nbsp;2 and other compliance reports are shared under NDA. Tell us where to send it.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Work email"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400"
        />
        <input
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Company (optional)"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400"
        />
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Anything we should know? (optional)"
        rows={2}
        className="mt-3 w-full resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-400"
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={!email || submit.isPending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submit.isPending ? "Sending…" : "Request access"}
        </button>
        {submit.isError && <span className="text-sm text-red-600">Could not send — try again.</span>}
      </div>
    </form>
  );
}

export default function TrustCenter() {
  const { slug } = useParams<{ slug: string }>();

  const { data, isLoading, error } = useQuery<TrustCenterData>({
    queryKey: ["trust-center", slug],
    queryFn: () => publicApi<TrustCenterData>(`/trust/${slug}`),
  });

  if (isLoading) {
    return (
      <TrustShell>
        <div className="py-20 text-center text-zinc-400">Loading security profile…</div>
      </TrustShell>
    );
  }
  if (error || !data) {
    return (
      <TrustShell>
        <div className="py-20 text-center">
          <h1 className="text-2xl font-bold text-zinc-700">Security profile not found</h1>
          <p className="mt-2 text-zinc-500">This organization&apos;s public page is not available.</p>
        </div>
      </TrustShell>
    );
  }

  const frameworkNames = data.frameworks.map((fw) => fw.framework_label).join(", ") || "selected frameworks";

  return (
    <TrustShell>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
        <section className="rounded-2xl border border-zinc-200 bg-white p-7 shadow-sm">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <SafeExternalImage
                src={data.company_logo_url}
                alt={data.company_name}
                className="h-14 w-14 shrink-0 rounded-xl border border-zinc-200 bg-white object-contain p-2"
                fallback={
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-xl font-bold text-zinc-400">
                    {data.company_name.slice(0, 1)}
                  </div>
                }
              />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#439385]">Security profile</p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900">{data.company_name}</h1>
                <p className="mt-1 text-sm text-zinc-500">Continuous compliance monitoring summary</p>
                {data.custom_message && (
                  <p className="mt-3 max-w-lg text-sm leading-relaxed text-zinc-600">&ldquo;{data.custom_message}&rdquo;</p>
                )}
              </div>
            </div>
            <StatusPill active={data.monitoring_active} />
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <SignalCard
            title="Monitoring"
            value={data.monitoring_active ? "Active" : "Pending"}
            detail={data.scan_freshness_label}
          />
          <SignalCard
            title="Evidence refresh"
            value={REFRESH_LABELS[data.refresh_cadence] ?? data.refresh_cadence}
            detail={`Frameworks: ${frameworkNames}`}
          />
          <SignalCard
            title="Auditor access"
            value={ACCESS_LABELS[data.auditor_access_model] ?? data.auditor_access_model}
            detail="Detailed evidence shared privately with invited auditors."
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-zinc-900">Security controls monitored</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">
              Automated posture checks mapped to industry frameworks. Detailed findings stay in the private workspace.
            </p>
            <ul className="mt-4 space-y-2.5 text-sm text-zinc-700">
              {data.monitoring_areas.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-[#439385]">
                    <CheckIcon />
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
              {data.frameworks.map((fw) => (
                <FrameworkBadge key={fw.framework} label={fw.framework_label} />
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-zinc-900">Documents</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">
              Compliance artifacts are shared on request — not published as a live scorecard.
            </p>
            <ul className="mt-4 divide-y divide-zinc-100">
              {data.documents.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                  <span className="text-sm font-medium text-zinc-800">{doc.label}</span>
                  <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-600">
                    {documentAvailabilityLabel(doc.availability)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <RequestReportCard slug={slug} companyName={data.company_name} />

        <p className="border-t border-zinc-200 pt-4 text-center text-xs leading-relaxed text-zinc-400">
          This page is a high-level security profile only. It does not list findings, control gaps, resource names, or
          account identifiers. Auditors receive scoped access through a separate private portal.
        </p>

        <div className="flex items-center justify-center gap-2 pb-6 text-xs text-zinc-400">
          <ShieldIcon className="h-4 w-4" />
          <span>
            Powered by <strong className="text-zinc-500">Veritrail</strong> — continuous compliance evidence
          </span>
        </div>
      </div>
    </TrustShell>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${
        active
          ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
          : "bg-zinc-100 text-zinc-600 ring-zinc-200"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${active ? "bg-emerald-500" : "bg-zinc-400"}`} aria-hidden />
      {active ? "Monitoring active" : "Monitoring pending"}
    </span>
  );
}

function SignalCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{title}</p>
      <p className="mt-1 text-sm font-bold text-zinc-900">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">{detail}</p>
    </div>
  );
}

function FrameworkBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200">
      {label}
    </span>
  );
}

function TrustShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white">{children}</div>;
}

function ShieldIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.96 11.96 0 0 1 3.6 6 12 12 0 0 0 3 9.75c0 5.6 3.82 10.3 9 11.62 5.18-1.33 9-6.03 9-11.62 0-1.31-.21-2.57-.6-3.75h-.15A11.96 11.96 0 0 1 12 2.71Z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}
