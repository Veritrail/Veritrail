import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, restoreSession, token, logout } from "./api";
import { accountListSchema, complianceTimelineSchema } from "./lib/apiSchemas";
import { roleAtLeast, useMe } from "./hooks/useMe";
import { NO_WORKSPACE_PATH } from "./lib/postAuthRedirect";
import { RecheckNotificationsProvider } from "./context/RecheckNotificationsContext";
import { HeaderSlotContext } from "./context/HeaderSlot";
import NotificationsBell from "./components/NotificationsBell";
import HelpMenu from "./components/HelpMenu";
import SidebarUserCard from "./components/SidebarUserCard";
import { useAccountsPlanUsage } from "./hooks/useAccountsPlanUsage";
import SidebarNavLink from "./components/SidebarNavLink";
import { isAccountConnected } from "./lib/accountConnection";
import { pathRequiresConnectedAccount } from "./lib/postAuthRedirect";
import { catalogEntryByKey } from "./lib/integrationCatalog";
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

/** Section title shown in the app header, keyed by first path segment. */
const HEADER_TITLES: Record<string, string> = {
  dashboard: "Dashboard",
  accounts: "Accounts",
  findings: "Findings",
  controls: "Compliance",
  history: "History",
  integrations: "Integrations",
  workspace: "Workspace",
  profile: "Profile",
  reference: "Reference",
};

const DEFAULT_HISTORY_FRAMEWORK = "soc2";
const DEFAULT_HISTORY_DAYS = 90;
const HISTORY_PREFETCH_STALE_MS = 120_000;

/** Child page labels under /integrations/* (hub uses plain title). */
const INTEGRATION_SUBPAGE_LABELS: Record<string, string> = {
  catalog: "Workflow integrations",
  github: "GitHub",
  gitlab: "GitLab",
  "google-workspace": "Google Workspace",
  entra: "Microsoft Entra ID",
  slack: "Slack",
  jira: "Jira",
  gcp: "Google Cloud",
  azure: "Microsoft Azure",
  okta: "Okta",
  intune: "Microsoft Intune",
  jamf: "Jamf Pro",
  "github-issues": "GitHub Issues",
  "iac-repository": "IaC repository",
};

