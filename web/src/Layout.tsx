import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, restoreSession, storeTokens, token } from "./api";
import { accountListSchema, workspaceListSchema } from "./lib/apiSchemas";
import { roleAtLeast, useMe } from "./hooks/useMe";
import { RecheckNotificationsProvider } from "./context/RecheckNotificationsContext";
import { HeaderSlotContext } from "./context/HeaderSlot";
import NotificationsBell from "./components/NotificationsBell";
import HelpMenu from "./components/HelpMenu";
import SidebarWorkspaceCard from "./components/SidebarWorkspaceCard";
import UserMenu from "./components/UserMenu";
import SidebarNavLink from "./components/SidebarNavLink";
import { WorkspaceSwitcher, type WorkspaceEntry } from "./components/WorkspaceSwitcher";
import { isAccountConnected } from "./lib/accountConnection";
import { pathRequiresConnectedAccount } from "./lib/postAuthRedirect";
import "./styles/sidebar.css";
import "./styles/user-menu.css";

/** Drop your logo at `public/brand/veritrail-mark.svg` (or .png). */
const SIDEBAR_LOGO_SRC = "/brand/veritrail-mark.png";

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
  const requiresAccount = pathRequiresConnectedAccount(location.pathname);
  const showWorkspaceSwitcher = location.pathname === "/accounts" || location.pathname === "/profile";
  const workspaceSwitcherTitle = location.pathname === "/profile" ? "Profile" : "Cloud accounts";

  const meQ = useMe();
  const canManageAccounts = roleAtLeast(meQ.data?.role, "admin");

  const workspacesQ = useQuery<WorkspaceEntry[]>({
    queryKey: ["workspaces"],
    queryFn: () => api("/v1/auth/workspaces", { schema: workspaceListSchema }),
    enabled: authReady && !!meQ.data && showWorkspaceSwitcher,
  });
  const switchWorkspace = useMutation({
    mutationFn: (orgId: string) =>
      api<{ access_token: string }>("/v1/auth/workspaces/switch", {
        method: "POST",
        body: JSON.stringify({ org_id: orgId }),
      }),
    onSuccess: (data) => {
      storeTokens(data.access_token);
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      window.location.reload();
    },
  });

  const planUsageQ = useQuery({
    queryKey: ["accounts-plan-usage"],
    queryFn: () =>
      api<{ plan_label: string }>("/v1/accounts/plan-usage"),
    enabled: authReady && !!meQ.data,
    staleTime: 60_000,
  });

  const accountsQ = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api("/v1/accounts", { schema: accountListSchema }),
    enabled: authReady,
    staleTime: 30_000,
  });

  const hasConnectedAccount =
    accountsQ.isSuccess && accountsQ.data.some((a) => isAccountConnected(a));

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
      <aside className="app-sidebar">
        <div className="app-sidebar__brand">
          <img src={SIDEBAR_LOGO_SRC} alt="" className="app-sidebar__logo" decoding="async" />
          <span className="app-sidebar__wordmark">Veritrail</span>
        </div>

        <nav className="app-sidebar__nav">
          {canManageAccounts && (
            <SidebarNavLink to="/accounts">
              <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
              </svg>
              Accounts
            </SidebarNavLink>
          )}

          <SidebarNavLink to="/findings">
            <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Findings
          </SidebarNavLink>

          <SidebarNavLink to="/controls">
            <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            Compliance
          </SidebarNavLink>

          <SidebarNavLink to="/history" title="Compliance timeline and infrastructure events">
            <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5a2.25 2.25 0 002.25-2.25m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
              />
            </svg>
            History
          </SidebarNavLink>

          {canManageAccounts && (
            <SidebarNavLink to="/integrations">
              <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7a2 2 0 012-2h2.5a2 2 0 011.6.8l.8 1.067a2 2 0 001.6.8H18a2 2 0 012 2V17a2 2 0 01-2 2H6a2 2 0 01-2-2V7z" />
              </svg>
              Integrations
            </SidebarNavLink>
          )}
        </nav>

        <div className="app-sidebar__footer">
          <SidebarWorkspaceCard
            orgName={meQ.data?.org_name ?? "Workspace"}
            planLabel={planUsageQ.data?.plan_label}
          />
        </div>
      </aside>

      <main className="veritrail-app-main relative ml-64 flex min-h-screen min-w-0 flex-col overflow-hidden">
        <RecheckNotificationsProvider key={meQ.data?.org_id ?? "no-org"} orgId={meQ.data?.org_id ?? null}>
          <div data-app-scroll className="relative z-10 flex flex-1 flex-col overflow-auto">
            {/* App-wide header bar: help + bell on the right, a left slot pages fill via <HeaderSlot>. */}
            <div className="veritrail-app-header sticky top-0 z-30 flex items-center gap-3 px-8 pt-5 pb-3 backdrop-blur-md">
              {showWorkspaceSwitcher && (
                <WorkspaceSwitcher
                  title={workspaceSwitcherTitle}
                  workspaces={workspacesQ.data ?? []}
                  currentOrgId={meQ.data?.org_id ?? ""}
                  onSwitch={(id) => switchWorkspace.mutate(id)}
                  pending={switchWorkspace.isPending}
                />
              )}
              <div ref={setHeaderSlot} className="flex min-w-0 flex-1 flex-wrap items-center gap-2" />
              <HelpMenu />
              <NotificationsBell />
              {meQ.data?.email ? <UserMenu email={meQ.data.email} /> : null}
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
