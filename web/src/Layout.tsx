import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, restoreSession, token } from "./api";
import { accountListSchema } from "./lib/apiSchemas";
import { roleAtLeast, useMe } from "./hooks/useMe";
import { RecheckNotificationsProvider } from "./context/RecheckNotificationsContext";
import { HeaderSlotContext } from "./context/HeaderSlot";
import NotificationsBell from "./components/NotificationsBell";
import HelpMenu from "./components/HelpMenu";
import SidebarUserCard from "./components/SidebarUserCard";
import SidebarNavLink from "./components/SidebarNavLink";
import { isAccountConnected } from "./lib/accountConnection";
import { pathRequiresConnectedAccount } from "./lib/postAuthRedirect";
import "./styles/sidebar.css";
import "./styles/user-menu.css";

/** Brand logo lives at `public/brand/veritrail-mark.png`. */
const SIDEBAR_LOGO_SRC = "/brand/veritrail-mark.png";

type SidebarIconName = "accounts" | "findings" | "compliance" | "history" | "integrations" | "workspace";
type SidebarIconStyle = CSSProperties & { "--sidebar-icon-url": string };

const SIDEBAR_ICONS: Record<SidebarIconName, string> = {
  accounts: "/icons/sidebar/veritrail-icon-accounts-line.png",
  findings: "/icons/sidebar/veritrail-icon-findings-line.png",
  compliance: "/icons/sidebar/veritrail-icon-compliance-line.png",
  history: "/icons/sidebar/veritrail-icon-history-line.png",
  integrations: "/icons/sidebar/veritrail-icon-integrations-line.png",
  workspace: "/icons/sidebar/veritrail-icon-workspace-line.png",
};

function SidebarIcon({ name }: { name: SidebarIconName }) {
  const style: SidebarIconStyle = { "--sidebar-icon-url": `url(${SIDEBAR_ICONS[name]})` };
  return <span className="app-sidebar__icon" style={style} aria-hidden />;
}

type AccountRow = { status: string; account_id: string | null };

const DEFAULT_HISTORY_FRAMEWORK = "soc2";
const DEFAULT_HISTORY_DAYS = 90;
const HISTORY_PREFETCH_STALE_MS = 120_000;

