import { useState, useEffect, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError, storeTokens } from "../api";
import { meSchema, workspaceListSchema, type Me } from "../lib/apiSchemas";

type WorkspaceEntry = {
  org_id: string;
  org_name: string;
  role: string;
};

type MfaSetup = {
  secret: string;
  provisioning_uri: string;
  qr_data_url: string | null;
};

function nameParts(email: string): string[] {
  return (email.split("@")[0] || "")
    .replace(/[._+-]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function initialsFromEmail(email: string): string {
  const parts = nameParts(email);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.slice(0, 2) || "?").toUpperCase();
}

function displayNameFromEmail(email: string): string {
  const parts = nameParts(email);
  if (!parts.length) return email;
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

type PasswordStrength = {
  label: "Waiting" | "Weak" | "Fair" | "Good" | "Strong";
  tone: "empty" | "weak" | "fair" | "good" | "strong";
  score: number;
  width: string;
  message: string;
};

function getPasswordStrength(value: string): PasswordStrength {
  if (!value) {
    return { label: "Waiting", tone: "empty", score: 0, width: "w-1/4", message: "Use 12+ characters with a mix of character types." };
  }

  const lower = /[a-z]/.test(value);
  const upper = /[A-Z]/.test(value);
  const digit = /\d/.test(value);
  const symbol = /[^A-Za-z0-9]/.test(value);
  const uniqueRatio = new Set(value).size / value.length;
  const onlyDigits = /^\d+$/.test(value);
  const onlyLetters = /^[A-Za-z]+$/.test(value);
  const repeated = /(.)\1{2,}/.test(value);
  const sequential = /(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|asdf|zxcv)/i.test(value);

  let score = 0;
  if (value.length >= 12) score += 1;
  if (value.length >= 16) score += 1;
  if ([lower, upper, digit, symbol].filter(Boolean).length >= 3) score += 1;
  if ([lower, upper, digit, symbol].filter(Boolean).length === 4) score += 1;
  if (uniqueRatio > 0.65) score += 1;
  if (onlyDigits || onlyLetters) score -= 2;
  if (repeated) score -= 1;
  if (sequential) score -= 1;

  score = Math.max(0, Math.min(4, score));
  if (score >= 4) return { label: "Strong", tone: "strong", score, width: "w-full", message: "Good mix of length, variety, and uniqueness." };
  if (score === 3) return { label: "Good", tone: "good", score, width: "w-3/4", message: "This is usable, but more variety would help." };
  if (score === 2) return { label: "Fair", tone: "fair", score, width: "w-1/2", message: "Add more character variety or length." };
  return { label: "Weak", tone: "weak", score, width: "w-1/4", message: onlyDigits ? "Numbers alone are easy to guess." : "Use more length and variety." };
}

function strengthTextClass(tone: PasswordStrength["tone"]): string {
  if (tone === "strong" || tone === "good") return "text-emerald-600";
  if (tone === "fair") return "text-amber-600";
  if (tone === "weak") return "text-red-600";
  return "text-slate-400";
}

function strengthBarClass(tone: PasswordStrength["tone"]): string {
  if (tone === "strong" || tone === "good") return "bg-emerald-500";
  if (tone === "fair") return "bg-amber-500";
  if (tone === "weak") return "bg-red-500";
  return "bg-slate-300";
}

function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const common = { className, fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24", "aria-hidden": true };
  switch (name) {
    case "check":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4.2 4.2L19 7" /></svg>;
    case "mail":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 7.5v9a2.25 2.25 0 0 1-2.25 2.25h-15A2.25 2.25 0 0 1 2.25 16.5v-9m19.5 0A2.25 2.25 0 0 0 19.5 5.25h-15A2.25 2.25 0 0 0 2.25 7.5m19.5 0-8.7 5.8a2.25 2.25 0 0 1-2.5 0L2.25 7.5" /></svg>;
    case "globe":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m-9 9h18" /></svg>;
    case "building":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 21V5.25A2.25 2.25 0 0 1 6.75 3h6a2.25 2.25 0 0 1 2.25 2.25V21m-10.5 0h15m-15 0H3m12 0h6m-10.5 0v-3.375c0-.621-.504-1.125-1.125-1.125h-.75c-.621 0-1.125.504-1.125 1.125V21m1.5-13.5h.008v.008H9V7.5Zm0 3h.008v.008H9V10.5Zm0 3h.008v.008H9V13.5Zm3-6h.008v.008H12V7.5Zm0 3h.008v.008H12V10.5Zm0 3h.008v.008H12V13.5Z" /></svg>;
    case "wrench":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M14.7 6.3a4.5 4.5 0 0 0-5.72 5.72l-5.49 5.49a2.1 2.1 0 0 0 2.97 2.97l5.49-5.49a4.5 4.5 0 0 0 5.72-5.72l-2.8 2.8-2.17-2.17 2.8-2.8Z" /></svg>;
    case "shield":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.96 11.96 0 0 1 3.6 6 12 12 0 0 0 3 9.75c0 5.59 3.82 10.29 9 11.62 5.18-1.33 9-6.03 9-11.62 0-1.31-.21-2.57-.6-3.75h-.15a11.96 11.96 0 0 1-8.25-3.29Z" /></svg>;
    case "crown":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 8.25 4.5 3.5L12 6l3 5.75 4.5-3.5-1.5 8.25h-12L4.5 8.25Zm2.25 11.25h10.5" /></svg>;
    case "lock":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>;
    case "key":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.03 5.91c-.56-.1-1.16.03-1.56.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.82c0-.6.24-1.17.66-1.59l6.5-6.5c.4-.4.52-1 .43-1.56A6 6 0 1 1 21.75 8.25Z" /></svg>;
    case "phone":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.28 6.72 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.37c0-.52-.35-.98-.85-1.1l-4.42-1.1c-.44-.11-.9.05-1.18.41l-.97 1.24a1.13 1.13 0 0 1-1.46.3 12.04 12.04 0 0 1-5.36-5.36 1.13 1.13 0 0 1 .3-1.46l1.24-.97c.36-.28.52-.74.41-1.18L8.36 4.5a1.13 1.13 0 0 0-1.1-.85H5.9A3.65 3.65 0 0 0 2.25 7.3v-.55Z" /></svg>;
    case "user":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 7.5a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.25a7.5 7.5 0 0 1 15 0" /></svg>;
    case "refresh":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M16.02 9.35h4.16V5.19M20.18 9.35A8.25 8.25 0 0 0 5.82 6.3M7.98 14.65H3.82v4.16M3.82 14.65a8.25 8.25 0 0 0 14.36 3.05" /></svg>;
    case "clock":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l3.5 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>;
    case "fingerprint":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 12.75a4.5 4.5 0 0 1 9 0M9.75 12.75a2.25 2.25 0 0 1 4.5 0m-8.1 2.75c.58 1.63 1.72 2.82 3.35 3.5m5-15.25A8.25 8.25 0 0 0 3.75 11.6m16.5 0A8.25 8.25 0 0 0 11.4 3.35m5.95 12.15c-.58 1.63-1.72 2.82-3.35 3.5m-2-6.25c0 3.25-1.05 5.6-3.15 7.05m6.3 0c-2.1-1.45-3.15-3.8-3.15-7.05" /></svg>;
    case "monitor":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5A1.5 1.5 0 0 1 21.75 6.75v9a1.5 1.5 0 0 1-1.5 1.5H3.75a1.5 1.5 0 0 1-1.5-1.5v-9a1.5 1.5 0 0 1 1.5-1.5ZM9 20.25h6m-3-3v3" /></svg>;
    case "smartphone":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 2.75h7.5A1.75 1.75 0 0 1 17.5 4.5v15a1.75 1.75 0 0 1-1.75 1.75h-7.5A1.75 1.75 0 0 1 6.5 19.5v-15a1.75 1.75 0 0 1 1.75-1.75ZM11 18.25h2" /></svg>;
    case "edit":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="m16.86 4.49 2.65 2.65m-1.32-3.98a1.87 1.87 0 0 1 2.65 2.65L8.25 18.4 3.75 20.25l1.85-4.5L18.19 3.16Z" /></svg>;
    case "eye":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12s3.75-6.75 9.75-6.75S21.75 12 21.75 12 18 18.75 12 18.75 2.25 12 2.25 12Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 14.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z" /></svg>;
    case "chevron":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" /></svg>;
    case "help":
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M9.88 9a3 3 0 1 1 4.24 2.72c-.72.42-1.12.98-1.12 1.78v.25M12 17.25h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>;
    default:
      return <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M3 12h18" /></svg>;
  }
}

function Pill({ tone, children }: { tone: "green" | "gray" | "blue"; children: ReactNode }) {
  const cls = tone === "green" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : tone === "blue" ? "bg-blue-50 text-blue-700 ring-blue-200" : "bg-slate-100 text-slate-600 ring-slate-200";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${cls}`}>{children}</span>;
}

function RoleChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100/90 px-3 py-1.5 text-sm font-bold capitalize text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.78),0_8px_22px_-18px_rgba(15,23,42,0.85)]">
      <Icon name="crown" className="h-3.5 w-3.5 text-slate-600" />
      {children}
    </span>
  );
}

function StatusChip({ strong }: { strong: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-extrabold ring-1 ${strong ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-700 ring-slate-200"}`}>
      {strong ? <Icon name="check" className="h-4 w-4" /> : null}
      {strong ? "Strong" : "Standard"}
    </span>
  );
}

