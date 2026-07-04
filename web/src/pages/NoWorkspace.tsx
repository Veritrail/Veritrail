import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, logout, PENDING_INVITE_KEY } from "../api";
import { meSchema } from "../lib/apiSchemas";
import "../styles/login-auth.css";

export default function NoWorkspace() {
  const [email, setEmail] = useState<string | null>(null);
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const me = await api("/v1/auth/me", { schema: meSchema });
        if (me.has_workspace) {
          window.location.replace("/accounts");
          return;
        }
        setEmail(me.email);
      } catch {
        window.location.replace("/login?error=session_expired");
        return;
      } finally {
        setLoading(false);
      }
    })();
    setPendingInvite(sessionStorage.getItem(PENDING_INVITE_KEY));
  }, []);

  async function requestAccess() {
    if (!email) return;
    try {
      await api("/v1/join-requests", { method: "POST", body: JSON.stringify({ email }) });
    } catch {
      /* endpoint always responds generically */
    }
    setRequestSent(true);
  }

  function signOut() {
    void logout().finally(() => {
      window.location.href = "/login?signed_out=1";
    });
  }

  if (loading) {
    return (
      <div className="auth-shell">
        <div className="auth-shell__inner text-center text-sm text-zinc-400">Loading…</div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-shell__inner">
        <div className="auth-card">
          <header className="auth-card__header">
            <h1 className="auth-card__title">No workspace access</h1>
            <p className="auth-card__subtitle">
              You haven&apos;t been invited to a workspace yet. Contact your admin or check your invite email.
            </p>
          </header>

          {email && (
            <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-700">
              Signed in as <span className="font-medium">{email}</span>
            </div>
          )}

          <div className="mt-6 space-y-3">
            {pendingInvite ? (
              <Link
                to={`/invite/${pendingInvite}`}
                className="block w-full rounded-lg bg-zinc-900 py-2.5 text-center text-sm font-semibold text-white hover:bg-zinc-800"
              >
                Open your workspace invite
              </Link>
            ) : requestSent ? (
              <div className="auth-alert auth-alert--ok">
                Request sent — if a workspace exists for your email domain, its admins have been notified.
              </div>
            ) : (
              <button type="button" className="auth-request-access w-full" onClick={() => void requestAccess()}>
                Request access to a workspace
              </button>
            )}

            <button
              type="button"
              onClick={signOut}
              className="block w-full rounded-lg border border-zinc-200 py-2.5 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
