import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { INTEGRATION_BRAND, type IntegrationBrandId } from "../lib/integrationBrands";

export type CloudProvider = "aws" | "gcp" | "azure";
/** Findings scope providers: cloud accounts + org-level aggregates. */
export type ScopeProvider = CloudProvider | "github" | "gitlab" | "all_cloud" | "source_control";

export type AccountOption = {
  id: string;
  label?: string | null;
  account_id: string | null;
  provider?: ScopeProvider;
};

const CONTEXT_PILL =
  "inline-flex h-10 items-center rounded-full border border-zinc-200/90 bg-white px-4 shadow-sm shadow-zinc-950/[0.03] transition-colors";

function ProviderBrandImg({
  provider,
  className,
  variant = "wordmark",
}: {
  provider: Exclude<ScopeProvider, "all_cloud" | "source_control">;
  className?: string;
  variant?: "wordmark" | "compact";
}) {
  const brand = INTEGRATION_BRAND[provider];
  const src = variant === "compact" && brand.compactSrc ? brand.compactSrc : brand.src;
  const fallback =
    variant === "compact" && brand.compactSrc
      ? brand.compactFallback ?? brand.fallback
      : brand.fallback;
  const imgClass = className
    ? `${className} shrink-0 object-contain`
    : variant === "compact"
      ? "h-[1.125rem] w-[1.125rem] shrink-0 object-contain object-center"
      : "h-[1.125rem] w-[2.25rem] shrink-0 object-contain object-left";
  return (
    <img
      src={src}
      alt=""
      className={imgClass}
      aria-hidden
      decoding="async"
      onError={
        fallback
          ? (e) => {
              if (e.currentTarget.src.endsWith(fallback)) return;
              e.currentTarget.onerror = null;
              e.currentTarget.src = fallback!;
            }
          : undefined
      }
    />
  );
}

export function ProviderMark({
  provider,
  className,
  variant = "wordmark",
}: {
  provider?: ScopeProvider;
  className?: string;
  variant?: "wordmark" | "compact";
}) {
  if (provider === "all_cloud") {
    return null;
  }
  if (provider === "source_control") {
    return <ProviderBrandImg provider="github" className={className} variant={variant} />;
  }
  return <ProviderBrandImg provider={provider ?? "aws"} className={className} variant={variant} />;
}

function ProviderMarkInternal({ provider, className }: { provider?: ScopeProvider; className?: string }) {
  return <ProviderMark provider={provider} className={className} />;
}

export function groupAccountId(id: string): string {
  return /^\d{12}$/.test(id) ? id.replace(/(\d{4})(?=\d)/g, "$1 ") : id;
}

export function providerDisplayName(provider?: ScopeProvider): string {
  switch (provider) {
    case "gcp":
      return "Google Cloud";
    case "azure":
      return "Microsoft Azure";
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "all_cloud":
      return "All accounts";
    case "source_control":
      return "Source control";
    default:
      return "AWS";
  }
}

/** Primary line for account pickers (label, or formatted external id). */
export function accountDisplayName(account: AccountOption & { scopeMeta?: string | null }): string {
  if (account.provider === "all_cloud") return "All accounts";
  if (account.provider === "source_control") return "Source control";
  if (account.label?.trim()) return account.label.trim();
  return groupAccountId(account.account_id ?? "");
}

/** Secondary line: "Provider · account_id" (or label when id is missing). */
export function accountDisplaySubtitle(account: AccountOption & { scopeMeta?: string | null }): string {
  if (account.scopeMeta?.trim()) return account.scopeMeta.trim();
  const provider = providerDisplayName(account.provider);
  const detail = groupAccountId(account.account_id ?? account.label ?? "");
  return `${provider} · ${detail}`;
}

/** Account ID line — matches Accounts page list rows. */
export function accountDisplayId(account: AccountOption & { scopeMeta?: string | null }): string {
  if (account.scopeMeta?.trim()) return account.scopeMeta.trim();
  return groupAccountId(account.account_id ?? account.label ?? "");
}

function relativeScan(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function scanDotClass(iso: string): string {
  const hrs = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hrs <= 26) return "bg-emerald-500";
  if (hrs <= 24 * 7) return "bg-amber-400";
  return "bg-rose-400";
}

function absoluteScan(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `today at ${time}` : `${date.toLocaleDateString()} at ${time}`;
}

export function LastScanChip({ iso }: { iso: string }) {
  const dotClass = scanDotClass(iso);
  return (
    <span
      className={`${CONTEXT_PILL} gap-2 text-sm font-medium tracking-[-0.01em] text-zinc-600`}
      title={`Last scan ${absoluteScan(iso)}`}
    >
      <span className="relative flex h-2 w-2 shrink-0 items-center justify-center" aria-hidden>
        <span className={`absolute inset-0 rounded-full opacity-30 ${dotClass}`} />
        <span className={`relative h-1.5 w-1.5 rounded-full ${dotClass}`} />
      </span>
      <span>
        Scanned <span className="font-semibold text-zinc-800">{relativeScan(iso)}</span>
      </span>
    </span>
  );
}

export function AccountSelect({
  accounts,
  value,
  onChange,
}: {
  accounts: AccountOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = accounts.find((a) => a.id === value) ?? accounts[0];

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!current) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${CONTEXT_PILL} max-w-[18rem] cursor-pointer gap-2.5 text-left border-zinc-200 bg-white shadow-sm shadow-zinc-950/[0.03] transition hover:border-zinc-300 hover:bg-zinc-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20 focus-visible:ring-offset-2 focus-visible:ring-offset-white`}
      >
        {current.provider !== "all_cloud" ? (
          <ProviderMarkInternal provider={current.provider} className="h-6 w-10" />
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-none tracking-[-0.02em] text-zinc-900">
          {current.label || groupAccountId(current.account_id ?? "")}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl shadow-zinc-950/10 ring-1 ring-zinc-100"
        >
          {accounts.map((a) => {
            const active = a.id === value;
            const hasLabel = !!a.label && a.label !== a.account_id;
            return (
              <button
                key={a.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(a.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ${
                  active ? "bg-indigo-50 text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                {a.provider !== "all_cloud" ? (
                  <ProviderMarkInternal provider={a.provider} className="h-5 w-10 shrink-0" />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold leading-tight tracking-[-0.02em]">
                    {hasLabel ? a.label : groupAccountId(a.account_id ?? "")}
                  </span>
                  {hasLabel ? (
                    <span className="mt-0.5 block truncate text-xs font-medium tabular-nums tracking-wide text-zinc-400">
                      {groupAccountId(a.account_id ?? "")}
                    </span>
                  ) : null}
                </span>
                {active && (
                  <svg className="h-4 w-4 shrink-0 text-indigo-600" fill="none" stroke="currentColor" strokeWidth={2.25} viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
              </button>
            );
          })}
          <Link
            to="/accounts"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 border-t border-zinc-100 px-4 py-3 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50/40"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
            Manage accounts
          </Link>
        </div>
      )}
    </div>
  );
}