function Card({ icon, title, action, children, className = "" }: { icon?: string; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_14px_40px_-32px_rgba(15,23,42,0.75)] ${className}`}>
      <header className="flex items-center justify-between gap-4 px-6 py-5">
        <div className="flex items-center gap-3">
          {icon ? <span className="text-slate-500"><Icon name={icon} className="h-5 w-5" /></span> : null}
          <h2 className="text-base font-extrabold tracking-tight text-slate-950">{title}</h2>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function iconTileClass(tone: "blue" | "green" | "violet" | "amber"): string {
  if (tone === "green") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (tone === "violet") return "border-violet-100 bg-violet-50 text-violet-700";
  if (tone === "amber") return "border-amber-100 bg-amber-50 text-amber-700";
  return "border-blue-100 bg-blue-50 text-blue-700";
}

const CARD_ACCENT: Record<"blue" | "green" | "violet" | "amber", string> = {
  blue: "border-t-blue-500",
  green: "border-t-emerald-500",
  violet: "border-t-violet-500",
  amber: "border-t-amber-500",
};

const CARD_ACCENT_VARS: Record<"blue" | "green" | "violet" | "amber", { accent: string; soft: string }> = {
  blue: { accent: "#2563eb", soft: "#eff6ff" },
  green: { accent: "#16a34a", soft: "#ecfdf5" },
  violet: { accent: "#7c3aed", soft: "#f5f3ff" },
  amber: { accent: "#b45309", soft: "#fffbeb" },
};

function SecurityModule({ icon, tone, title, description, badge, children }: { icon: string; tone: "blue" | "green" | "violet" | "amber"; title: string; description: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section
      className={`account-module flex min-h-[264px] flex-col overflow-hidden rounded-2xl border border-t-[3px] border-slate-200 ${CARD_ACCENT[tone]} bg-white shadow-[0_14px_40px_-32px_rgba(15,23,42,0.75)]`}
      style={{ ["--card-accent" as string]: CARD_ACCENT_VARS[tone].accent, ["--card-accent-soft" as string]: CARD_ACCENT_VARS[tone].soft } as React.CSSProperties}
    >
      <header className="flex items-start justify-between gap-5 px-6 py-3">
        <div className="flex min-w-0 gap-5">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${iconTileClass(tone)}`}>
            <Icon name={icon} className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold tracking-tight text-slate-950">{title}</h2>
            <p className="mt-2 max-w-[28rem] text-sm leading-6 text-slate-500">{description}</p>
          </div>
        </div>
        {badge}
      </header>
      <div className="flex flex-1 flex-col px-6 pb-3">{children}</div>
    </section>
  );
}

