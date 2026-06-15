import { useState, useEffect, useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, BASE, formatApiError, logout, token } from "../api";
import { BrowserIcon } from "../components/BrowserIcon";
import { deviceLabel, detectBrowser } from "../lib/browserDetect";

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

function currentDevice(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return deviceLabel(ua);
}

interface Me {
  id: string;
  email: string;
  role: string;
  org_id: string;
  github_id: string | null;
  gitlab_id: string | null;
  google_id: string | null;
  totp_enabled: boolean;
  has_password: boolean;
  mfa_backup_codes_remaining: number;
}

interface SessionInfo {
  location: string | null;
  signed_in_at: string | null;
}

interface MfaSetup {
  secret: string;
  provisioning_uri: string;
  qr_data_url: string | null;
}

function ShieldIcon() {
  return (
    <svg className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.96 11.96 0 0 1 3.6 6 12 12 0 0 0 3 9.75c0 5.59 3.82 10.29 9 11.62 5.18-1.33 9-6.03 9-11.62 0-1.31-.21-2.57-.6-3.75h-.15a11.96 11.96 0 0 1-8.25-3.29Z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.03 5.91c-.56-.1-1.16.03-1.56.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.82c0-.6.24-1.17.66-1.59l6.5-6.5c.4-.4.52-1 .43-1.56A6 6 0 1 1 21.75 8.25Z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.69a4.5 4.5 0 0 1 1.24 7.24l-4.5 4.5a4.5 4.5 0 0 1-6.36-6.36l1.76-1.76m13.35-.62 1.76-1.76a4.5 4.5 0 0 0-6.36-6.36l-4.5 4.5a4.5 4.5 0 0 0 1.24 7.24" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 7.5v9a2.25 2.25 0 0 1-2.25 2.25h-15A2.25 2.25 0 0 1 2.25 16.5v-9m19.5 0A2.25 2.25 0 0 0 19.5 5.25h-15A2.25 2.25 0 0 0 2.25 7.5m19.5 0-8.7 5.8a2.25 2.25 0 0 1-2.5 0L2.25 7.5" />
    </svg>
  );
}

function BulbIcon() {
  return (
    <svg className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-1.5m0-12a6 6 0 0 0-3.5 10.87c.64.46 1 1.2 1 1.99V18h5v-.64c0-.79.36-1.53 1-1.99A6 6 0 0 0 12 4.5ZM9.75 21h4.5" />
    </svg>
  );
}

function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4.2 4.2L19 7" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12s3.75-6.75 9.75-6.75S21.75 12 21.75 12 18 18.75 12 18.75 2.25 12 2.25 12Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 14.75a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5Z" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
    </svg>
  );
}

function StatusChip({ tone, children }: { tone: "on" | "off" | "warn"; children: ReactNode }) {
  const cls =
    tone === "on"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200/60"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700 ring-amber-200/70"
        : "bg-zinc-100 text-zinc-500 ring-zinc-200";
  const dot = tone === "on" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : "bg-zinc-300";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {children}
    </span>
  );
}

function SoftIcon({ icon, tint }: { icon: ReactNode; tint: string }) {
  return <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full ${tint}`}>{icon}</span>;
}

function SimpleCard({ icon, title, children, className = "" }: { icon?: ReactNode; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-zinc-200 bg-white p-6 shadow-sm ${className}`}>
      <div className="mb-5 flex items-center gap-2.5">
        {icon && <span className="text-slate-500 [&_svg]:h-5 [&_svg]:w-5">{icon}</span>}
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function IdentityStat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: "ok" | "muted" }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`[&_svg]:h-[18px] [&_svg]:w-[18px] ${tone === "ok" ? "text-emerald-500" : "text-zinc-400"}`}>{icon}</span>
      <div className="leading-tight">
        <p className="text-[11px] font-medium text-zinc-400">{label}</p>
        <p className={`text-sm font-semibold ${tone === "ok" ? "text-emerald-700" : "text-slate-700"}`}>{value}</p>
      </div>
    </div>
  );
}

