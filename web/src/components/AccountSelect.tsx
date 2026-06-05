import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AzureMark, GcpMark } from "./IntegrationsUi";

export type CloudProvider = "aws" | "gcp" | "azure";

export type AccountOption = {
  id: string;
  label?: string | null;
  account_id: string | null;
  provider?: CloudProvider;
};

function AwsMark({ className }: { className?: string }) {
  return <img src="/aws-account-icon.png" alt="" className={`${className ?? ""} object-contain`} aria-hidden />;
}

function CloudIcon({ className }: { className?: string }) {
  return (
    <svg className={`${className ?? ""} text-zinc-400`} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
    </svg>
  );
}

/** Neutral cloud today; GCP/Azure marks are wired but dark until those
 *  connectors ship (accounts never carry those providers yet). */
function ProviderMark({ provider, className }: { provider?: CloudProvider; className?: string }) {
  if (provider === "gcp") return <GcpMark className={className} />;
  if (provider === "azure") return <AzureMark className={className} />;
  return <AwsMark className={className} />;
}

export function groupAccountId(id: string): string {
  return /^\d{12}$/.test(id) ? id.replace(/(\d{4})(?=\d)/g, "$1 ") : id;
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
  return (
    <span
      className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#d9e1ec] bg-white px-3.5 text-[15px] font-semibold tracking-[-0.01em] text-[#344054] shadow-sm shadow-zinc-950/[0.03]"
      title={`Last scan ${absoluteScan(iso)}`}
    >
      <span className={`h-2 w-2 rounded-full ${scanDotClass(iso)}`} aria-hidden />
      Scanned {relativeScan(iso)}
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
		        className="inline-flex h-9 min-w-[245px] cursor-pointer items-center gap-2.5 rounded-[10px] border border-[#d9e1ec] bg-white px-3 text-left shadow-sm shadow-zinc-950/[0.03] transition hover:border-[#c5d0dd] hover:bg-[#fbfdff]"
		      >
		        <ProviderMark provider={current.provider} className="h-6 w-6 shrink-0" />
		        <span className="min-w-0 flex-1 truncate text-[17px] font-bold leading-none tracking-[-0.02em] text-[#111827]">
		          {current.label || groupAccountId(current.account_id ?? "")}
		        </span>
		        <svg className={`h-[18px] w-[18px] shrink-0 text-[#98a2b3] transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.25} viewBox="0 0 24 24" aria-hidden>
		          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
		        </svg>
		      </button>

      {open && (
		        <div
		          role="listbox"
		          className="absolute left-0 top-full z-30 mt-2 w-[360px] overflow-hidden rounded-2xl border border-[#e4e9f1] bg-white shadow-xl shadow-zinc-900/10"
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
		                className={`flex w-full items-center gap-4 px-5 py-4 text-left transition ${active ? "bg-[#f8fafc]" : "hover:bg-[#fbfdff]"}`}
		              >
		                <ProviderMark provider={a.provider} className="h-9 w-9 shrink-0" />
		                <span className="min-w-0 flex-1">
		                  <span className="block truncate text-[20px] font-bold leading-tight tracking-[-0.02em] text-[#111827]">
		                    {hasLabel ? a.label : groupAccountId(a.account_id ?? "")}
		                  </span>
		                  <span className="mt-1 block text-[16px] font-medium tabular-nums tracking-[0.08em] text-[#98a2b3]">
		                    {groupAccountId(a.account_id ?? "")}
		                  </span>
	                </span>
	                {active && (
	                  <svg className="h-5 w-5 shrink-0 text-indigo-600" fill="none" stroke="currentColor" strokeWidth={2.25} viewBox="0 0 24 24" aria-hidden>
	                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
	                  </svg>
                )}
              </button>
            );
          })}
	          <Link
	            to="/accounts"
	            onClick={() => setOpen(false)}
		            className="flex items-center gap-3.5 border-t border-[#eef2f6] px-5 py-4 text-[20px] font-medium tracking-[-0.02em] text-[#635bff] transition hover:bg-indigo-50/50"
		          >
		            <svg className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
	              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
	            </svg>
            Manage accounts
          </Link>
        </div>
      )}
    </div>
  );
}
