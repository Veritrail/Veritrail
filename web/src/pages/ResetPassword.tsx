import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, formatApiError } from "../api";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    if (next !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await api("/v1/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token, new_password: next }),
      });
      setDone(true);
      setTimeout(() => navigate("/login"), 1800);
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <img src="/favicon.png" alt="Veritrail" className="w-12 h-12 object-contain" />
          <span className="text-white text-xl font-semibold tracking-tight">Veritrail</span>
        </div>
        <div className="rounded-2xl bg-white p-8 shadow-2xl shadow-black/25">
          {!token ? (
            <>
              <h1 className="text-lg font-semibold text-zinc-900 mb-1">Invalid reset link</h1>
              <p className="text-sm text-zinc-500">
                This link is missing or malformed. Request a new one from the sign-in page.
              </p>
              <button
                onClick={() => navigate("/login")}
                className="mt-5 w-full rounded-lg bg-zinc-900 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800"
              >
                Back to sign in
              </button>
            </>
          ) : done ? (
            <>
              <h1 className="text-lg font-semibold text-zinc-900 mb-1">Password updated</h1>
              <p className="text-sm text-zinc-500">
                You can now sign in with your new password. Redirecting…
              </p>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-zinc-900 mb-1">Choose a new password</h1>
              <p className="mb-5 text-sm text-zinc-500">Enter a new password for your account.</p>
              <form noValidate onSubmit={submit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-700">New password</label>
                  <input
                    type="password"
                    autoFocus
                    value={next}
                    onChange={(e) => {
                      setNext(e.target.value);
                      setError(null);
                    }}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                  <p className="mt-1.5 text-xs text-zinc-400">At least 12 characters.</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-700">Confirm new password</label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => {
                      setConfirm(e.target.value);
                      setError(null);
                    }}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-zinc-900"
                  />
                </div>
                {error && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600">{error}</p>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-zinc-900 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60"
                >
                  {submitting ? "Updating…" : "Update password"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