function StatusRow({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: "ok" | "good" | "muted" | "warn" }) {
  const valueClass = tone === "ok" || tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-slate-500";
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex items-center gap-2.5 text-sm text-slate-600">
        <span className="text-zinc-400 [&_svg]:h-[18px] [&_svg]:w-[18px]">{icon}</span>
        {label}
      </div>
      <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${valueClass}`}>
        {value}
        {tone === "ok" ? (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
        ) : tone === "good" ? null : (
          <span className={`h-1.5 w-1.5 rounded-full ${tone === "warn" ? "bg-amber-400" : "bg-slate-300"}`} aria-hidden />
        )}
      </span>
    </div>
  );
}

function PostureCard({
  icon,
  tint,
  label,
  value,
  sub,
  valueClass,
}: {
  icon: ReactNode;
  tint: string;
  label: string;
  value: ReactNode;
  sub: string;
  valueClass?: string;
}) {
  return (
    <div className="flex min-h-[118px] items-center gap-5 rounded-lg border border-zinc-200 bg-white px-6 py-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
      <SoftIcon icon={icon} tint={tint} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-600">{label}</p>
        <p className={`mt-1 text-2xl font-extrabold leading-none tracking-tight ${valueClass ?? "text-slate-950"}`}>{value}</p>
        <p className="mt-1.5 truncate text-sm text-slate-500">{sub}</p>
      </div>
    </div>
  );
}

function Panel({
  icon,
  tint,
  title,
  description,
  status,
  children,
  flush,
  className = "",
}: {
  icon: ReactNode;
  tint: string;
  title: string;
  description: string;
  status?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.04)] ${className}`}>
      <div className="flex items-start gap-5 px-6 py-6">
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${tint}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-extrabold text-slate-950">{title}</h2>
            {status}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">{description}</p>
        </div>
      </div>
      <div className={flush ? "border-t border-zinc-200" : "border-t border-zinc-200 px-6 py-5"}>{children}</div>
    </section>
  );
}

function ProviderRow({
  name,
  icon,
  connected,
  connectUrl,
  onDisconnect,
  disconnecting,
  lastMethod,
}: {
  name: string;
  icon: ReactNode;
  connected: boolean;
  connectUrl: string | null;
  onDisconnect: () => void;
  disconnecting: boolean;
  lastMethod: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white">{icon}</span>
        <div className="flex min-w-0 items-center gap-4">
          <p className="text-sm font-semibold text-zinc-900">{name}</p>
          {connected ? <StatusChip tone="on">Connected</StatusChip> : <StatusChip tone="off">Not connected</StatusChip>}
        </div>
      </div>
      {connected ? (
        <button
          type="button"
          onClick={onDisconnect}
          disabled={disconnecting || lastMethod}
          title={lastMethod ? "Set a password or connect another sign-in method before disconnecting your last one." : undefined}
          className="inline-flex shrink-0 items-center rounded-lg border border-zinc-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60"
        >
          {disconnecting ? "Saving…" : "Manage"}
        </button>
      ) : connectUrl ? (
        <a
          href={connectUrl}
          className="inline-flex shrink-0 items-center rounded-lg border border-zinc-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
        >
          Connect
        </a>
      ) : (
        <span className="shrink-0 text-xs text-zinc-400">Sign in again to connect</span>
      )}
    </div>
  );
}

function FieldShell({ children }: { children: ReactNode }) {
  return <div className="relative flex-1">{children}</div>;
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  invalid?: boolean;
}) {
  return (
    <FieldShell>
      <input
        type="password"
        placeholder={placeholder}
        className={`w-full rounded-lg border bg-white px-4 py-2.5 pr-11 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-2 ${
          invalid ? "border-red-300 focus:ring-red-100" : "border-zinc-200 focus:border-blue-500 focus:ring-blue-100"
        }`}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-500">
        <EyeIcon />
      </span>
    </FieldShell>
  );
}