export default function Layout() {
  const nav = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [authReady, setAuthReady] = useState(false);
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("veritrail-sidebar-collapsed") === "1";
  });
  const requiresAccount = pathRequiresConnectedAccount(location.pathname);

  const meQ = useMe();
  const canManageAccounts = roleAtLeast(meQ.data?.role, "admin");

  const accountsQ = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api("/v1/accounts", { schema: accountListSchema }),
    enabled: authReady,
    staleTime: 30_000,
  });

  const hasConnectedAccount =
    accountsQ.isSuccess && accountsQ.data.some((a) => isAccountConnected(a));

  useEffect(() => {
    window.localStorage.setItem("veritrail-sidebar-collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (token()) {
        if (!cancelled) setAuthReady(true);
        return;
      }
      const ok = await restoreSession();
      if (cancelled) return;
      if (!ok) nav("/login");
      else setAuthReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [nav]);

  useEffect(() => {
    if (!accountsQ.isSuccess) return;
    const account = accountsQ.data.find((a) => isAccountConnected(a));
    if (!account?.id) return;

    void queryClient.prefetchQuery({
      queryKey: ["history", account.id, DEFAULT_HISTORY_FRAMEWORK, DEFAULT_HISTORY_DAYS],
      queryFn: () =>
        api(
          `/v1/accounts/${account.id}/compliance-timeline?framework=${DEFAULT_HISTORY_FRAMEWORK}&days=${DEFAULT_HISTORY_DAYS}&limit=100`,
        ),
      staleTime: HISTORY_PREFETCH_STALE_MS,
    });
  }, [accountsQ.data, accountsQ.isSuccess, queryClient]);

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-500">
        Loading…
      </div>
    );
  }

  if (requiresAccount) {
    if (accountsQ.isLoading) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-500">
          Loading…
        </div>
      );
    }
    if (accountsQ.isSuccess && !hasConnectedAccount) {
      return <Navigate to="/accounts" replace />;
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F8FB] text-[#111827]">
      <aside className={`app-sidebar${sidebarCollapsed ? " is-collapsed" : ""}`}>
        <div className="app-sidebar__brand">
          <img src={SIDEBAR_LOGO_SRC} alt="" className="app-sidebar__logo" decoding="async" />
          <span className="app-sidebar__wordmark">Veritrail</span>
        </div>

        <button
          type="button"
          className="app-sidebar__collapse-toggle"
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={sidebarCollapsed}
          onClick={() => setSidebarCollapsed((v) => !v)}
        >
          <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d={sidebarCollapsed ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} />
          </svg>
        </button>

        <nav className="app-sidebar__nav">
          {canManageAccounts && (
            <SidebarNavLink to="/accounts" title="Accounts">
              <SidebarIcon name="accounts" />
              <span className="app-sidebar__label">Accounts</span>
            </SidebarNavLink>
          )}

          <SidebarNavLink to="/findings" title="Findings">
            <SidebarIcon name="findings" />
            <span className="app-sidebar__label">Findings</span>
          </SidebarNavLink>

          <SidebarNavLink to="/controls" title="Compliance">
            <SidebarIcon name="compliance" />
            <span className="app-sidebar__label">Compliance</span>
          </SidebarNavLink>

          <SidebarNavLink to="/history" title="History">
            <SidebarIcon name="history" />
            <span className="app-sidebar__label">History</span>
          </SidebarNavLink>

          {canManageAccounts && (
            <SidebarNavLink to="/integrations" title="Integrations">
              <SidebarIcon name="integrations" />
              <span className="app-sidebar__label">Integrations</span>
            </SidebarNavLink>
          )}

          <SidebarNavLink to="/workspace" title="Workspace">
            <SidebarIcon name="workspace" />
            <span className="app-sidebar__label">Workspace</span>
          </SidebarNavLink>
        </nav>

        <div className="app-sidebar__footer">
          {meQ.data?.email ? (
            <SidebarUserCard email={meQ.data.email} orgName={meQ.data.org_name ?? "Workspace"} />
          ) : null}
        </div>
      </aside>

      <main
        className={`veritrail-app-main relative flex min-h-screen min-w-0 flex-col overflow-hidden transition-[margin-left,width] duration-200 ease-out ${sidebarCollapsed ? "ml-24 w-[calc(100%-6rem)]" : "ml-80 w-[calc(100%-20rem)]"}`}
      >
        <RecheckNotificationsProvider key={meQ.data?.org_id ?? "no-org"} orgId={meQ.data?.org_id ?? null}>
          <div data-app-scroll className="relative z-10 flex flex-1 flex-col overflow-auto">
            {/* App-wide header bar: help + bell on the right, a left slot pages fill via <HeaderSlot>. */}
            <div className="veritrail-app-header sticky top-0 z-30 flex items-center gap-3 px-8 pt-5 pb-3 backdrop-blur-md">
              <div ref={setHeaderSlot} className="flex min-w-0 flex-1 flex-wrap items-center gap-2" />
              <HelpMenu />
              <NotificationsBell />
            </div>
            <HeaderSlotContext.Provider value={headerSlot}>
              {/* flex-1 so short pages fill the viewport — lets pages pin
                  bottom content (e.g. Integrations "Explore") to the bottom
                  without leaving a scroll. */}
              <div className="flex w-full min-w-0 flex-1 flex-col px-8 pb-8">
                <Outlet />
              </div>
            </HeaderSlotContext.Provider>
          </div>
        </RecheckNotificationsProvider>
      </main>
    </div>
  );
}
