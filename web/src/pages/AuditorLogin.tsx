import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BASE, storeAuditorToken, clearAuditorToken } from "../api";

export default function AuditorLogin() {
  const { token } = useParams<{ token: string }>();
  const nav = useNavigate();
  const [status, setStatus] = useState<"verifying" | "error" | "success">("verifying");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setError("No access token provided.");
      setStatus("error");
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${BASE}/v1/auditor/verify/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Verification failed");
        }
        const data = (await res.json()) as {
          access_token: string;
          org_name: string;
          auditor_name: string | null;
          expires_at: string;
        };
        storeAuditorToken(data.access_token);
        setStatus("success");
        setTimeout(() => nav("/auditor/dashboard"), 600);
      } catch (e) {
        setError((e as Error).message);
        setStatus("error");
      }
    })();
  }, [token, nav]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        {status === "verifying" && (
          <div className="text-center">
            <svg className="mx-auto h-10 w-10 animate-spin text-sky-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <h2 className="mt-4 text-lg font-semibold text-zinc-900">Verifying access token…</h2>
          </div>
        )}
        {status === "success" && (
          <div className="text-center">
            <svg className="mx-auto h-12 w-12 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="mt-4 text-lg font-semibold text-zinc-900">Access verified</h2>
            <p className="mt-1 text-sm text-zinc-500">Redirecting to dashboard…</p>
          </div>
        )}
        {status === "error" && (
          <div className="text-center">
            <svg className="mx-auto h-12 w-12 text-red-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <h2 className="mt-4 text-lg font-semibold text-zinc-900">Verification failed</h2>
            <p className="mt-1 text-sm text-red-600">{error}</p>
            <button
              onClick={() => nav("/auditor/login")}
              className="mt-4 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
