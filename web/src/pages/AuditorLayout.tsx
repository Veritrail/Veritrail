import { Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { auditorToken, clearAuditorToken, auditorApi } from "../api";
import { AuditorAsOfProvider, AuditorAsOfBar } from "../components/AuditorAsOf";
import SidebarNavLink from "../components/SidebarNavLink";
import "../styles/sidebar.css";

const SIDEBAR_LOGO_SRC = "/brand/veritrail-mark.png";

export default function AuditorLayout() {
  const nav = useNavigate();
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  useEffect(() => {
    if (!auditorToken()) {
      nav("/auditor/login");
      return;
    }
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
    <AuditorAsOfProvider>
      <div className="flex min-h-screen bg-zinc-50 text-zinc-900">
        <aside className="app-sidebar app-sidebar--inline">
          <div className="app-sidebar__brand">
            <img src={SIDEBAR_LOGO_SRC} alt="" className="app-sidebar__logo" decoding="async" />
            <div className="app-sidebar__brand-meta">
              <span className="app-sidebar__wordmark">Veritrail</span>
              <span className="app-sidebar__auditor-badge">AUDITOR</span>
              {expiryLabel ? <p className="app-sidebar__expiry">{expiryLabel}</p> : null}
            </div>
          </div>

          <nav className="app-sidebar__nav">
            <SidebarNavLink to="/auditor/dashboard">
              <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
              Dashboard
            </SidebarNavLink>

            <SidebarNavLink to="/auditor/findings">
              <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Findings
            </SidebarNavLink>

            <SidebarNavLink to="/auditor/controls">
              <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              Compliance
            </SidebarNavLink>

            <SidebarNavLink to="/auditor/evidence">
              <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              Evidence
            </SidebarNavLink>

            <SidebarNavLink to="/auditor/export">
              <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Export Pack
            </SidebarNavLink>
          </nav>

          <div className="app-sidebar__footer">
            <button
              type="button"
              onClick={() => {
                clearAuditorToken();
                nav("/auditor/login");
              }}
              className="app-sidebar__button"
            >
              <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Exit Auditor View
            </button>
          </div>
        </aside>

        <main className="flex flex-1 flex-col overflow-auto">
          <AuditorAsOfBar />
          <div className="flex-1 px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </AuditorAsOfProvider>
  );
}
