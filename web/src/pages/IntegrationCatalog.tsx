import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import { useConnectedCatalogState } from "../hooks/useConnectedCatalogState";
import {
  catalogSectionCountLabel,
  filterCatalog,
  INTEGRATION_CATALOG,
  type CatalogSortKey,
  type CatalogStatusFilter,
} from "../lib/integrationCatalog";
import "../styles/integrations-page.css";

const STATUS_FILTERS: { id: CatalogStatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "available", label: "Available" },
  { id: "connected", label: "Connected" },
  { id: "coming-soon", label: "Coming soon" },
];

const SORT_OPTIONS: { value: CatalogSortKey; label: string }[] = [
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" },
];

type SelectOption = { value: string; label: string };

function CatalogToolbarSelect({
  label,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? options[0];

  const updateMenuPosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 6,
      left: rect.left,
      minWidth: Math.max(rect.width, 168),
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

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={ariaLabel}
            className="integration-catalog__menu"
            style={{ top: menuPos.top, left: menuPos.left, minWidth: menuPos.minWidth }}
          >
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`integration-catalog__menu-option${active ? " is-active" : ""}`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="integration-catalog__select">
      <button
        ref={triggerRef}
        type="button"
        className="integration-catalog__select-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${selected.label}`}
      >
        <span>{label}</span>
        <svg
          className={`integration-catalog__select-chevron${open ? " is-open" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {menu}
    </div>
  );
}

export default function IntegrationCatalog() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CatalogStatusFilter>("available");
  const [categoryId, setCategoryId] = useState("all");
  const [sortKey, setSortKey] = useState<CatalogSortKey>("name-asc");
  const { hiddenKeys } = useConnectedCatalogState();

  const categoryOptions = useMemo<SelectOption[]>(
    () => [
      { value: "all", label: "All categories" },
      ...INTEGRATION_CATALOG.map((cat) => ({ value: cat.id, label: cat.title })),
    ],
    [],
  );

  const filtered = useMemo(
    () =>
      filterCatalog(INTEGRATION_CATALOG, hiddenKeys, {
        query,
        statusFilter,
        categoryId,
        sortKey,
      }),
    [hiddenKeys, query, statusFilter, categoryId, sortKey],
  );

  const emptyMessage = useMemo(() => {
    if (query.trim()) return `No integrations match "${query.trim()}".`;
    switch (statusFilter) {
      case "connected":
        return "No connected integrations match the current filters.";
      case "coming-soon":
        return "No coming-soon integrations match the current filters.";
      case "all":
        return "No integrations match the current filters.";
      default:
        return "All available integrations are already connected to this workspace.";
    }
  }, [query, statusFilter]);

  return (
    <div className="integrations-page integration-catalog">
      <div className="integration-catalog__toolbar" role="search">
        <label className="integration-catalog__search">
          <span className="sr-only">Search integrations</span>
          <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" />
          </svg>
          <input
            type="search"
            placeholder="Search integrations..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search integrations"
          />
        </label>

        <div className="integration-catalog__toolbar-controls">
          <div className="integration-catalog__status-filter" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                aria-pressed={statusFilter === filter.id}
                className={`integration-catalog__status-chip${statusFilter === filter.id ? " is-selected" : ""}`}
                onClick={() => setStatusFilter(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <CatalogToolbarSelect
            label="Category"
            value={categoryId}
            options={categoryOptions}
            onChange={setCategoryId}
            ariaLabel="Category"
          />
          <CatalogToolbarSelect
            label="Sort"
            value={sortKey}
            options={SORT_OPTIONS}
            onChange={(value) => setSortKey(value as CatalogSortKey)}
            ariaLabel="Sort"
          />
        </div>
      </div>

      <header className="integration-catalog__intro">
        <Link to="/integrations" className="integration-catalog__back">
          ← Connected integrations
        </Link>
      </header>

      {filtered.length === 0 ? (
        <p className="integration-catalog__empty">{emptyMessage}</p>
      ) : (
        <div id="all-integrations" className="integration-catalog__sections">
          {filtered.map((cat) => (
            <section key={cat.id} id={cat.id} className="integration-catalog__section">
              <div className="integration-catalog__section-head">
                <div className="integration-catalog__section-copy">
                  <h2>{cat.title}</h2>
                  <p>{cat.blurb}</p>
                </div>
                <span className="integration-catalog__section-count">
                  {catalogSectionCountLabel(cat.entries.length, statusFilter)}
                </span>
              </div>
              <div className="integrations-explore-grid integration-catalog__grid">
                {cat.entries.map((entry) => {
                  const isComingSoon = entry.comingSoon || !entry.href;
                  return (
                    <article
                      key={entry.key}
                      className={`integrations-explore-card integration-catalog-card${isComingSoon ? " integrations-explore-card--coming-soon" : ""}`}
                    >
                      <div className="integration-catalog-card__main">
                        <IntegrationBrandIcon
                          brand={entry.brand}
                          size={52}
                          variant="plain"
                          className="integrations-explore-card__icon integration-catalog-card__icon"
                        />
                        <div className="integration-catalog-card__body">
                          <div className="integration-catalog-card__name">{entry.name}</div>
                          <p className="integration-catalog-card__desc">{entry.description}</p>
                        </div>
                        {isComingSoon ? (
                          <button type="button" className="integrations-connect-btn integrations-connect-btn--coming-soon" disabled>
                            Coming soon
                          </button>
                        ) : (
                          <Link to={entry.href!} className="integrations-connect-btn">
                            Connect
                          </Link>
                        )}
                      </div>
                      <div className="integration-catalog-card__tags" aria-label={`${entry.name} categories`}>
                        {entry.tags.map((tag) => (
                          <span key={tag} className="integration-catalog-card__tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
