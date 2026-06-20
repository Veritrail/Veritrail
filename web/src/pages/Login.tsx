import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, BASE, consumeSignedOut, formatApiError, restoreSession, storeTokens, token } from "../api";
import { accessTokenSchema, loginResponseSchema, tokenPairSchema } from "../lib/apiSchemas";
import { postAuthPath } from "../lib/postAuthRedirect";
import "../styles/login-auth.css";

type AuthMode = "login" | "signup" | "forgot" | "onboard";

const MFA_STORAGE_KEY = "vigil_mfa_token";
const PENDING_CREDENTIALS_KEY = "vigil_pending_credentials";

const PENDING_INVITE_KEY = "vigil_pending_invite_token";

function oauthErrorMessage(code: string): string {
  switch (code) {
    case "oauth_denied":
      return "Sign-in cancelled.";
    case "no_email":
      return "Could not read your email from the provider — check account settings.";
    case "bad_link_token":
      return "Session expired while connecting. Sign in and try again.";
    case "github_already_linked":
      return "That GitHub account is already linked to another user.";
    case "gitlab_already_linked":
      return "That GitLab account is already linked to another user.";
    case "google_already_linked":
      return "That Google account is already linked to another user.";
    case "domain_not_allowed":
      return "Google sign-in is restricted to company accounts only.";
    case "no_account_for_idp":
      return "No account matches that sign-in. Sign up first, then connect this provider.";
    case "domain_managed":
      return "This email domain already has a Vigil workspace. Ask your admin for an invite, or choose a different workspace name.";
    case "invite_accept_failed":
      return "Could not join the workspace from your invite. Open the invite link again and try once more.";
    case "signup_pending":
      return "Finish setting up your workspace to continue.";
    case "saml_invalid_response":
    case "saml_not_authenticated":
      return "SSO sign-in failed. Contact your administrator.";
    case "saml_no_email":
      return "Your identity provider didn't share an email address.";
    case "saml_email_other_org":
      return "That email already belongs to a different workspace.";
    case "server_error":
      return "Sign-in failed on our side. Try again.";
    default:
      return "Sign-in failed. Try again.";
  }
}

function storeMfaToken(token: string) {
  sessionStorage.setItem(MFA_STORAGE_KEY, token);
}

function clearMfaToken() {
  sessionStorage.removeItem(MFA_STORAGE_KEY);
}

function readStoredMfaToken(): string | null {
  return sessionStorage.getItem(MFA_STORAGE_KEY);
}

/** Prompt Chrome / GSuite password manager after a successful credential login. */
async function offerCredentialSave(
  form: HTMLFormElement | null,
  fallback?: { email: string; password: string },
): Promise<void> {
  if (!("PasswordCredential" in window) || !navigator.credentials?.store) return;
  try {
    const credential = form
      ? new PasswordCredential(form)
      : fallback
        ? new PasswordCredential({ id: fallback.email, password: fallback.password, name: fallback.email })
        : null;
    if (!credential) return;
    await navigator.credentials.store(credential);
  } catch {
    // User dismissed or browser blocked the save prompt.
  }
}

function storePendingCredentials(email: string, password: string) {
  sessionStorage.setItem(PENDING_CREDENTIALS_KEY, JSON.stringify({ email, password }));
}

function takePendingCredentials(): { email: string; password: string } | null {
  const raw = sessionStorage.getItem(PENDING_CREDENTIALS_KEY);
  sessionStorage.removeItem(PENDING_CREDENTIALS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { email: string; password: string };
  } catch {
    return null;
  }
}

function IconMail() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m3 8 9 5 9-5M3 8v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8M3 8l9-5 9 5" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V7.5a4.5 4.5 0 1 0-9 0v3M6 10.5h12a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18v-6A1.5 1.5 0 0 1 6 10.5Z" />
    </svg>
  );
}

function IconEye({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
      </svg>
    );
  }
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.619-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function GitLabIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="#e24329" aria-hidden>
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51a.42.42 0 0 1 .11-.18.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}

function AuthOAuthButtons({
  rememberMe,
  inviteToken,
  pickAccount,
}: {
  rememberMe: boolean;
  inviteToken?: string | null;
  pickAccount?: boolean;
}) {
  const params = new URLSearchParams();
  if (!rememberMe) params.set("remember", "0");
  if (inviteToken) params.set("invite_token", inviteToken);
  if (pickAccount) params.set("pick_account", "1");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return (
    <>
      <div className="auth-divider">
        <span>or continue with</span>
      </div>
      <div className="auth-oauth-grid">
        <a href={`${BASE}/v1/auth/google${suffix}`} className="auth-oauth-btn">
          <GoogleIcon />
          Google
        </a>
        <a href={`${BASE}/v1/auth/github${suffix}`} className="auth-oauth-btn">
          <GitHubIcon />
          GitHub
        </a>
        <a href={`${BASE}/v1/auth/gitlab${suffix}`} className="auth-oauth-btn">
          <GitLabIcon />
          GitLab
        </a>
      </div>
    </>
  );
}

