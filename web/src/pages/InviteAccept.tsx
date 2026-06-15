import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { publicApi } from "../api";

type InvitePreview = {
  org_name: string;
  email: string;
  role: string;
  expires_at: string;
};

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const nav = useNavigate();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setError("Invalid invite link.");
      setStatus("error");
      return;
    }
    void (async () => {
      try {
        const data = await publicApi<InvitePreview>(`/v1/members/invites/preview/${token}`);
        setPreview(data);
        setStatus("ready");
      } catch (e) {
        setError((e as Error).message);
        setStatus("error");
      }
    })();
  }, [token]);

  const signupUrl = `/login?mode=signup&invite_token=${encodeURIComponent(token ?? "")}&email=${encodeURIComponent(preview?.email ?? "")}`;
  const loginUrl = `/login?invite_token=${encodeURIComponent(token ?? "")}&email=${encodeURIComponent(preview?.email ?? "")}`;

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
                {new Date(preview.expires_at).toLocaleDateString()}
              </p>
            </div>
            <div className="mt-6 space-y-3">
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
