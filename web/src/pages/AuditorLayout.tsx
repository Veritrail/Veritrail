import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { auditorToken, clearAuditorToken, auditorApi } from "../api";

const navItem = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
    isActive
      ? "bg-white/10 text-white shadow-sm ring-1 ring-white/5"
      : "text-slate-400 hover:bg-white/6 hover:text-slate-100"
  }`;

export default function AuditorLayout() {
  const nav = useNavigate();
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  useEffect(() => {
    if (!auditorToken()) {
      nav("/auditor/login");
      return;
    }
    // Fetch dashboard to get expiry info
    auditorApi<{ expires_at: string | null }>("/auditor/dashboard")
      .then((d) => setExpiresAt(d.expires_at))
      .catch(() => {
        clearAuditorToken();
        nav("/auditor/login");
      });
  }, [nav]);

  const expiryLabel = expiresAt
    ? (() => {
        const exp = new Date(expiresAt);
        const now = new Date();
        const days = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (days <= 0) return "Expired";
        if (days === 1) return "Expires tomorrow";
        return `Expires in ${days} days`;
      })()
    : null;

  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900">
      <aside
        className="w-60 flex-shrink-0 sticky top-0 h-screen flex flex-col overflow-y-auto"
        style={{
          background:
            "linear-gradient(160deg, #0f172a 0%, #0d1424 50%, #090e1a 100%)",
          borderRight: "1px solid rgba(56, 189, 248, 0.12)",
        }}
      >
        {/* Header with auditor badge */}
        <div className="px-3 py-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-3 px-4 py-2">
            <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{
                background: "linear-gradient(135deg, rgba(99,102,241,0.3), rgba(14,165,233,0.2))",
                boxShadow: "0 0 12px rgba(99,102,241,0.25)",
                border: "1px solid rgba(99,102,241,0.3)",
              }}>
              <img src="/favicon.png" alt="Vigil" className="h-6 w-6 object-contain" />
            </div>
            <div>
              <span className="text-base font-semibold text-white">Vigil</span>
              <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                AUDITOR
              </span>
            </div>
          </div>
          {expiryLabel && (
            <p className="mt-2 px-4 text-[11px] text-slate-500">{expiryLabel}</p>
          )}
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1">
          <NavLink to="/auditor/dashboard" className={navItem}>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
            Dashboard
          </NavLink>

          <NavLink to="/auditor/findings" className={navItem}>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Findings
          </NavLink>

          <NavLink to="/auditor/controls" className={navItem}>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            Compliance
          </NavLink>

          <NavLink to="/auditor/evidence" className={navItem}>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            Evidence
          </NavLink>

          <NavLink to="/auditor/export" className={navItem}>
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Export Pack
          </NavLink>
        </nav>

        <div className="px-3 py-5" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button
            onClick={() => {
              clearAuditorToken();
              nav("/auditor/login");
            }}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition-all hover:bg-white/6 hover:text-slate-100"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Exit Auditor View
          </button>
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-auto">
        <div className="flex-1 px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
