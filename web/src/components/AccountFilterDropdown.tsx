import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  accountDisplayName,
  accountDisplaySubtitle,
  ProviderMark,
  type AccountOption,
} from "./AccountSelect";
import "../styles/history-page.css";

type MenuPosition = { top: number; left: number; minWidth: number };

function FilterChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`account-filter__chevron${open ? " account-filter__chevron--open" : ""}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}

function accountMatchesQuery(account: AccountOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    account.label,
    account.account_id,
    accountDisplayName(account),
    accountDisplaySubtitle(account),
    account.provider,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

/**
 * Account picker for Findings / Compliance — list rows aligned with Accounts page
 * mock (left-bar selection, provider logos, account IDs, search, footer links).
 */
export function AccountFilterDropdown({
  accounts,
  value,
  onChange,
}: {
  accounts: AccountOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const current = accounts.find((a) => a.id === value) ?? accounts[0];
  const filtered = useMemo(
    () => accounts.filter((a) => accountMatchesQuery(a, search)),
    [accounts, search],
  );

  const updateMenuPosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom,
      left: rect.left,
      minWidth: Math.max(rect.width, 360),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPosition();
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onScrollOrResize() {
      updateMenuPosition();
    }
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (accounts.length === 0 || !current) return null;

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label="Accounts"
            className="account-filter-menu"
            style={{ top: menuPos.top, left: menuPos.left, minWidth: menuPos.minWidth }}
          >
            <div className="account-filter-menu__header">
              <p className="account-filter-menu__heading">Accounts</p>
              <Link
                to="/accounts"
                className="account-filter-menu__header-action"
                aria-label="Manage accounts"
                onClick={() => setOpen(false)}
              >
                <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"
                  />
                </svg>
              </Link>
            </div>

            <label className="account-filter-menu__search">
              <span className="sr-only">Search accounts</span>
              <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m21 21-4.35-4.35M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"
                />
              </svg>
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search accounts…"
                aria-label="Search accounts"
              />
            </label>

            <div className="account-filter-menu__list">
              {filtered.length === 0 ? (
                <p className="account-filter-menu__empty">No accounts match your search.</p>
              ) : (
                filtered.map((account) => {
                  const active = account.id === value;
                  return (
                    <button
                      key={account.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        onChange(account.id);
                        setOpen(false);
                      }}
                      className={`account-filter-card${active ? " account-filter-card--selected" : ""}`}
                    >
                      <span className="account-filter-card__icon-box">
                        <ProviderMark provider={account.provider} className="account-filter-card__provider" />
                      </span>
                      <span className="account-filter-card__text">
                        <span className="account-filter-card__name">{accountDisplayName(account)}</span>
                        <span className="account-filter-card__meta">{accountDisplaySubtitle(account)}</span>
                      </span>
                      <span className="account-filter-card__indicator" aria-hidden>
                        {active ? (
                          <svg viewBox="0 0 20 20" fill="none" aria-hidden>
                            <circle cx="10" cy="10" r="9" fill="#e4e4e7" />
                            <path
                              d="M6 10.2 8.4 12.6 14 7"
                              stroke="#52525b"
                              strokeWidth="1.75"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 20 20" fill="none" aria-hidden>
                            <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.25" />
                          </svg>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="account-filter-menu__footer">
              <span className="account-filter-menu__footer-meta">
                {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
              </span>
              <Link to="/accounts" className="account-filter-menu__footer-link" onClick={() => setOpen(false)}>
                <svg fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.003.827c.424.35.534.955.26 1.43l-1.296 2.247a1.125 1.125 0 0 1-1.37.491l-1.216-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                  />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
                Manage accounts
              </Link>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="account-filter">
      <button
        ref={triggerRef}
        type="button"
        className={`account-filter__trigger${open ? " account-filter__trigger--open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Account: ${accountDisplayName(current)}`}
      >
        <span className="account-filter__icon-box">
          <ProviderMark provider={current.provider} className="account-filter__provider" />
        </span>
        <span className="account-filter__text">
          <span className="account-filter__name">{accountDisplayName(current)}</span>
          <span className="account-filter__meta">{accountDisplaySubtitle(current)}</span>
        </span>
        <FilterChevron open={open} />
      </button>
      {menu}
    </div>
  );
}