function ProviderLogo({ provider }: { provider: "github" | "gitlab" | "google" }) {
  if (provider === "github") {
    return (
      <svg className="h-5 w-5 text-zinc-900" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
      </svg>
    );
  }
  if (provider === "gitlab") {
    return (
      <svg className="h-5 w-5 text-[#e24329]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51a.42.42 0 0 1 .11-.18.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
      </svg>
    );
  }
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export default function Account() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const currentBrowser = useMemo(
    () => detectBrowser(typeof navigator !== "undefined" ? navigator.userAgent : ""),
    [],
  );

  const { data: me } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api("/v1/auth/me"),
  });

  const { data: session } = useQuery<SessionInfo>({
    queryKey: ["me-session"],
    queryFn: () => api("/v1/auth/me/session"),
    enabled: !!me,
  });

  // change password
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [nextError, setNextError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const generateCodes = useMutation({
    mutationFn: () => api<{ codes: string[] }>("/v1/auth/me/mfa/backup-codes", { method: "POST" }),
    onSuccess: (data) => {
      setRecoveryCodes(data.codes);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const downloadRecoveryCodes = (codes: string[]) => {
    const blob = new Blob([`Vigil recovery codes\n\n${codes.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vigil-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const forgotPassword = useMutation({
    mutationFn: () =>
      api("/v1/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email: me?.email }) }),
    onSuccess: () =>
      setPwMsg({ ok: true, text: "Reset link sent — check your email. The link expires in 30 minutes." }),
    onError: (e: Error) => setPwMsg({ ok: false, text: formatApiError(e) }),
  });

  const changePw = useMutation({
    mutationFn: () =>
      api("/v1/auth/me/password", {
        method: "PUT",
        body: JSON.stringify(
          me?.has_password
            ? { current_password: current, new_password: next }
            : { new_password: next }
        ),
      }),
    onSuccess: () => {
      setPwMsg({ ok: true, text: me?.has_password ? "Password updated." : "Password set. You can now sign in with credentials." });
      qc.invalidateQueries({ queryKey: ["me"] });
      setCurrent(""); setNext(""); setConfirm("");
    },
    onError: (e: Error) => setPwMsg({ ok: false, text: formatApiError(e) }),
  });

  function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    setNextError(null);
    setConfirmError(null);
    if (me?.has_password && !current.trim()) {
      setPwMsg({ ok: false, text: "Enter your current password." });
      return;
    }
    if (!next) {
      setNextError("Enter a password.");
      return;
    }
    if (next.length < 12) {
      setNextError("Password must be at least 12 characters.");
      return;
    }
    if (!confirm) {
      setConfirmError("Confirm your password.");
      return;
    }
    if (next !== confirm) {
      setConfirmError("Passwords don't match.");
      return;
    }
    changePw.mutate();
  }

  // GitHub / GitLab / Google connect/disconnect — feedback as a single bottom toast.
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const gh = params.get("github");
    const gl = params.get("gitlab");
    const go = params.get("google");
    const err = params.get("error");
    if (!gh && !gl && !go && !err) return;

    if (gh === "linked") setToast({ kind: "success", text: "GitHub connected" });
    else if (gl === "linked") setToast({ kind: "success", text: "GitLab connected" });
    else if (go === "linked") setToast({ kind: "success", text: "Google connected" });
    else if (err) {
      const friendly =
        err === "github_already_linked" ? "That GitHub account is already linked to another user." :
        err === "gitlab_already_linked" ? "That GitLab account is already linked to another user." :
        err === "google_already_linked" ? "That Google account is already linked to another user." :
        err === "bad_link_token" ? "Session expired. Try again." :
        err === "oauth_denied" ? "Connection cancelled." :
        err === "no_email" ? "Couldn't read your email from the provider." :
        err === "not_found" ? "Account not found. Try again." :
        "Couldn't connect. Try again.";
      setToast({ kind: "error", text: friendly });
    }

    const cleaned = new URLSearchParams(params);
    cleaned.delete("github");
    cleaned.delete("gitlab");
    cleaned.delete("google");
    cleaned.delete("error");
    cleaned.delete("provider");
    setParams(cleaned, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "error" ? 6000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const disconnectGh = useMutation({
    mutationFn: () => api("/v1/auth/me/github", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
    onError: (e: Error) => setToast({ kind: "error", text: formatApiError(e) }),
  });

  const sessionToken = token();
  const ghConnectUrl = sessionToken
    ? `${BASE}/v1/auth/github?link_token=${encodeURIComponent(sessionToken)}`
    : null;

  const disconnectGl = useMutation({
    mutationFn: () => api("/v1/auth/me/gitlab", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
    onError: (e: Error) => setToast({ kind: "error", text: formatApiError(e) }),
  });

  const glConnectUrl = sessionToken
    ? `${BASE}/v1/auth/gitlab?link_token=${encodeURIComponent(sessionToken)}`
    : null;

  const disconnectGoogle = useMutation({
    mutationFn: () => api("/v1/auth/me/google", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
    onError: (e: Error) => setToast({ kind: "error", text: formatApiError(e) }),
  });

  const googleConnectUrl = sessionToken
    ? `${BASE}/v1/auth/google?link_token=${encodeURIComponent(sessionToken)}`
    : null;

  // MFA
  const [mfaSetup, setMfaSetup] = useState<MfaSetup | null>(null);
  const [mfaEnableCode, setMfaEnableCode] = useState("");
  const [mfaDisableCode, setMfaDisableCode] = useState("");
  const [mfaDisablePassword, setMfaDisablePassword] = useState("");
  const [showDisableMfa, setShowDisableMfa] = useState(false);
  const [mfaMsg, setMfaMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
    mutationFn: () =>
      api("/v1/auth/me/mfa/enable", {
        method: "POST",
        body: JSON.stringify({ code: mfaEnableCode }),
      }),
    onSuccess: () => {
      setMfaMsg({ ok: true, text: "Two-factor authentication enabled." });
      setMfaSetup(null);
      setMfaEnableCode("");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: Error) => setMfaMsg({ ok: false, text: formatApiError(e) }),
  });

  const disableMfa = useMutation({
    mutationFn: () =>
      api("/v1/auth/me/mfa/disable", {
        method: "POST",
        body: JSON.stringify({
          code: mfaDisableCode,
          ...(me?.has_password ? { password: mfaDisablePassword } : {}),
        }),
      }),
    onSuccess: () => {
      setMfaMsg({ ok: true, text: "Two-factor authentication disabled." });
      setMfaDisableCode("");
      setMfaDisablePassword("");
      setShowDisableMfa(false);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: Error) => setMfaMsg({ ok: false, text: formatApiError(e) }),
  });

  const providerCount = me ? (me.github_id ? 1 : 0) + (me.gitlab_id ? 1 : 0) + (me.google_id ? 1 : 0) : 0;
  const signinMethodCount = providerCount;
  const onlyOneMethod = me ? signinMethodCount === 1 : false;
  const mfaOn = !!me?.totp_enabled;
  const hasPw = !!me?.has_password;

  const displayEmail = me?.email ?? "";
  const initials = displayEmail ? initialsFromEmail(displayEmail) : "?";

  async function signOut() {
    try {
      await logout();
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <div className="w-full max-w-none space-y-6 pb-10">
      <header>
        <h1 className="text-[32px] font-extrabold leading-tight tracking-tight text-slate-950">Account</h1>
        <p className="mt-1.5 text-sm text-slate-500">Manage your sign-in and personal security settings.</p>
        {me && (
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
            Signed in as <span className="font-semibold text-slate-700">{me.email}</span>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.9} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
              Verified
            </span>
          </p>
        )}
      </header>

      {/* Identity strip */}
      <div className="flex flex-wrap items-stretch divide-x divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-1 items-center gap-3.5 px-6 py-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-base font-bold text-indigo-700">{initials}</span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold leading-tight text-slate-900">{me ? displayNameFromEmail(me.email) : "Loading…"}</p>
            {me && <span className="mt-1.5 inline-flex rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold capitalize text-zinc-600">{me.role}</span>}
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center gap-2.5 px-6 py-5">
          <span className="text-zinc-400 [&_svg]:h-[18px] [&_svg]:w-[18px]">
            <svg fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m-9 9h18" /></svg>
          </span>
          <div className="leading-tight">
            <p className="text-[11px] font-medium text-zinc-400">Workspace</p>
            <p className="text-sm font-semibold text-slate-700">{me ? me.email.split("@")[1] : "—"}</p>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center gap-2.5 px-6 py-5 text-sm">
          <span className="text-zinc-400 [&_svg]:h-[18px] [&_svg]:w-[18px]"><LockIcon /></span>
          <span className="font-medium text-slate-700">{hasPw ? "Password set" : "No password"}</span>
        </div>
        <div className="flex flex-1 items-center justify-center gap-2.5 px-6 py-5 text-sm">
          <span className="text-zinc-400 [&_svg]:h-[18px] [&_svg]:w-[18px]"><ShieldIcon /></span>
          <span className="font-medium text-slate-700">2FA</span>
          <StatusChip tone={mfaOn ? "on" : "off"}>{mfaOn ? "On" : "Off"}</StatusChip>
        </div>
        <div className="flex flex-1 items-center justify-center gap-2.5 px-6 py-5">
          <span className="text-zinc-400 [&_svg]:h-[18px] [&_svg]:w-[18px]"><LinkIcon /></span>
          <div className="leading-tight">
            <p className="text-[11px] font-medium text-zinc-400">Providers</p>
            <p className="text-sm font-semibold text-slate-700">{providerCount} connected</p>
          </div>
        </div>
      </div>

      {me && onlyOneMethod && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.3 3.38c-.87 1.5.2 3.37 1.93 3.37h14.74c1.73 0 2.81-1.87 1.94-3.37L13.95 3.38c-.87-1.5-3.04-1.5-3.9 0L2.7 16.13ZM12 15.75h.01v.01H12v-.01Z" />
          </svg>
          <p>
            <strong className="font-semibold">Only one sign-in method.</strong>{" "}
            Set a password or connect another provider so you don't get locked out if{" "}
            {me.has_password ? "you forget it" : me.github_id ? "GitHub access changes" : me.gitlab_id ? "GitLab access changes" : "Google access changes"}.
          </p>
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[1.7fr_1fr]">
        {/* ── Left column ── */}
        <div className="space-y-5">
          <SimpleCard icon={<ShieldIcon />} title="Security">
            <div className="space-y-7">
              <form noValidate onSubmit={submitPassword} className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-extrabold text-slate-950">Password</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {me?.has_password ? "Keep your password strong and secure." : "Set a password to also sign in with email + password."}
                  </p>
                </div>
                {me?.has_password && (
                  <button
                    type="button"
                    onClick={() => forgotPassword.mutate()}
                    disabled={forgotPassword.isPending}
                    className="shrink-0 text-sm font-semibold text-blue-700 transition hover:text-blue-900 disabled:opacity-60"
                  >
                    {forgotPassword.isPending ? "Sending…" : "Forgot current password?"}
                  </button>
                )}
              </div>

              {me?.has_password && (
                <div className="grid gap-2 md:grid-cols-[170px_1fr] md:items-center">
                  <label className="text-sm font-bold text-slate-800">Current password</label>
                  <PasswordInput value={current} onChange={setCurrent} placeholder="Enter current password" />
                </div>
              )}

              <div className="grid gap-2 md:grid-cols-[170px_1fr] md:items-center">
                <label className="text-sm font-bold text-slate-800">New password</label>
                <div>
                  <PasswordInput
                    value={next}
                    onChange={(value) => { setNext(value); setNextError(null); }}
                    placeholder="Enter new password"
                    invalid={!!nextError}
                  />
                  {nextError ? (
                    <p className="mt-1 text-xs text-red-600">{nextError}</p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-400">At least 12 characters.</p>
                  )}
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-[170px_1fr] md:items-center">
                <label className="text-sm font-bold text-slate-800">Confirm new password</label>
                <div>
                  <PasswordInput
                    value={confirm}
                    onChange={(value) => { setConfirm(value); setConfirmError(null); }}
                    placeholder="Confirm new password"
                    invalid={!!confirmError}
                  />
                  {confirmError && <p className="mt-1 text-xs text-red-600">{confirmError}</p>}
                </div>
              </div>

              {pwMsg && (
                <div className={`rounded-lg px-3 py-2.5 text-sm ${pwMsg.ok ? "border border-green-200 bg-green-50 text-green-700" : "border border-red-200 bg-red-50 text-red-600"}`}>
                  {pwMsg.text}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={changePw.isPending}
                  className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60"
                >
                  {changePw.isPending ? "Saving..." : me?.has_password ? "Update password" : "Set password"}
                </button>
              </div>
            </form>

            {/* Two-factor authentication */}
            <div className="border-t border-zinc-100 pt-7">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-slate-500 [&_svg]:h-[18px] [&_svg]:w-[18px]"><ShieldIcon /></span>
                <h3 className="text-sm font-bold text-slate-900">Two-factor authentication</h3>
                <StatusChip tone={mfaOn ? "on" : "off"}>{mfaOn ? "On" : "Off"}</StatusChip>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                Add an extra layer of security to your account by requiring a verification code in addition to your password when signing in.
              </p>
              {mfaMsg && (
                <div className={`mt-3 rounded-lg px-3 py-2.5 text-sm ${mfaMsg.ok ? "border border-green-200 bg-green-50 text-green-700" : "border border-red-200 bg-red-50 text-red-600"}`}>
                  {mfaMsg.text}
                </div>
              )}
              <div className="mt-4 flex items-center justify-between gap-4">
                <p className="text-sm text-slate-600">Status: <span className="font-semibold text-slate-800">{mfaOn ? "On" : "Off"}</span></p>
                {me?.totp_enabled ? (
                  <button
                    type="button"
                    onClick={() => { setShowDisableMfa(true); setMfaMsg(null); }}
                    className="shrink-0 rounded-lg border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-zinc-50"
                  >
                    Disable
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => startMfaSetup.mutate()}
                    disabled={startMfaSetup.isPending}
                    className="inline-flex shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60"
                  >
                    {startMfaSetup.isPending ? "Preparing..." : "Set up 2FA"}
                  </button>
                )}
              </div>
            </div>

            {/* Recovery codes */}
            <div className="border-t border-zinc-100 pt-7">
              <div className="flex items-center gap-2.5">
                <span className="text-slate-500 [&_svg]:h-[18px] [&_svg]:w-[18px]"><KeyIcon /></span>
                <h3 className="text-sm font-bold text-slate-900">Recovery codes</h3>
              </div>
              <p className="mt-1.5 text-sm text-slate-500">Recovery codes allow you to sign in if you lose access to your authenticator.</p>
              <div className="mt-4">
                {!mfaOn ? (
                  <div className="flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50/70 px-4 py-3.5 text-sm text-slate-500">
                    <span className="text-zinc-400 [&_svg]:h-4 [&_svg]:w-4"><LockIcon /></span>
                    Unavailable until two-factor authentication is enabled.
                  </div>
                ) : recoveryCodes ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
                    <p className="text-sm font-semibold text-amber-900">Save these now — they won't be shown again.</p>
                    <p className="mt-0.5 text-xs text-amber-800/80">Each code works once. Store them somewhere safe.</p>
                    <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-amber-200/70 bg-white p-4">
                      {recoveryCodes.map((c) => (
                        <code key={c} className="font-mono text-sm tracking-wide text-slate-800">{c}</code>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => navigator.clipboard.writeText(recoveryCodes.join("\n")).catch(() => {})} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50">Copy all</button>
                      <button type="button" onClick={() => downloadRecoveryCodes(recoveryCodes)} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50">Download .txt</button>
                      <button type="button" onClick={() => setRecoveryCodes(null)} className="ml-auto rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50">Done</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-zinc-200 px-5 py-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800">{me?.mfa_backup_codes_remaining ?? 0} of 10 codes remaining</p>
                      <p className="mt-0.5 text-xs text-zinc-500">Each code signs you in once when your authenticator is unavailable.</p>
                    </div>
                    <button type="button" onClick={() => generateCodes.mutate()} disabled={generateCodes.isPending} className="shrink-0 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60">
                      {generateCodes.isPending ? "Generating…" : (me?.mfa_backup_codes_remaining ?? 0) > 0 ? "Regenerate codes" : "Generate codes"}
                    </button>
                  </div>
                )}
              </div>
            </div>
            </div>
          </SimpleCard>

          {/* Connected providers */}
          <SimpleCard icon={<LinkIcon />} title="Connected providers">
            <div className="overflow-hidden rounded-lg border border-zinc-200">
              <div className="divide-y divide-zinc-200">
                <ProviderRow
                  name="GitHub"
                  icon={<ProviderLogo provider="github" />}
                  connected={!!me?.github_id}
                  connectUrl={ghConnectUrl ?? null}
                  onDisconnect={() => setToast({ kind: "success", text: "GitHub management will open here soon." })}
                  disconnecting={disconnectGh.isPending}
                  lastMethod={!!me && (me.has_password ? 1 : 0) + (me.gitlab_id ? 1 : 0) + (me.google_id ? 1 : 0) === 0}
                />
                <ProviderRow
                  name="GitLab"
                  icon={<ProviderLogo provider="gitlab" />}
                  connected={!!me?.gitlab_id}
                  connectUrl={glConnectUrl ?? null}
                  onDisconnect={() => setToast({ kind: "success", text: "GitLab management will open here soon." })}
                  disconnecting={disconnectGl.isPending}
                  lastMethod={!!me && (me.has_password ? 1 : 0) + (me.github_id ? 1 : 0) + (me.google_id ? 1 : 0) === 0}
                />
                <ProviderRow
                  name="Google"
                  icon={<ProviderLogo provider="google" />}
                  connected={!!me?.google_id}
                  connectUrl={googleConnectUrl ?? null}
                  onDisconnect={() => setToast({ kind: "success", text: "Google management will open here soon." })}
                  disconnecting={disconnectGoogle.isPending}
                  lastMethod={!!me && (me.has_password ? 1 : 0) + (me.github_id ? 1 : 0) + (me.gitlab_id ? 1 : 0) === 0}
                />
              </div>
            </div>
          </SimpleCard>
        </div>

        {/* ── Right column ── */}
        <div className="space-y-5">
          <SimpleCard
            icon={<svg fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>}
            title="Account status"
          >
            <div className="-my-2.5 divide-y divide-zinc-100">
              <StatusRow icon={<MailIcon />} label="Email" value="Verified" tone="ok" />
              <StatusRow icon={<LockIcon />} label="Password" value={hasPw ? "Set" : "Not set"} tone={hasPw ? "ok" : "muted"} />
              <StatusRow icon={<ShieldIcon />} label="Two-factor authentication" value={mfaOn ? "On" : "Off"} tone={mfaOn ? "ok" : "muted"} />
              <StatusRow icon={<LinkIcon />} label="Connected providers" value={`${providerCount} connected`} tone={providerCount > 0 ? "good" : "muted"} />
            </div>
          </SimpleCard>

          <SimpleCard
            icon={<svg fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25" /></svg>}
            title="Sessions"
          >
            <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-white">
                  <BrowserIcon browser={currentBrowser} className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{currentDevice()}</p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {session?.location ? `This device · ${session.location}` : "This device · signed in"}
                  </p>
                </div>
              </div>
              <StatusChip tone="on">Current</StatusChip>
            </div>
            <button type="button" onClick={signOut} className="mt-4 w-full rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-zinc-50">
              Sign out
            </button>
          </SimpleCard>

          <section className="rounded-xl border border-red-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2.5 text-red-600">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.3 3.38c-.87 1.5.2 3.37 1.93 3.37h14.74c1.73 0 2.81-1.87 1.94-3.37L13.95 3.38c-.87-1.5-3.04-1.5-3.9 0L2.7 16.13ZM12 15.75h.01v.01H12v-.01Z" />
              </svg>
              <h2 className="text-base font-bold text-red-600">Danger zone</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              Sign out of Vigil on this device. Signing out of all devices needs session management, which isn't available yet.
            </p>
            <button type="button" onClick={signOut} className="mt-4 w-full rounded-lg border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50">
              Sign out
            </button>
          </section>
        </div>
      </div>

      <div className="hidden">

        <Panel
          icon={<LockIcon />}
          tint="bg-indigo-50 text-indigo-600"
          title={me?.has_password ? "Password" : "Set a password"}
          description={me?.has_password ? "Change the password you use for email sign-in." : "Your account uses SSO. Set a password to also sign in with email + password."}
          status={<StatusChip tone={hasPw ? "on" : "off"}>{hasPw ? "Set" : "Not set"}</StatusChip>}
        >
        <form noValidate onSubmit={submitPassword} className="space-y-4">
          {me?.has_password && (
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">Current password</label>
              <input
                type="password"
                className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition"
                value={current}
                onChange={e => setCurrent(e.target.value)}
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1.5">New password</label>
            <input
              type="password"
              className={`w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition ${
                nextError
                  ? "border-red-300 focus:ring-red-500"
                  : "border-zinc-200 focus:ring-zinc-900"
              }`}
              value={next}
              onChange={e => { setNext(e.target.value); setNextError(null); }}
            />
            {nextError ? (
              <p className="mt-1.5 text-xs text-red-600">{nextError}</p>
            ) : (
              <p className="mt-1.5 text-xs text-zinc-400">At least 12 characters.</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1.5">Confirm new password</label>
            <input
              type="password"
              className={`w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition ${
                confirmError
                  ? "border-red-300 focus:ring-red-500"
                  : "border-zinc-200 focus:ring-zinc-900"
              }`}
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setConfirmError(null); }}
            />
            {confirmError && (
              <p className="mt-1.5 text-xs text-red-600">{confirmError}</p>
            )}
          </div>
          {pwMsg && (
            <div className={`rounded-lg px-3 py-2.5 text-sm ${pwMsg.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-600 border border-red-200"}`}>
              {pwMsg.text}
            </div>
          )}
          <button
            type="submit"
            disabled={changePw.isPending}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors disabled:opacity-60"
          >
            {changePw.isPending ? "Saving…" : me?.has_password ? "Update password" : "Set password"}
          </button>
        </form>
        </Panel>

        {/* Single sign-on */}
        <Panel
          icon={<LinkIcon />}
          tint="bg-sky-50 text-sky-600"
          title="Single sign-on"
          description="Connect a provider to sign in without a password."
          status={<StatusChip tone={providerCount ? "on" : "off"}>{providerCount} connected</StatusChip>}
          flush
        >
        <div className="divide-y divide-zinc-100">
          <ProviderRow
            name="GitHub"
            icon={
              <svg className="h-5 w-5 text-zinc-700" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
            }
            connected={!!me?.github_id}
            connectUrl={ghConnectUrl ?? null}
            onDisconnect={() => disconnectGh.mutate()}
            disconnecting={disconnectGh.isPending}
            lastMethod={!!me && (me.has_password ? 1 : 0) + (me.gitlab_id ? 1 : 0) + (me.google_id ? 1 : 0) === 0}
          />

          <ProviderRow
            name="GitLab"
            icon={
              <svg className="h-5 w-5 text-[#e24329]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51a.42.42 0 0 1 .11-.18.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
              </svg>
            }
            connected={!!me?.gitlab_id}
            connectUrl={glConnectUrl ?? null}
            onDisconnect={() => disconnectGl.mutate()}
            disconnecting={disconnectGl.isPending}
            lastMethod={!!me && (me.has_password ? 1 : 0) + (me.github_id ? 1 : 0) + (me.google_id ? 1 : 0) === 0}
          />

          <ProviderRow
            name="Google"
            icon={
              <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            }
            connected={!!me?.google_id}
            connectUrl={googleConnectUrl ?? null}
            onDisconnect={() => disconnectGoogle.mutate()}
            disconnecting={disconnectGoogle.isPending}
            lastMethod={!!me && (me.has_password ? 1 : 0) + (me.github_id ? 1 : 0) + (me.gitlab_id ? 1 : 0) === 0}
          />
        </div>
        </Panel>

        {/* Two-factor authentication */}
        <Panel
          icon={<ShieldIcon />}
          tint={mfaOn ? "bg-emerald-50 text-emerald-600" : "bg-zinc-100 text-zinc-500"}
          title="Two-factor authentication"
          description="Require a code from your authenticator app when signing in with email, Google, GitHub, or GitLab."
          status={<StatusChip tone={mfaOn ? "on" : "off"}>{mfaOn ? "Enabled" : "Disabled"}</StatusChip>}
        >
          {mfaMsg && (
            <div className={`mb-3 rounded-lg px-3 py-2.5 text-sm ${mfaMsg.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-600 border border-red-200"}`}>
              {mfaMsg.text}
            </div>
          )}

          {me?.totp_enabled ? (
            <>
              {!showDisableMfa && (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-sm text-emerald-700">
                    <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    Enabled
                  </div>
                  <button
                    type="button"
                    onClick={() => { setShowDisableMfa(true); setMfaMsg(null); }}
                    className="shrink-0 text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors"
                  >
                    Disable
                  </button>
                </div>
              )}
              {showDisableMfa && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setMfaMsg(null);
                    disableMfa.mutate();
                  }}
                  className="space-y-4 rounded-lg border border-zinc-200 bg-zinc-50/50 p-4"
                >
                  <p className="text-xs leading-relaxed text-zinc-500">Enter your current authenticator code to disable MFA.</p>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1.5">Authentication code</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      className="w-full border border-zinc-200 rounded-lg bg-white px-3 py-2.5 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition"
                      value={mfaDisableCode}
                      onChange={e => setMfaDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      required
                    />
                  </div>
                  {me.has_password && (
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1.5">Password</label>
                      <input
                        type="password"
                        className="w-full border border-zinc-200 rounded-lg bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition"
                        value={mfaDisablePassword}
                        onChange={e => setMfaDisablePassword(e.target.value)}
                        required
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={disableMfa.isPending || mfaDisableCode.length !== 6}
                      className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-60"
                    >
                      {disableMfa.isPending ? "Disabling…" : "Confirm disable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDisableMfa(false);
                        setMfaDisableCode("");
                        setMfaDisablePassword("");
                        setMfaMsg(null);
                      }}
                      className="rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : mfaSetup ? (
            <div className="space-y-5">
              <p className="text-sm leading-relaxed text-zinc-600">
                Scan this QR code with Google Authenticator, 1Password, or another TOTP app, then enter the 6-digit code to confirm.
              </p>
              {mfaSetup.qr_data_url ? (
                <img
                  src={mfaSetup.qr_data_url}
                  alt="Authenticator QR code"
                  className="mx-auto h-44 w-44 rounded-lg border border-zinc-200 bg-white p-3"
                />
              ) : null}
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1.5">Manual entry key</p>
                <code className="text-xs text-zinc-800 break-all">{mfaSetup.secret}</code>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setMfaMsg(null);
                  enableMfa.mutate();
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1.5">Verification code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition"
                    value={mfaEnableCode}
                    onChange={e => setMfaEnableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={enableMfa.isPending || mfaEnableCode.length !== 6}
                    className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors disabled:opacity-60"
                  >
                    {enableMfa.isPending ? "Enabling…" : "Enable MFA"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMfaSetup(null); setMfaEnableCode(""); }}
                    className="rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => startMfaSetup.mutate()}
              disabled={startMfaSetup.isPending}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 transition-colors disabled:opacity-60"
            >
              {startMfaSetup.isPending ? "Preparing…" : "Set up authenticator app"}
            </button>
          )}
        </Panel>
      </div>

      {mfaSetup && !me?.totp_enabled && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mfa-setup-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/70 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <ShieldIcon />
                </p>
                <h2 id="mfa-setup-title" className="text-xl font-extrabold tracking-tight text-slate-950">
                  Set up two-factor authentication
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  Scan the QR code, then enter the 6-digit code from your authenticator app.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close two-factor setup"
                onClick={() => {
                  setMfaSetup(null);
                  setMfaEnableCode("");
                  setMfaMsg(null);
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-xl leading-none text-slate-500 transition-colors hover:bg-zinc-50 hover:text-slate-900"
              >
                &times;
              </button>
            </div>

            {mfaMsg && !mfaMsg.ok && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600">
                {mfaMsg.text}
              </div>
            )}

            {mfaSetup.qr_data_url ? (
              <img
                src={mfaSetup.qr_data_url}
                alt="Authenticator QR code"
                className="mx-auto h-56 w-56 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm"
              />
            ) : (
              <div className="mx-auto flex h-56 w-56 items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 text-center text-sm font-medium text-slate-500">
                QR code unavailable. Use the manual key below.
              </div>
            )}

            <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Manual entry key</p>
              <code className="break-all text-xs text-zinc-800">{mfaSetup.secret}</code>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setMfaMsg(null);
                enableMfa.mutate();
              }}
              className="mt-5 space-y-4"
            >
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Verification code</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoFocus
                  className="w-full rounded-lg border border-zinc-200 px-3 py-3 text-center font-mono text-lg text-slate-900 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-100"
                  value={mfaEnableCode}
                  onChange={e => setMfaEnableCode(e.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
                  onPaste={e => {
                    e.preventDefault();
                    setMfaEnableCode(e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6));
                  }}
                  required
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setMfaSetup(null);
                    setMfaEnableCode("");
                    setMfaMsg(null);
                  }}
                  className="flex-1 rounded-lg border border-zinc-200 px-5 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-zinc-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={enableMfa.isPending || mfaEnableCode.length !== 6}
                  className="flex-1 rounded-lg border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60"
                >
                  {enableMfa.isPending ? "Enabling..." : "Enable 2FA"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 shadow-lg shadow-black/10 ring-1 ring-white/5 animate-toast-in"
        >
          {toast.kind === "success" ? (
            <svg className="h-3.5 w-3.5 shrink-0 text-emerald-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 10.5 3.5 3.5L15 7" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5 shrink-0 text-red-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l8 8M14 6l-8 8" />
            </svg>
          )}
          <span className="text-sm font-medium text-white">{toast.text}</span>
        </div>
      )}
    </div>
  );
}