function ModuleRow({ label, value, muted = false }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-slate-100 py-1.5 first:border-t-0">
      <span className="text-[13px] font-semibold text-slate-500">{label}</span>
      <span className={`text-[13px] font-semibold ${muted ? "text-slate-400" : "text-slate-700"}`}>{value}</span>
    </div>
  );
}

function TextInput({ value, onChange, placeholder, invalid }: { value: string; onChange: (value: string) => void; placeholder: string; invalid?: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`h-11 w-full rounded-lg border bg-white px-4 pr-11 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-2 ${invalid ? "border-red-300 focus:ring-red-100" : "border-slate-200 focus:border-blue-500 focus:ring-blue-100"}`}
      />
      <button
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-50 hover:text-slate-700"
      >
        <Icon name="eye" className="h-4 w-4" />
      </button>
    </div>
  );
}

function SummaryItem({ icon, label, value, tone }: { icon: string; label: string; value: string; tone?: "green" | "amber" | "slate" }) {
  const iconClass = tone === "green" ? "text-emerald-600" : tone === "amber" ? "text-amber-500" : "text-slate-400";
  const valueClass = tone === "green" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-slate-800";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-4 border-r border-slate-200 px-8 py-4 last:border-r-0">
      <span className={iconClass}>
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <div className="min-w-0 leading-tight">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className={`mt-1 truncate text-sm font-extrabold ${valueClass}`}>{value}</p>
      </div>
    </div>
  );
}

function WorkspaceSummaryItem({ value }: { value: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-4 border-r border-slate-200 px-8 py-4 last:border-r-0">
      <span className="text-slate-500">
        <Icon name="building" className="h-6 w-6" />
      </span>
      <div className="min-w-0 leading-tight">
        <p className="text-sm font-medium text-slate-500">Workspace</p>
        <p className="mt-1 truncate text-sm font-extrabold text-slate-800">{value}</p>
        <a href="/workspace" className="mt-2 inline-flex text-sm font-bold text-blue-700 hover:text-blue-900">Manage workspace</a>
      </div>
    </div>
  );
}

