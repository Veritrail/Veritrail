import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, publicApi, restoreSession, storeTokens, token as accessToken, BASE } from "../api";
import { postAuthPath } from "../lib/postAuthRedirect";

const PENDING_INVITE_KEY = "vigil_pending_invite_token";

type InvitePreview = {
  org_name: string;
  email: string;
  role: string;
  expires_at: string | null;
};

export default function InviteAccept() {
  const { token: inviteToken } = useParams<{ token: string }>();
  const nav = useNavigate();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [accepting, setAccepting] = useState(false);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState("");
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!inviteToken) {
      setError("Invalid invite link.");
      setStatus("error");
      return;
    }
    void (async () => {
      try {
        const data = await publicApi<InvitePreview>(`/v1/members/invites/preview/${inviteToken}`);
        setPreview(data);
        sessionStorage.setItem(PENDING_INVITE_KEY, inviteToken);
        if (await restoreSession()) {
          try {
            const me = await api<{ email: string }>("/v1/auth/me");
            setSignedInEmail(me.email);
          } catch {
            setSignedInEmail(null);
          }
        }
        setStatus("ready");
      } catch (e) {
        setError((e as Error).message);
        setStatus("error");
      }
    })();
  }, [inviteToken]);

  async function acceptInvite() {
    if (!inviteToken) return;
    setAccepting(true);
    setError("");
    try {
      if (!accessToken()) {
        const ok = await restoreSession();
        if (!ok) throw new Error("Sign in first, then return to this invite link.");
      }
      const res = await api<{ access_token: string }>("/v1/members/invites/accept", {
        method: "POST",
        body: JSON.stringify({ token: inviteToken }),
      });
      sessionStorage.removeItem(PENDING_INVITE_KEY);
      storeTokens(res.access_token);
      nav(await postAuthPath(), { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setAccepting(false);
    }
  }

  const signupUrl = `/login?mode=signup&invite_token=${encodeURIComponent(inviteToken ?? "")}&email=${encodeURIComponent(preview?.email ?? "")}`;
  const loginUrl = `/login?mode=login&invite_token=${encodeURIComponent(inviteToken ?? "")}&email=${encodeURIComponent(preview?.email ?? "")}`;
  const inviteEmail = preview?.email?.toLowerCase() ?? "";
  const canAcceptNow = Boolean(signedInEmail && inviteEmail && signedInEmail.toLowerCase() === inviteEmail);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-900 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl shadow-black/25">
        {status === "loading" && (
          <div className="text-center text-sm text-zinc-500">Loading invite…</div>
        )}

        {status === "error" && (
          <div className="text-center">
            <h1 className="text-lg font-semibold text-zinc-900">Invite unavailable</h1>
            <p className="mt-2 text-sm text-red-600">{error}</p>
            <button
              onClick={() => nav("/login")}
              className="mt-6 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              Go to sign in
            </button>
          </div>
        )}

        {status === "ready" && preview && (
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">Join {preview.org_name}</h1>
            <p className="mt-2 text-sm text-zinc-600">
              You&apos;ve been invited as <span className="font-medium capitalize">{preview.role}</span>.
            </p>
            <div className="mt-4 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-700">
              <p>
                <span className="text-zinc-500">Email:</span> {preview.email}
              </p>
              <p className="mt-1">
                <span className="text-zinc-500">Expires:</span>{" "}
                {preview.expires_at ? new Date(preview.expires_at).toLocaleDateString() : "Never"}
              </p>
            </div>
            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
            <div className="mt-6 space-y-3">
              {canAcceptNow ? (
                <button
                  type="button"
                  onClick={() => void acceptInvite()}
                  disabled={accepting}
                  className="block w-full rounded-lg bg-zinc-900 py-2.5 text-center text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
                >
                  {accepting ? "Joining…" : `Join as ${signedInEmail}`}
                </button>
              ) : signedInEmail && inviteEmail && signedInEmail.toLowerCase() !== inviteEmail ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                  Signed in as <span className="font-medium">{signedInEmail}</span>. Sign out and sign in as{" "}
                  <span className="font-medium">{preview.email}</span> to accept this invite.
                </p>
              ) : null}
              <Link
                to={signupUrl}
                className="block w-full rounded-lg bg-zinc-900 py-2.5 text-center text-sm font-semibold text-white hover:bg-zinc-800"
              >
                Create account
              </Link>
              <Link
                to={loginUrl}
                className="block w-full rounded-lg border border-zinc-200 py-2.5 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Sign in with existing account
              </Link>
              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-zinc-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-2 text-zinc-400">or continue with</span>
                </div>
              </div>
              <a
                href={`${BASE}/v1/auth/google?invite_token=${encodeURIComponent(inviteToken ?? "")}`}
                className="block w-full rounded-lg border border-zinc-200 py-2.5 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Google
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
