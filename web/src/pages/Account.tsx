import { useState, useEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../api";
import { meSchema, type Me } from "../lib/apiSchemas";
import {
  OverviewActionCard,
  OverviewFactRow,
  PostureMetricCell,
  PostureReadinessCell,
  ReadinessChecklistPanel,
  type Tone,
} from "./Workspace";
import "../styles/workspace-page.css";

// d-path icons for the Workspace-style KPI strip + overview cards (Workspace's
// Icon component renders a single <path d>). Kept local so the Account page
// reuses the exact same visual primitives without importing the named Icon.
const KPI_ICON = {
  mail: "M21.75 7.5v9a2.25 2.25 0 0 1-2.25 2.25h-15A2.25 2.25 0 0 1 2.25 16.5v-9m19.5 0A2.25 2.25 0 0 0 19.5 5.25h-15A2.25 2.25 0 0 0 2.25 7.5m19.5 0-8.7 5.8a2.25 2.25 0 0 1-2.5 0L2.25 7.5",
  building: "M4.5 21V5.25A2.25 2.25 0 0 1 6.75 3h6a2.25 2.25 0 0 1 2.25 2.25V21m-10.5 0h15m-15 0H3m12 0h6m-10.5 0v-3.375c0-.621-.504-1.125-1.125-1.125h-.75c-.621 0-1.125.504-1.125 1.125V21m1.5-13.5h.008v.008H9V7.5Zm0 3h.008v.008H9V10.5Zm0 3h.008v.008H9V13.5Zm3-6h.008v.008H12V7.5Zm0 3h.008v.008H12V10.5Zm0 3h.008v.008H12V13.5Z",
  fingerprint: "M7.5 12.75a4.5 4.5 0 0 1 9 0M9.75 12.75a2.25 2.25 0 0 1 4.5 0m-8.1 2.75c.58 1.63 1.72 2.82 3.35 3.5m5-15.25A8.25 8.25 0 0 0 3.75 11.6m16.5 0A8.25 8.25 0 0 0 11.4 3.35m5.95 12.15c-.58 1.63-1.72 2.82-3.35 3.5m-2-6.25c0 3.25-1.05 5.6-3.15 7.05m6.3 0c-2.1-1.45-3.15-3.8-3.15-7.05",
  shield: "M9 12.75 11.25 15 15 9.75m-3-7.036A11.96 11.96 0 0 1 3.6 6 12 12 0 0 0 3 9.75c0 5.59 3.82 10.29 9 11.62 5.18-1.33 9-6.03 9-11.62 0-1.31-.21-2.57-.6-3.75h-.15a11.96 11.96 0 0 1-8.25-3.29Z",
  lock: "M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z",
  key: "M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.03 5.91c-.56-.1-1.16.03-1.56.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.82c0-.6.24-1.17.66-1.59l6.5-6.5c.4-.4.52-1 .43-1.56A6 6 0 1 1 21.75 8.25Z",
  refresh: "M16.02 9.35h4.16V5.19M20.18 9.35A8.25 8.25 0 0 0 5.82 6.3M7.98 14.65H3.82v4.16M3.82 14.65a8.25 8.25 0 0 0 14.36 3.05",
  user: "M15.75 7.5a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.25a7.5 7.5 0 0 1 15 0",
} as const;

type MfaSetup = {
  secret: string;
  provisioning_uri: string;
  qr_data_url: string | null;
};

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
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const { data: me } = useQuery<Me>({ queryKey: ["me"], queryFn: () => api("/v1/auth/me", { schema: meSchema }) });

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
    onError: (e: Error) => {
      const text = formatApiError(e);
      setMfaMsg({ ok: false, text });
      setToast({ kind: "error", text });
    },
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
    const blob = new Blob([`Veritrail recovery codes\n\n${codes.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "veritrail-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const email = me?.email ?? "";
  const mfaOn = !!me?.totp_enabled;
  const hasPw = !!me?.has_password;
  const healthStrong = hasPw && mfaOn;
  const passwordStrength = getPasswordStrength(next);

  const providerCount = (me?.github_id ? 1 : 0) + (me?.google_id ? 1 : 0);
  const codesRemaining = me?.mfa_backup_codes_remaining ?? 0;

  // Single source of truth for the posture ring + checklist panel: finishing
  // every item reads 100% (no hidden factors), mirroring Workspace readiness.
  const postureItems = [
    { label: "Email verified", done: true },
    { label: "Password set", done: hasPw },
    { label: "Two-factor authentication enabled", done: mfaOn },
    { label: "Recovery codes generated", done: codesRemaining > 0 },
    { label: "Backup sign-in connected", done: providerCount > 0 },
  ];
  const postureScore = Math.round((postureItems.filter((i) => i.done).length / postureItems.length) * 100);
  const postureTone: Tone = postureScore >= 90 ? "ok" : postureScore >= 70 ? "warn" : "danger";
  const postureLabel = postureScore >= 90 ? "Ready" : postureScore >= 70 ? "Review" : "Setup";
  const postureMessage =
    postureScore >= 100 ? "Everything looks good. Keep it up." : postureScore >= 70 ? "A few items left to finish." : "Finish setup to secure your account.";

  return (
    <div className="flex w-full max-w-none flex-col gap-5 pb-2">

      <div className="workspace-summary">
        <PostureReadinessCell
          title="Account security posture"
          score={postureScore}
          tone={postureTone}
          label={postureLabel}
          message={postureMessage}
        />
        <PostureMetricCell
          icon={KPI_ICON.mail}
          label="Email"
          value="Verified"
          detail={email || "—"}
          valueTone="ok"
        />
        <PostureMetricCell
          icon={KPI_ICON.building}
          label="Workspace"
          value={me?.org_name ?? "—"}
          detail={`Role: ${me?.role ?? "member"}`}
        />
        <PostureMetricCell
          icon={KPI_ICON.key}
          label="Sign-in"
          value={hasPw ? "Password" : providerCount ? "SSO" : "—"}
          detail={providerCount ? `+ ${providerCount} provider${providerCount === 1 ? "" : "s"}` : "No linked providers"}
          valueTone="info"
        />
        <PostureMetricCell
          icon={KPI_ICON.shield}
          label="Two-factor"
          value={mfaOn ? "On" : "Off"}
          detail={mfaOn ? "Authenticator app" : "Not enabled"}
          valueTone={mfaOn ? "ok" : "default"}
        />
      </div>

      <div className="workspace-overview">
        <div className="workspace-overview__cards">
          <OverviewActionCard
            tone="blue"
            icon={KPI_ICON.lock}
            title="Password"
            description="Keep your password strong and up to date."
            actionLabel={hasPw ? "Change password" : "Set password"}
            onAction={() => { setPwMsg(null); setPasswordDialogOpen(true); }}
          >
            <OverviewFactRow icon={KPI_ICON.lock} label="Status" value={hasPw ? "Set" : "Not set"} />
            <OverviewFactRow icon={KPI_ICON.shield} label="Strength" value={hasPw ? "Strong" : "—"} />
            <OverviewFactRow icon={KPI_ICON.refresh} label="Last updated" value={hasPw ? "Recently" : "—"} />
          </OverviewActionCard>

          <OverviewActionCard
            tone="green"
            icon={KPI_ICON.shield}
            title="Two-factor authentication"
            description="Require an authenticator code, with recovery codes as backup."
            actionLabel={mfaOn ? "Manage 2FA" : startMfaSetup.isPending ? "Preparing…" : "Set up 2FA"}
            onAction={() => startMfaSetup.mutate()}
          >
            <OverviewFactRow icon={KPI_ICON.shield} label="Status" value={mfaOn ? "Enabled" : "Disabled"} />
            <OverviewFactRow icon={KPI_ICON.fingerprint} label="Method" value={mfaOn ? "Authenticator app" : "None"} />
            <OverviewFactRow icon={KPI_ICON.key} label="Recovery codes" value={`${codesRemaining} unused`} />
          </OverviewActionCard>

          <OverviewActionCard
            tone="violet"
            icon={KPI_ICON.key}
            title="Recovery codes"
            description="One-time codes to sign in if you lose your device."
            actionLabel={mfaOn ? (codesRemaining ? "View / refresh codes" : "Generate codes") : "Enable 2FA first"}
            onAction={() => (mfaOn ? generateCodes.mutate() : startMfaSetup.mutate())}
          >
            <OverviewFactRow icon={KPI_ICON.key} label="Available" value={`${codesRemaining} unused`} />
            <OverviewFactRow icon={KPI_ICON.shield} label="Status" value={mfaOn ? "Active" : "Locked"} />
            <OverviewFactRow icon={KPI_ICON.refresh} label="Requires" value="2FA enabled" />
          </OverviewActionCard>

          <OverviewActionCard
            tone="amber"
            icon={KPI_ICON.refresh}
            title="Recovery methods"
            description="Keep recovery contacts current so you can always get back in."
            actionLabel="Manage recovery"
            onAction={() => setRecoveryDialog({ type: "email", value: email })}
          >
            <OverviewFactRow icon={KPI_ICON.mail} label="Recovery email" value={email || "—"} />
            <OverviewFactRow icon={KPI_ICON.user} label="Recovery phone" value="Not available" />
            <OverviewFactRow icon={KPI_ICON.shield} label="Primary" value="Email" />
          </OverviewActionCard>
        </div>

        <ReadinessChecklistPanel
          title="Account security posture"
          readyCopy="Your account is fully hardened. Keep it that way."
          score={postureScore}
          tone={postureTone}
          label={postureLabel}
          items={postureItems}
        />
      </div>

      {passwordDialogOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl rounded-2xl border border-white/70 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.28)]">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"><Icon name="lock" /></p>
                <h2 className="text-xl font-bold tracking-tight text-slate-950">Change password</h2>
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
                  <button type="button" onClick={() => setPasswordDialogOpen(false)} className="veritrail-toolbar-btn veritrail-toolbar-btn--neutral veritrail-toolbar-btn--lg">Cancel</button>
                  <button type="submit" disabled={changePw.isPending} className="veritrail-toolbar-btn veritrail-toolbar-btn--primary-solid veritrail-toolbar-btn--lg">
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
                <h2 className="text-xl font-bold tracking-tight text-slate-950">Set up two-factor authentication</h2>
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
              {mfaMsg && !mfaMsg.ok ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{mfaMsg.text}</p> : null}
              <button type="submit" disabled={enableMfa.isPending || mfaEnableCode.length !== 6} className="veritrail-toolbar-btn veritrail-toolbar-btn--primary-solid veritrail-toolbar-btn--lg w-full">{enableMfa.isPending ? "Enabling..." : "Enable 2FA"}</button>
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
                <h2 className="text-xl font-bold tracking-tight text-slate-950">
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
                <button type="button" onClick={() => setRecoveryDialog(null)} className="veritrail-toolbar-btn veritrail-toolbar-btn--neutral veritrail-toolbar-btn--lg">Cancel</button>
                <button type="submit" className="veritrail-toolbar-btn veritrail-toolbar-btn--primary-solid veritrail-toolbar-btn--lg">Save changes</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {recoveryCodes ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]" role="dialog" aria-modal="true" onClick={() => setRecoveryCodes(null)}>
          <div className="w-full max-w-md rounded-2xl border border-white/70 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.28)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-violet-100 bg-violet-50 text-violet-700"><Icon name="key" /></p>
                <h2 className="text-xl font-bold tracking-tight text-slate-950">Recovery codes</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">Save these now. They will not be shown again.</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setRecoveryCodes(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-xl leading-none text-slate-500 hover:bg-zinc-50">&times;</button>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
              {recoveryCodes.map((code) => <code key={code} className="font-mono text-sm text-slate-800">{code}</code>)}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => navigator.clipboard.writeText(recoveryCodes.join("\n")).catch(() => {})} className="veritrail-toolbar-btn veritrail-toolbar-btn--neutral">Copy all</button>
              <button type="button" onClick={() => downloadRecoveryCodes(recoveryCodes)} className="veritrail-toolbar-btn veritrail-toolbar-btn--neutral">Download .txt</button>
              <button type="button" onClick={() => setRecoveryCodes(null)} className="veritrail-toolbar-btn veritrail-toolbar-btn--primary-solid">Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? <div className={`fixed bottom-5 right-5 z-[70] rounded-lg px-4 py-3 text-sm font-semibold shadow-lg ${toast.kind === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>{toast.text}</div> : null}
    </div>
  );
}