export default function Account() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [nextError, setNextError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [mfaSetup, setMfaSetup] = useState<MfaSetup | null>(null);
  const [mfaEnableCode, setMfaEnableCode] = useState("");
  const [mfaMsg, setMfaMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryDialog, setRecoveryDialog] = useState<{ type: "email" | "phone"; value: string } | null>(null);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [postureOpen, setPostureOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpCopied, setHelpCopied] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const SUPPORT_EMAIL = "elazar.chodjayev@cloud-castles.com";

  const { data: me } = useQuery<Me>({ queryKey: ["me"], queryFn: () => api("/v1/auth/me", { schema: meSchema }) });
  const { data: workspaces = [] } = useQuery<WorkspaceEntry[]>({ queryKey: ["workspaces"], queryFn: () => api("/v1/auth/workspaces", { schema: workspaceListSchema }), enabled: !!me });

  const switchWorkspace = useMutation({
    mutationFn: (orgId: string) => api<{ access_token: string }>("/v1/auth/workspaces/switch", { method: "POST", body: JSON.stringify({ org_id: orgId }) }),
    onSuccess: (data) => {
      storeTokens(data.access_token);
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
      window.location.reload();
    },
  });

  const forgotPassword = useMutation({
    mutationFn: () => api("/v1/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email: me?.email }) }),
    onSuccess: () => setPwMsg({ ok: true, text: "Reset link sent. Check your email." }),
    onError: (e: Error) => setPwMsg({ ok: false, text: formatApiError(e) }),
  });

  const changePw = useMutation({
    mutationFn: () => api("/v1/auth/me/password", { method: "PUT", body: JSON.stringify(me?.has_password ? { current_password: current, new_password: next } : { new_password: next }) }),
    onSuccess: () => {
      setPwMsg({ ok: true, text: me?.has_password ? "Password updated." : "Password set." });
      qc.invalidateQueries({ queryKey: ["me"] });
      setCurrent("");
      setNext("");
      setConfirm("");
      setPasswordDialogOpen(false);
    },
    onError: (e: Error) => setPwMsg({ ok: false, text: formatApiError(e) }),
  });

  const startMfaSetup = useMutation({
    mutationFn: () => api<MfaSetup>("/v1/auth/me/mfa/setup", { method: "POST" }),
    onSuccess: (data) => {
      setMfaSetup(data);
      setMfaEnableCode("");
      setMfaMsg(null);
    },
    onError: (e: Error) => setMfaMsg({ ok: false, text: formatApiError(e) }),
  });

  const enableMfa = useMutation({
    mutationFn: () => api("/v1/auth/me/mfa/enable", { method: "POST", body: JSON.stringify({ code: mfaEnableCode }) }),
    onSuccess: () => {
      setMfaMsg({ ok: true, text: "Two-factor authentication enabled." });
      setMfaSetup(null);
      setMfaEnableCode("");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: Error) => setMfaMsg({ ok: false, text: formatApiError(e) }),
  });

  const generateCodes = useMutation({
    mutationFn: () => api<{ codes: string[] }>("/v1/auth/me/mfa/backup-codes", { method: "POST" }),
    onSuccess: (data) => {
      setRecoveryCodes(data.codes);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  useEffect(() => {
    const err = params.get("error");
    if (!err) return;
    setToast({ kind: "error", text: "Could not update account. Try again." });
    const cleaned = new URLSearchParams(params);
    cleaned.delete("error");
    setParams(cleaned, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    setNextError(null);
    setConfirmError(null);
    if (me?.has_password && !current.trim()) return setPwMsg({ ok: false, text: "Enter your current password." });
    if (!next) return setNextError("Enter a password.");
    if (next.length < 12) return setNextError("Password must be at least 12 characters.");
    if (getPasswordStrength(next).score < 3) return setNextError("Use a stronger password with more variety.");
    if (!confirm) return setConfirmError("Confirm your password.");
    if (next !== confirm) return setConfirmError("Passwords do not match.");
    changePw.mutate();
  }

  function downloadRecoveryCodes(codes: string[]) {
    const blob = new Blob([`Vigil recovery codes\n\n${codes.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vigil-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const email = me?.email ?? "";
  const initials = email ? initialsFromEmail(email) : "?";
  const name = email ? displayNameFromEmail(email) : "Loading";
  const mfaOn = !!me?.totp_enabled;
  const hasPw = !!me?.has_password;
  const healthStrong = hasPw && mfaOn;
  const passwordStrength = getPasswordStrength(next);

  return (
    <div className="flex w-full max-w-none flex-col pb-0" style={{ minHeight: "calc(100vh - 2rem)" }}>
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold leading-[1.15] tracking-[-0.025em] text-slate-950">Account</h1>
          <p className="mt-1.5 text-sm leading-[1.45] text-slate-500">Manage your sign-in and personal security settings.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setHelpCopied(false);
            setHelpOpen(true);
          }}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-semibold tracking-tight text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
        >
          <svg className="h-[18px] w-[18px] text-slate-400" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
          </svg>
          Get help
        </button>
      </header>

      <section className="mb-5 grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_-42px_rgba(15,23,42,0.75)] lg:grid-cols-[1.28fr_1.05fr_0.85fr_1fr]">
        <div className="flex items-center gap-7 border-b border-slate-200/90 px-8 py-3 lg:border-b-0 lg:border-r">
          <span className="relative flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#eef0ff_0%,#dfe3ff_54%,#f6f7ff_100%)] text-[30px] font-black text-indigo-700 shadow-[0_22px_48px_-26px_rgba(79,70,229,0.85),inset_0_1px_0_rgba(255,255,255,0.85)] ring-1 ring-indigo-100/90">
            <span className="drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]">{initials}</span>
            <span className="absolute bottom-2 right-1.5 h-4 w-4 rounded-full border-[3px] border-white bg-emerald-500 shadow-[0_4px_12px_rgba(16,185,129,0.45)]" />
          </span>
          <div className="min-w-0">
              <h2 className="truncate text-[24px] font-black leading-tight tracking-tight text-slate-950">{name}</h2>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <RoleChip>{me?.role || "owner"}</RoleChip>
              </div>
          </div>
        </div>
        <div className="flex items-center gap-5 border-b border-slate-200/90 px-8 py-3 lg:border-b-0 lg:border-r">
          <span className="text-slate-500"><Icon name="mail" className="h-6 w-6" /></span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-slate-900">{email || "-"}</p>
            <p className="mt-2 text-sm font-extrabold text-emerald-700">Verified</p>
          </div>
        </div>
        <div className="flex items-center gap-5 border-b border-slate-200/90 px-8 py-3 lg:border-b-0 lg:border-r">
          <span className="text-slate-500"><Icon name="building" className="h-6 w-6" /></span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-500">Workspace</p>
            <p className="mt-1.5 truncate text-[15px] font-black text-slate-900">{me?.org_name ?? "-"}</p>
            <a href="/workspace" className="mt-2 inline-flex text-sm font-bold text-blue-700 hover:text-blue-900">Manage workspace</a>
          </div>
        </div>
        <button type="button" onClick={() => setPostureOpen(true)} className="flex items-center justify-between gap-4 px-8 py-3 text-left transition hover:bg-slate-50/70">
          <div className="min-w-0">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="text-slate-500"><Icon name="shield" className="h-5 w-5" /></span>
              <p className="text-sm font-bold text-slate-500">Security posture</p>
            </div>
            <StatusChip strong={healthStrong} />
            <p className="mt-3 text-sm leading-5 text-slate-500">{healthStrong ? "All key security settings look good." : "Core account settings are available."}</p>
          </div>
          <Icon name="chevron" className="h-5 w-5 shrink-0 text-slate-500" />
        </button>
      </section>

      <div className="grid auto-rows-fr items-stretch gap-4 xl:grid-cols-3">
        <SecurityModule icon="lock" tone="blue" title="Password" description="Keep your password strong and update it regularly.">
          <div className="mt-1">
            <ModuleRow label="Last updated" value={hasPw ? "Recently" : "Not set"} />
            <ModuleRow
              label="Password strength"
              value={
                <span className="flex items-center gap-3">
                  <span className="text-emerald-700">{hasPw ? "Strong" : "Waiting"}</span>
                  <span className="flex w-28 gap-1">
                    {[0, 1, 2, 3].map((n) => <span key={n} className={`h-1 flex-1 rounded-full ${hasPw ? "bg-emerald-500" : "bg-slate-200"}`} />)}
                  </span>
                </span>
              }
            />
          </div>
          <button type="button" onClick={() => { setPwMsg(null); setPasswordDialogOpen(true); }} className="vigil-toolbar-btn vigil-toolbar-btn--primary-solid mt-auto w-full">
            Change password
            <Icon name="chevron" />
          </button>
        </SecurityModule>

        <SecurityModule icon="shield" tone="green" title="Two-factor authentication" description="Control whether sign-in requires an authenticator code." badge={<Pill tone="gray">{mfaOn ? "Enabled" : "Disabled"}</Pill>}>
          <div className="mt-1">
            <ModuleRow label="Primary method" value={mfaOn ? "Authenticator app" : "None"} />
            <ModuleRow label="Backup method" value="Recovery codes" />
          </div>
          <button type="button" onClick={() => startMfaSetup.mutate()} disabled={startMfaSetup.isPending || mfaOn} className="vigil-toolbar-btn vigil-toolbar-btn--primary-solid mt-auto w-full">
            {mfaOn ? "Manage 2FA" : startMfaSetup.isPending ? "Preparing..." : "Set up 2FA"}
            <Icon name="chevron" />
          </button>
          {mfaMsg ? <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${mfaMsg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>{mfaMsg.text}</p> : null}
        </SecurityModule>

        <SecurityModule icon="key" tone="violet" title="Recovery codes" description="Use recovery codes to sign in if you lose access to your device.">
          <div className="mt-1 rounded-xl border border-violet-100 bg-violet-50/60 px-5 py-4">
            <p className="text-lg font-extrabold text-violet-700">{me?.mfa_backup_codes_remaining ?? 0} unused codes</p>
            <p className="mt-2 text-sm text-slate-500">{mfaOn ? "Generated from this workspace." : "Available after two-factor authentication is enabled."}</p>
          </div>
          <button type="button" onClick={() => generateCodes.mutate()} disabled={!mfaOn || generateCodes.isPending} className="vigil-toolbar-btn vigil-toolbar-btn--primary-solid mt-auto w-full">
            {generateCodes.isPending ? "Loading..." : recoveryCodes ? "Refresh codes" : "View recovery codes"}
            <Icon name="chevron" />
          </button>
          {recoveryCodes ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-bold text-amber-900">Save these now. They will not be shown again.</p>
              <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-white p-3">
                {recoveryCodes.map((code) => <code key={code} className="font-mono text-sm text-slate-800">{code}</code>)}
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => navigator.clipboard.writeText(recoveryCodes.join("\n")).catch(() => {})} className="vigil-toolbar-btn vigil-toolbar-btn--neutral">Copy all</button>
                <button type="button" onClick={() => downloadRecoveryCodes(recoveryCodes)} className="vigil-toolbar-btn vigil-toolbar-btn--neutral">Download .txt</button>
              </div>
            </div>
          ) : null}
        </SecurityModule>

        <SecurityModule icon="fingerprint" tone="blue" title="Sign-in methods" description="Manage the ways you can sign in to your account.">
          <div className="mt-1">
            <ModuleRow label="Password" value={hasPw ? "Enabled" : "Not set"} muted={!hasPw} />
            <ModuleRow label="Authenticator app" value={mfaOn ? "Enabled" : "Disabled"} muted={!mfaOn} />
            <ModuleRow label="GitHub" value={me?.github_id ? "Connected" : "Not connected"} muted={!me?.github_id} />
            <ModuleRow label="Google" value={me?.google_id ? "Connected" : "Not connected"} muted={!me?.google_id} />
          </div>
          <button type="button" onClick={() => setRecoveryDialog({ type: "email", value: email })} className="vigil-toolbar-btn vigil-toolbar-btn--primary-solid mt-auto w-full">
            Manage methods
            <Icon name="chevron" />
          </button>
        </SecurityModule>

        <SecurityModule icon="user" tone="blue" title="Account status" description="Overview of your account security and verification.">
          <div className="mt-1">
            <ModuleRow label="Email" value="Verified" />
            <ModuleRow label="Password" value={hasPw ? "Set" : "Not set"} muted={!hasPw} />
            <ModuleRow label="Two-factor authentication" value={mfaOn ? "Enabled" : "Disabled"} muted={!mfaOn} />
            <ModuleRow label="Account activity" value={<button type="button" className="font-bold text-blue-700">View history</button>} />
          </div>
          <button type="button" className="vigil-toolbar-btn vigil-toolbar-btn--primary-solid mt-auto w-full">
            Review account status
            <Icon name="chevron" />
          </button>
        </SecurityModule>

        <SecurityModule icon="refresh" tone="amber" title="Recovery methods" description="Keep these up to date so you can always get back in.">
          <div className="mt-1">
            <button type="button" onClick={() => setRecoveryDialog({ type: "email", value: email })} className="flex w-full items-center justify-between gap-4 border-t border-slate-100 py-4 text-left first:border-t-0">
              <div className="flex min-w-0 items-center gap-4">
                <span className="text-slate-500"><Icon name="mail" className="h-6 w-6" /></span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">Recovery email</p>
                  <p className="mt-0.5 truncate text-sm text-slate-500">{email || "-"}</p>
                </div>
              </div>
              <span className="flex items-center gap-3"><Pill tone="green">Verified</Pill><Icon name="chevron" className="h-4 w-4 text-slate-500" /></span>
            </button>
            <button type="button" onClick={() => setRecoveryDialog({ type: "phone", value: "" })} className="flex w-full items-center justify-between gap-4 border-t border-slate-100 py-4 text-left">
              <div className="flex min-w-0 items-center gap-4">
                <span className="text-slate-500"><Icon name="phone" className="h-6 w-6" /></span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">Recovery phone</p>
                  <p className="mt-0.5 text-sm text-slate-500">Not set</p>
                </div>
              </div>
              <span className="flex items-center gap-3"><Pill tone="gray">Not set</Pill><Icon name="chevron" className="h-4 w-4 text-slate-500" /></span>
            </button>
          </div>
          <button type="button" onClick={() => setRecoveryDialog({ type: "email", value: email })} className="vigil-toolbar-btn vigil-toolbar-btn--primary-solid mt-auto w-full">
            Manage recovery methods
            <Icon name="chevron" />
          </button>
        </SecurityModule>
      </div>

      {postureOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          onClick={() => setPostureOpen(false)}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-extrabold tracking-tight text-slate-950">Security posture</h3>
                <p className="mt-1 text-sm leading-snug text-slate-500">
                  {healthStrong
                    ? "Your account security is strong — every check is complete."
                    : "Complete these to strengthen your account."}
                </p>
              </div>
              <StatusChip strong={healthStrong} />
            </div>
            <ul className="mt-5 space-y-2.5">
              {[
                { label: "Set a password", done: hasPw, hint: "Lets you sign in without a provider." },
                { label: "Enable two-factor authentication", done: mfaOn, hint: "Require an authenticator code at sign-in." },
                {
                  label: "Generate recovery codes",
                  done: (me?.mfa_backup_codes_remaining ?? 0) > 0,
                  hint: "Back-up codes for if you lose your device (after 2FA).",
                },
              ].map((item) => (
                <li key={item.label} className="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3">
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                      item.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {item.done ? <Icon name="check" className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-sm font-bold ${item.done ? "text-slate-400 line-through" : "text-slate-800"}`}>{item.label}</p>
                    {!item.done ? <p className="mt-0.5 text-xs text-slate-500">{item.hint}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex justify-end gap-2">
              {!hasPw ? (
                <button
                  type="button"
                  onClick={() => {
                    setPostureOpen(false);
                    setPasswordDialogOpen(true);
                  }}
                  className="vigil-toolbar-btn vigil-toolbar-btn--primary-solid"
                >
                  Set password
                </button>
              ) : null}
              <button type="button" onClick={() => setPostureOpen(false)} className="vigil-toolbar-btn vigil-toolbar-btn--neutral">
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {helpOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          onClick={() => setHelpOpen(false)}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold tracking-tight text-slate-950">Get help</h3>
            <p className="mt-1 text-sm leading-snug text-slate-500">Email our team and we&apos;ll get back to you.</p>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <span className="truncate font-mono text-sm text-slate-800">{SUPPORT_EMAIL}</span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(SUPPORT_EMAIL);
                  setHelpCopied(true);
                }}
                className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
              >
                {helpCopied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=Vigil%20support%20request`}
                onClick={() => setHelpOpen(false)}
                className="vigil-toolbar-btn vigil-toolbar-btn--primary-solid no-underline"
              >
                Open email app
              </a>
              <button type="button" onClick={() => setHelpOpen(false)} className="vigil-toolbar-btn vigil-toolbar-btn--neutral">
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {passwordDialogOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl rounded-2xl border border-white/70 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"><Icon name="lock" /></p>
                <h2 className="text-xl font-extrabold tracking-tight text-slate-950">Change password</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">Use a strong password that you do not use elsewhere.</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setPasswordDialogOpen(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-xl leading-none text-slate-500 hover:bg-zinc-50">&times;</button>
            </div>
            <form noValidate onSubmit={submitPassword} className="space-y-4">
              {hasPw ? (
                <div className="grid gap-3 md:grid-cols-[170px_1fr] md:items-center">
                  <label className="text-sm font-bold text-slate-700">Current password</label>
                  <TextInput value={current} onChange={setCurrent} placeholder="Enter current password" />
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-[170px_1fr] md:items-center">
                <label className="text-sm font-bold text-slate-700">New password</label>
                <div>
                  <TextInput value={next} onChange={(v) => { setNext(v); setNextError(null); }} placeholder="Enter new password" invalid={!!nextError} />
                  <div className="mt-2 flex items-center gap-3 text-xs font-semibold">
                    <span className={strengthTextClass(passwordStrength.tone)}>Password strength: {passwordStrength.label}</span>
                    <span className="h-1 flex-1 rounded-full bg-slate-100"><span className={`block h-full rounded-full ${passwordStrength.width} ${strengthBarClass(passwordStrength.tone)}`} /></span>
                  </div>
                  {next ? <p className={`mt-1 text-xs ${strengthTextClass(passwordStrength.tone)}`}>{passwordStrength.message}</p> : null}
                  {nextError ? <p className="mt-1 text-xs text-red-600">{nextError}</p> : null}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-[170px_1fr] md:items-center">
                <label className="text-sm font-bold text-slate-700">Confirm new password</label>
                <div>
                  <TextInput value={confirm} onChange={(v) => { setConfirm(v); setConfirmError(null); }} placeholder="Confirm new password" invalid={!!confirmError} />
                  {confirmError ? <p className="mt-1 text-xs text-red-600">{confirmError}</p> : null}
                </div>
              </div>
              {pwMsg ? <div className={`rounded-lg px-3 py-2.5 text-sm ${pwMsg.ok ? "border border-green-200 bg-green-50 text-green-700" : "border border-red-200 bg-red-50 text-red-600"}`}>{pwMsg.text}</div> : null}
              <div className="flex justify-between gap-3 pt-1">
                {hasPw ? <button type="button" onClick={() => forgotPassword.mutate()} className="text-sm font-bold text-blue-700 hover:text-blue-900">Forgot current password?</button> : <span />}
                <div className="flex gap-3">
                  <button type="button" onClick={() => setPasswordDialogOpen(false)} className="vigil-toolbar-btn vigil-toolbar-btn--neutral vigil-toolbar-btn--lg">Cancel</button>
                  <button type="submit" disabled={changePw.isPending} className="vigil-toolbar-btn vigil-toolbar-btn--primary-solid vigil-toolbar-btn--lg">
                    {changePw.isPending ? "Saving..." : hasPw ? "Update password" : "Set password"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {mfaSetup && !mfaOn ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-white/70 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600"><Icon name="shield" /></p>
                <h2 className="text-xl font-extrabold tracking-tight text-slate-950">Set up two-factor authentication</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">Scan the QR code, then enter the 6-digit code from your authenticator app.</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => { setMfaSetup(null); setMfaEnableCode(""); setMfaMsg(null); }} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-xl leading-none text-slate-500 hover:bg-zinc-50">&times;</button>
            </div>
            {mfaSetup.qr_data_url ? <img src={mfaSetup.qr_data_url} alt="Authenticator QR code" className="mx-auto h-56 w-56 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm" /> : null}
            <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Manual entry key</p>
              <code className="break-all text-xs text-zinc-800">{mfaSetup.secret}</code>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); setMfaMsg(null); enableMfa.mutate(); }} className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Verification code</label>
                <input type="tel" inputMode="numeric" autoComplete="one-time-code" value={mfaEnableCode} onChange={(e) => setMfaEnableCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className="h-12 w-full rounded-lg border border-zinc-200 px-3 text-center font-mono text-lg tracking-[0.35em] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
              </div>
              <button type="submit" disabled={enableMfa.isPending || mfaEnableCode.length !== 6} className="vigil-toolbar-btn vigil-toolbar-btn--primary-solid vigil-toolbar-btn--lg w-full">{enableMfa.isPending ? "Enabling..." : "Enable 2FA"}</button>
            </form>
          </div>
        </div>
      ) : null}

      {recoveryDialog ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-white/70 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500">
                  <Icon name={recoveryDialog.type === "email" ? "mail" : "phone"} />
                </p>
                <h2 className="text-xl font-extrabold tracking-tight text-slate-950">
                  {recoveryDialog.type === "email" ? "Recovery email" : "Recovery phone"}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">Update the recovery method used to regain account access.</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setRecoveryDialog(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-xl leading-none text-slate-500 hover:bg-zinc-50">&times;</button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); setRecoveryDialog(null); setToast({ kind: "success", text: "Recovery method updated." }); }} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">{recoveryDialog.type === "email" ? "Email address" : "Phone number"}</label>
                <input
                  type={recoveryDialog.type === "email" ? "email" : "tel"}
                  defaultValue={recoveryDialog.value}
                  className="h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setRecoveryDialog(null)} className="vigil-toolbar-btn vigil-toolbar-btn--neutral vigil-toolbar-btn--lg">Cancel</button>
                <button type="submit" className="vigil-toolbar-btn vigil-toolbar-btn--primary-solid vigil-toolbar-btn--lg">Save changes</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {toast ? <div className={`fixed bottom-5 right-5 z-[70] rounded-lg px-4 py-3 text-sm font-semibold shadow-lg ${toast.kind === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>{toast.text}</div> : null}
    </div>
  );
}