function AuthLegalFooter({ mode }: { mode: AuthMode }) {
  const verb = mode === "signup" ? "creating an account" : "signing in";
  return (
    <p className="auth-footer-legal">
      By {verb}, you agree to our{" "}
      <a href="/terms">
        Terms
      </a>{" "}
      and{" "}
      <a href="/privacy">
        Privacy Policy
      </a>
      .
    </p>
  );
}

export default function Login() {
  const nav = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const inviteToken = params.get("invite_token");
  const inviteEmail = params.get("email");
  const signupToken = params.get("signup_token");
  const [mode, setMode] = useState<AuthMode>(() => {
    if (params.get("mode") === "forgot") return "forgot";
    if (params.get("mode") === "onboard" || params.get("signup_token")) return "onboard";
    if (params.get("mode") === "login") return "login";
    if (params.get("mode") === "signup") return "signup";
    if (params.get("invite_token")) return "login";
    return "login";
  });
  const [email, setEmail] = useState(() => inviteEmail ?? params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [autofillEnabled, setAutofillEnabled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [forgotSent, setForgotSent] = useState(false);
  const [requestAccessEmail, setRequestAccessEmail] = useState<string | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [loginFormKey, setLoginFormKey] = useState(0);
  const [freshSignIn] = useState(
    () =>
      params.get("signed_out") === "1" ||
      consumeSignedOut() ||
      Boolean((location.state as { signedOut?: boolean } | null)?.signedOut),
  );
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function enableAutofill() {
    setAutofillEnabled(true);
    emailRef.current?.removeAttribute("readonly");
    passwordRef.current?.removeAttribute("readonly");
  }

  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  useEffect(() => {
    const signedOut = (location.state as { signedOut?: boolean } | null)?.signedOut;
    if (!signedOut) return;
    setAutofillEnabled(false);
    setLoginFormKey((key) => key + 1);
    window.history.replaceState(null, "", "/login");
  }, [location.state]);

  useEffect(() => {
    if (inviteToken) sessionStorage.setItem(PENDING_INVITE_KEY, inviteToken);
  }, [inviteToken]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (freshSignIn) {
        if (!cancelled) setCheckingSession(false);
        return;
      }
      if (token()) {
        if (inviteToken) {
          try {
            const access = await acceptInviteAfterLogin(token()!);
            storeTokens(access);
          } catch {
            if (!cancelled) setCheckingSession(false);
            return;
          }
        }
        if (!cancelled) nav(await postAuthPath(), { replace: true });
        return;
      }
      const ok = await restoreSession();
      if (!cancelled) {
        if (ok) nav(await postAuthPath(), { replace: true });
        else setCheckingSession(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nav, freshSignIn, inviteToken]);

  useEffect(() => {
    const token = params.get("mfa_token");
    const oauthErr = params.get("error");
    const next = new URLSearchParams(params);

    if (token) {
      beginMfa(token);
      next.delete("mfa_token");
      next.delete("error");
      setParams(next, { replace: true });
      return;
    }

    if (oauthErr) {
      setErr(oauthErrorMessage(oauthErr));
      next.delete("error");
      setParams(next, { replace: true });
      exitMfa();
      return;
    }

    const stored = readStoredMfaToken();
    if (stored) {
      setMfaToken(stored);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run when URL search params change
  }, [params]);

  function beginMfa(token: string) {
    setMfaToken(token);
    storeMfaToken(token);
    setErr(null);
    setMfaCode("");
  }

  function exitMfa() {
    setMfaToken(null);
    clearMfaToken();
    sessionStorage.removeItem(PENDING_CREDENTIALS_KEY);
    setMfaCode("");
    setErr(null);
  }

  function switchMode(next: AuthMode) {
    setMode(next);
    setErr(null);
    setPasswordError(null);
    setForgotSent(false);
  }

  async function submitForgot(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const emailValue = emailRef.current?.value.trim() ?? email.trim();
    if (!emailValue) {
      setErr("Enter your email address.");
      return;
    }
    setLoading(true);
    try {
      await api("/v1/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email: emailValue }),
      });
      setForgotSent(true);
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }

  async function acceptInviteAfterLogin(accessToken: string) {
    const pending = inviteToken ?? sessionStorage.getItem(PENDING_INVITE_KEY);
    if (!pending) return accessToken;
    const res = await api("/v1/members/invites/accept", {
      method: "POST",
      body: JSON.stringify({ token: pending }),
      schema: accessTokenSchema,
    });
    sessionStorage.removeItem(PENDING_INVITE_KEY);
    return res.access_token;
  }

  async function submitOnboard(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (!signupToken) {
      setErr("Signup session expired — sign in again.");
      return;
    }
    if (!inviteToken && !orgName.trim()) {
      setErr("Enter your organization name.");
      return;
    }
    setLoading(true);
    try {
      const res = await api("/v1/auth/complete-signup", {
        method: "POST",
        body: JSON.stringify({
          signup_token: signupToken,
          org_name: inviteToken ? "" : orgName,
          ...(inviteToken ? { invite_token: inviteToken } : {}),
        }),
        schema: accessTokenSchema,
      });
      storeTokens(res.access_token);
      nav(await postAuthPath());
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setPasswordError(null);
    setRequestAccessEmail(null);
    setRequestSent(false);

    const emailValue =
      mode === "login" ? (emailRef.current?.value.trim() ?? "") : email.trim();
    const passwordValue =
      mode === "login" ? (passwordRef.current?.value ?? "") : password;

    if (!emailValue) {
      setErr("Enter your email address.");
      return;
    }
    if (!passwordValue) {
      setPasswordError("Enter your password.");
      return;
    }
    if (mode === "signup" && passwordValue.length < 12) {
      setPasswordError("Password must be at least 12 characters.");
      return;
    }
    if (mode === "signup" && !inviteToken && !orgName.trim()) {
      setErr("Enter your organization name.");
      return;
    }
    setLoading(true);
    try {
      // SSO domain routing: if this email's domain maps to a verified workspace
      // with SAML enabled, hand off to the IdP instead of password auth.
      if (mode === "login") {
        try {
          const sso = await api<{ sso_enabled: boolean; login_url: string | null }>(
            "/v1/auth/sso/discover",
            { method: "POST", body: JSON.stringify({ email: emailValue }) },
          );
          if (sso.sso_enabled && sso.login_url) {
            window.location.href = sso.login_url;
            return;
          }
        } catch {
          /* discovery is best-effort — fall through to password sign-in */
        }
      }

      const path = mode === "login" ? "/v1/auth/login" : "/v1/auth/signup";
      const body =
        mode === "login"
          ? {
              email: emailValue,
              password: passwordValue,
              remember_me: rememberMe,
              ...(inviteToken ? { invite_token: inviteToken } : {}),
            }
          : {
              email: emailValue,
              password: passwordValue,
              org_name: inviteToken ? "" : orgName,
              ...(inviteToken ? { invite_token: inviteToken } : {}),
            };
      const res = await api(path, { method: "POST", body: JSON.stringify(body), schema: loginResponseSchema });
      if (res.mfa_required && res.mfa_token) {
        if (mode === "login") storePendingCredentials(emailValue, passwordValue);
        beginMfa(res.mfa_token);
        return;
      }
      if (!res.access_token) {
        throw new Error("missing access token");
      }
      clearMfaToken();
      storeTokens(res.access_token);
      const accessToken = await acceptInviteAfterLogin(res.access_token);
      if (accessToken !== res.access_token) storeTokens(accessToken);
      if (mode === "login") {
        await offerCredentialSave(e.currentTarget);
        sessionStorage.removeItem(PENDING_CREDENTIALS_KEY);
      }
      nav(await postAuthPath());
    } catch (e) {
      const msg = formatApiError(e);
      setErr(msg);
      if (mode === "signup" && !inviteToken && /already used by|ask a workspace admin/i.test(msg)) {
        setRequestAccessEmail(emailValue);
      }
    } finally {
      setLoading(false);
    }
  }

  async function requestAccess() {
    if (!requestAccessEmail) return;
    try {
      await api("/v1/join-requests", { method: "POST", body: JSON.stringify({ email: requestAccessEmail }) });
    } catch {
      /* endpoint always responds generically */
    }
    setRequestSent(true);
  }

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setErr(null);
    setLoading(true);
    try {
      const res = await api("/v1/auth/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ mfa_token: mfaToken, code: mfaCode }),
        schema: tokenPairSchema,
      });
      clearMfaToken();
      storeTokens(res.access_token);
      const accessToken = await acceptInviteAfterLogin(res.access_token);
      if (accessToken !== res.access_token) storeTokens(accessToken);
      const pending = takePendingCredentials();
      if (pending) await offerCredentialSave(null, pending);
      nav(await postAuthPath());
    } catch (e) {
      const msg = formatApiError(e);
      if (/expired|sign in again/i.test(msg)) {
        exitMfa();
      } else if (/too many failed attempts|try again in/i.test(msg)) {
        exitMfa();
      }
      setErr(msg);
      setMfaCode("");
    } finally {
      setLoading(false);
    }
  }


  if (checkingSession && !mfaToken) {
    return (
      <div className="auth-shell">
        <div className="auth-shell__inner text-center text-sm text-zinc-400">Checking session…</div>
      </div>
    );
  }

  if (mfaToken) {
    return (
      <div className="auth-shell">
        <div className="auth-shell__inner">
          <div className="auth-card">
            <header className="auth-card__header">
              <h1 className="auth-card__title">Two-factor authentication</h1>
              <p className="auth-card__subtitle">
                Enter the 6-digit code from your authenticator app.
              </p>
            </header>

            <form onSubmit={submitMfa}>
              <div className="auth-field">
                <label htmlFor="mfa-code" className="auth-field__label">
                  Authentication code
                </label>
                <input
                  id="mfa-code"
                  className="auth-field__input !px-3 text-center font-mono tracking-[0.3em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  maxLength={6}
                  value={mfaCode}
                  onChange={e => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  autoFocus
                />
              </div>

              {err && <div className="auth-alert">{err}</div>}

              <button
                type="submit"
                className="auth-submit"
                disabled={loading || mfaCode.length !== 6}
              >
                {loading ? "Verifying…" : "Continue"}
              </button>
            </form>

            <button type="button" className="auth-back-link" onClick={exitMfa}>
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "onboard") {
    return (
      <div className="auth-shell">
        <div className="auth-shell__inner">
          <div className="auth-card">
            <header className="auth-card__header auth-card__header--signup">
              <h1 className="auth-card__title">Create your workspace</h1>
              <p className="auth-card__subtitle">
                {email ? `Signed in as ${email}` : "Choose a workspace name to finish sign-up."}
              </p>
            </header>

            <form noValidate onSubmit={submitOnboard}>
              {!inviteToken && (
                <div className="auth-field">
                  <label htmlFor="organization" className="auth-field__label">
                    Workspace name
                  </label>
                  <input
                    id="organization"
                    name="organization"
                    autoComplete="organization"
                    className="auth-field__input !px-3"
                    value={orgName}
                    onChange={e => setOrgName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              )}
              {inviteToken && (
                <p className="auth-invite-note">
                  You&apos;re joining via workspace invite. Organization is set by your inviter.
                </p>
              )}

              {err && <div className="auth-alert">{err}</div>}

              <button type="submit" className="auth-submit" disabled={loading || !signupToken}>
                {loading ? "Please wait…" : inviteToken ? "Join workspace" : "Create workspace"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "forgot") {
    return (
      <div className="auth-shell">
        <div className="auth-shell__inner">
          <div className="auth-card">
            <header className="auth-card__header">
              <h1 className="auth-card__title">Reset your password</h1>
              <p className="auth-card__subtitle">
                {forgotSent
                  ? "If an account exists for that email, we sent a reset link."
                  : "Enter your email and we'll send you a reset link."}
              </p>
            </header>

            {!forgotSent ? (
              <form onSubmit={submitForgot}>
                <div className="auth-field">
                  <label htmlFor="forgot-email" className="auth-field__label">
                    Email address
                  </label>
                  <div className="auth-field__control">
                    <span className="auth-field__icon" aria-hidden>
                      <IconMail />
                    </span>
                    <input
                      ref={emailRef}
                      id="forgot-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      className="auth-field__input"
                      placeholder="Email Address"
                      defaultValue={email}
                      required
                      autoFocus
                    />
                  </div>
                </div>

                {err && <div className="auth-alert">{err}</div>}

                <button type="submit" className="auth-submit" disabled={loading}>
                  {loading ? "Sending…" : "Send reset link"}
                </button>
              </form>
            ) : (
              <div className="auth-alert auth-alert--ok">
                Check your inbox for the reset link. It expires after a short time.
              </div>
            )}

            <button type="button" className="auth-back-link" onClick={() => switchMode("login")}>
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-shell__inner">
        <div className="auth-card">
          <header className={`auth-card__header${mode === "signup" ? " auth-card__header--signup" : ""}`}>
            <h1 className="auth-card__title">
              {mode === "login" ? "Welcome back" : "Create your account"}
            </h1>
            {mode === "login" && (
              <p className="auth-card__subtitle">Continue to your workspace</p>
            )}
          </header>

          <form
            key={mode === "login" ? `login-${loginFormKey}` : mode}
            noValidate
            method="post"
            action={mode === "login" ? `${BASE}/v1/auth/login` : `${BASE}/v1/auth/signup`}
            autoComplete={mode === "login" && !autofillEnabled ? "off" : mode === "login" ? "on" : "off"}
            onSubmit={submit}
          >
            {mode === "signup" && !inviteToken && (
              <div className="auth-field">
                <label htmlFor="organization" className="auth-field__label">
                  Organization name
                </label>
                <input
                  id="organization"
                  name="organization"
                  autoComplete="organization"
                  className="auth-field__input !px-3"
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                  required
                />
              </div>
            )}
            {mode === "signup" && inviteToken && (
              <p className="auth-invite-note">
                You&apos;re joining via workspace invite. Organization is set by your inviter.
              </p>
            )}

            <div className="auth-field">
              <label htmlFor="email" className="auth-field__label">
                Email address
              </label>
              <div className="auth-field__control">
                <span className="auth-field__icon" aria-hidden>
                  <IconMail />
                </span>
                {mode === "login" ? (
                  <input
                    ref={emailRef}
                    id="email"
                    name="email"
                    autoComplete={autofillEnabled ? "username" : "off"}
                    readOnly={!autofillEnabled}
                    className="auth-field__input"
                    type="email"
                    placeholder="Email Address"
                    defaultValue=""
                    required
                    onFocus={enableAutofill}
                  />
                ) : (
                  <input
                    id="email"
                    name="email"
                    autoComplete="email"
                    className="auth-field__input"
                    type="email"
                    placeholder="Email Address"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                )}
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="password" className="auth-field__label">
                Password
              </label>
              <div className="auth-field__control">
                <span className="auth-field__icon" aria-hidden>
                  <IconLock />
                </span>
                {mode === "login" ? (
                  <input
                    ref={passwordRef}
                    id="password"
                    name="password"
                    autoComplete={autofillEnabled ? "current-password" : "off"}
                    readOnly={!autofillEnabled}
                    className={`auth-field__input${passwordError ? " auth-field__input--error" : ""}`}
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    defaultValue=""
                    required
                    onFocus={enableAutofill}
                    onChange={() => setPasswordError(null)}
                  />
                ) : (
                  <input
                    id="password"
                    name="password"
                    autoComplete="new-password"
                    className={`auth-field__input${passwordError ? " auth-field__input--error" : ""}`}
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setPasswordError(null); }}
                    required
                  />
                )}
                <button
                  type="button"
                  className="auth-field__toggle"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword(v => !v)}
                >
                  <IconEye open={showPassword} />
                </button>
              </div>
              {passwordError ? (
                <p className="auth-field__error">{passwordError}</p>
              ) : mode === "signup" ? (
                <p className="auth-field__hint">At least 12 characters.</p>
              ) : null}
            </div>

            {mode === "login" && (
              <div className="auth-row-options">
                <label className="auth-remember">
                  <input
                    type="checkbox"
                    className="auth-remember__input"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                  />
                  <span className="auth-remember__pill">
                    <span className="auth-remember__mark" aria-hidden>
                      <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    </span>
                    Remember me
                  </span>
                </label>
                <div className="auth-row-link auth-row-link--flush">
                  <button type="button" onClick={() => switchMode("forgot")}>
                    Forgot password?
                  </button>
                </div>
              </div>
            )}

            {err && <div className="auth-alert">{err}</div>}

            {requestAccessEmail && (
              requestSent ? (
                <div className="auth-alert auth-alert--ok">
                  Request sent — an admin will review it and can invite you.
                </div>
              ) : (
                <button type="button" className="auth-request-access" onClick={requestAccess}>
                  Request access to this workspace
                </button>
              )
            )}

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? (
                "Please wait…"
              ) : mode === "login" ? (
                <>
                  <img src="/favicon.png" alt="" className="auth-submit__mark" aria-hidden />
                  Sign in to Vigil
                </>
              ) : (
                "Create account"
              )}
            </button>
          </form>

          <AuthOAuthButtons rememberMe={rememberMe} inviteToken={inviteToken} pickAccount={freshSignIn} />
          <AuthLegalFooter mode={mode} />

          <div className="auth-mode-switch">
            <button
              type="button"
              onClick={() => switchMode(mode === "login" ? "signup" : "login")}
            >
              {mode === "login" ? (
                <>Don&apos;t have an account? <span className="auth-mode-switch__cta">Sign up</span></>
              ) : (
                <>Already have an account? <span className="auth-mode-switch__cta">Sign in</span></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

