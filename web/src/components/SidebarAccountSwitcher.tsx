import { Link, useLocation, useNavigate } from "react-router-dom";
import { ProviderMark } from "./AccountSelect";
import {
  useConnectedAccountOptions,
  type ConnectedAccountOption,
} from "../hooks/useConnectedAccountOptions";
import { useSelectedAccountId } from "../hooks/useSelectedAccountId";

const SIDEBAR_ACCOUNT_CAP = 6;

function SidebarAccountCard({
  account,
  selected,
  collapsed,
  onSelect,
}: {
  account: ConnectedAccountOption;
  selected: boolean;
  collapsed: boolean;
  onSelect: () => void;
}) {
  const displayId = account.account_id?.trim() || "—";
  const provider = account.provider ?? "aws";

  return (
    <button
      type="button"
      className={`sidebar-account-card${selected ? " is-selected" : ""}${collapsed ? " is-collapsed" : ""}`}
      onClick={onSelect}
      title={collapsed ? `${account.label ?? "Account"} · ${displayId}` : undefined}
      aria-pressed={selected}
    >
      <span className="sidebar-account-card__logo" aria-hidden>
        <ProviderMark provider={provider} variant="compact" className="sidebar-account-card__provider-mark" />
      </span>
      {!collapsed ? (
        <>
          <span className="sidebar-account-card__copy">
            <span className="sidebar-account-card__name">{account.label ?? "Account"}</span>
            <span className="sidebar-account-card__id">{displayId}</span>
          </span>
          <span
            className={`sidebar-account-card__indicator${selected ? " is-selected" : ""}`}
            aria-hidden
          >
            {selected ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />
              </svg>
            ) : null}
          </span>
        </>
      ) : null}
    </button>
  );
}

export default function SidebarAccountSwitcher({
  collapsed,
  canManageAccounts,
}: {
  collapsed: boolean;
  canManageAccounts: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { options, isSuccess } = useConnectedAccountOptions();
  const onAccountsPage = location.pathname === "/accounts";
  const accountsSearch = new URLSearchParams(location.search);
  const allAccountsView = onAccountsPage && accountsSearch.get("view") === "all";
  // Bare `/accounts` is the org readiness home: unscoped, no card selected, and the
  // hook must not write a persisted account_id back into the URL.
  const orgHomeView =
    onAccountsPage &&
    !allAccountsView &&
    !accountsSearch.get("account_id") &&
    !accountsSearch.get("account");
  const { accountId, setAccountId } = useSelectedAccountId(options, isSuccess, {
    disableUrlSync: orgHomeView,
  });

  if (!canManageAccounts || !isSuccess || options.length === 0) return null;

  // Pin the selected account into the visible slice — with 7+ accounts a plain
  // slice could hide the account the user is actually working in.
  const visible = options.slice(0, SIDEBAR_ACCOUNT_CAP);
  const selectedIdx = options.findIndex((o) => o.id === accountId);
  if (selectedIdx >= SIDEBAR_ACCOUNT_CAP) {
    visible[SIDEBAR_ACCOUNT_CAP - 1] = options[selectedIdx];
  }

  const selectAccount = (id: string) => {
    // Leave management view (`view=all`) when picking from the sidebar — main area is the dashboard.
    if (allAccountsView) {
      navigate(`/accounts?account_id=${encodeURIComponent(id)}`);
      return;
    }
    setAccountId(id);
  };

  return (
    <div className={`sidebar-accounts${collapsed ? " is-collapsed" : ""}`}>
      {!collapsed ? (
        <div className="sidebar-accounts__head">
          <span className="sidebar-accounts__label">ACCOUNTS</span>
          <Link to="/accounts?view=all" className="sidebar-accounts__add">
            + Add account
          </Link>
        </div>
      ) : null}

      <div className="sidebar-accounts__cards">
        {visible.map((account) => (
          <SidebarAccountCard
            key={account.id}
            account={account}
            selected={!allAccountsView && !orgHomeView && accountId === account.id}
            collapsed={collapsed}
            onSelect={() => selectAccount(account.id)}
          />
        ))}
      </div>

      {/* Hide account-count circle in collapsed mini rail (reads as a badge). */}
      {!collapsed ? (
        <Link
          to="/accounts?view=all"
          className={`sidebar-accounts__overflow${allAccountsView ? " is-active" : ""}`}
        >
          All accounts ({options.length})
        </Link>
      ) : null}
    </div>
  );
}