function formatHeaderSlug(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function integrationSubpageLabel(pathname: string): string | null {
  if (pathname === "/integrations" || pathname === "/integrations/") return null;

  const scannerMatch = pathname.match(/^\/integrations\/scanners\/([^/]+)/);
  if (scannerMatch) {
    return catalogEntryByKey(scannerMatch[1])?.name ?? formatHeaderSlug(scannerMatch[1]);
  }

  const siemMatch = pathname.match(/^\/integrations\/siem\/([^/]+)/);
  if (siemMatch) {
    return catalogEntryByKey(siemMatch[1])?.name ?? formatHeaderSlug(siemMatch[1]);
  }

  const segment = pathname.replace(/^\/integrations\/?/, "").split("/")[0];
  if (!segment) return null;

  return INTEGRATION_SUBPAGE_LABELS[segment] ?? formatHeaderSlug(segment);
}

function AppHeaderBreadcrumb({
  parentTo,
  parentLabel,
  current,
}: {
  parentTo: string;
  parentLabel: string;
  current: string;
}) {
  return (
    <nav className="veritrail-app-header__breadcrumb" aria-label="Breadcrumb">
      <Link to={parentTo} className="veritrail-app-header__breadcrumb-link">
        {parentLabel}
      </Link>
      <span className="veritrail-app-header__breadcrumb-sep" aria-hidden="true">
        ›
      </span>
      <span className="veritrail-app-header__breadcrumb-current">{current}</span>
    </nav>
  );
}

function AppHeaderTitle({ pathname }: { pathname: string }) {
  const integrationChild = integrationSubpageLabel(pathname);
  if (integrationChild) {
    return (
      <AppHeaderBreadcrumb
        parentTo="/integrations"
        parentLabel="Integrations"
        current={integrationChild}
      />
    );
  }

  const segment = pathname.split("/")[1];
  const title = segment ? HEADER_TITLES[segment] : undefined;
  if (!title) return null;

  return <h1 className="veritrail-app-header__title">{title}</h1>;
}

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
  const planUsageQ = useAccountsPlanUsage();
  const canManageAccounts = roleAtLeast(meQ.data?.role, "admin");

  const accountsQ = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api("/v1/accounts", { schema: accountListSchema }),
    enabled: authReady,
    staleTime: 30_000,
  });

  const hasConnectedAccount =
    accountsQ.isSuccess && accountsQ.data.some((a) => isAccountConnected(a));

  const signOutAndLogin = () => {
    void logout().finally(() => {
      window.location.href = "/login";
    });
  };

  useEffect(() => {
    window.localStorage.setItem("veritrail-sidebar-collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (token()) {
          if (!cancelled) setAuthReady(true);
          return;
        }
        const ok = await restoreSession();
        if (cancelled) return;
        if (!ok) nav("/login");
        else setAuthReady(true);
      } catch {
        if (!cancelled) nav("/login");
      }
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
          { schema: complianceTimelineSchema },
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

  if (meQ.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-500">
        Loading…
      </div>
    );
  }

  if (meQ.isSuccess && meQ.data.has_workspace === false) {
    return <Navigate to={NO_WORKSPACE_PATH} replace />;
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
            <SidebarUserCard
              email={meQ.data.email}
              displayName={meQ.data.display_name}
              orgName={meQ.data.org_name ?? "Workspace"}
              role={meQ.data.role}
              planLabel={planUsageQ.data?.plan_label}
              used={planUsageQ.data?.used ?? 0}
              maxAccounts={planUsageQ.data?.max_accounts ?? null}
              planLoading={planUsageQ.isLoading && !planUsageQ.data}
            />
          ) : meQ.isError ? (
            <div className="app-sidebar__user">
              <button
                type="button"
                className="app-sidebar__workspace-card text-left"
                onClick={signOutAndLogin}
              >
                <span className="app-sidebar__workspace-copy">
                  <span className="app-sidebar__workspace-name">Session expired</span>
                  <span className="app-sidebar__workspace-org">Sign in again</span>
                </span>
              </button>
            </div>
          ) : null}

          <div className="app-sidebar__footer-divider" role="separator" />

          <button
            type="button"
            className="app-sidebar__collapse-row"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={sidebarCollapsed}
            onClick={() => setSidebarCollapsed((v) => !v)}
          >
            <span className="app-sidebar__collapse-icon-btn" aria-hidden>
              <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d={
                    sidebarCollapsed
                      ? "M8.25 4.5l7.5 7.5-7.5 7.5"
                      : "M15.75 19.5L8.25 12l7.5-7.5"
                  }
                />
              </svg>
            </span>
            <span className="app-sidebar__collapse-label">
              {sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            </span>
          </button>
        </div>
      </aside>

      <main
        className={`veritrail-app-main relative flex min-h-screen min-w-0 flex-col overflow-hidden transition-[margin-left,width] duration-200 ease-out ${sidebarCollapsed ? "ml-24 w-[calc(100%-6rem)]" : "ml-80 w-[calc(100%-20rem)]"}`}
      >
        <RecheckNotificationsProvider key={meQ.data?.org_id ?? "no-org"} orgId={meQ.data?.org_id ?? null}>
          <div data-app-scroll className="relative z-10 flex flex-1 flex-col overflow-auto">
            {/* App-wide header bar: section title + a left slot pages fill via <HeaderSlot>, help + bell on the right. */}
            <div className="veritrail-app-header sticky top-0 z-30 flex flex-nowrap items-center gap-4 px-8 py-3">
              <AppHeaderTitle pathname={location.pathname} />
              <div ref={setHeaderSlot} className="flex min-w-0 flex-1 flex-wrap items-center gap-2" />
              <div className="veritrail-app-header__utilities">
                <HelpMenu />
                <NotificationsBell />
              </div>
            </div>
            <HeaderSlotContext.Provider value={headerSlot}>
              {/* flex-1 so short pages fill the viewport — lets pages pin
                  bottom content (e.g. Integrations "Explore") to the bottom
                  without leaving a scroll. */}
              <div className="veritrail-app-content flex w-full min-w-0 flex-1 flex-col px-8 pb-8">
                <Outlet />
              </div>
            </HeaderSlotContext.Provider>
          </div>
        </RecheckNotificationsProvider>
      </main>
    </div>
  );
}
