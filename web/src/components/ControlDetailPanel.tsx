import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { ReadinessMetric } from "../lib/controlReadiness";

/** Concrete N-of-M readiness rows — semantic color as a thin rail only. */
export function ControlReadinessBar({ metrics }: { metrics: ReadinessMetric[] }) {
  if (metrics.length === 0) return null;
  return (
    <div className="control-readiness">
      {metrics.map((m) => {
        const pct = m.total > 0 ? Math.round((m.complete / m.total) * 100) : 0;
        const fillClass =
          m.total === 0
            ? "control-readiness__fill--empty"
            : `control-readiness__fill--${m.variant}`;
        return (
          <div className="control-readiness__row" key={m.label}>
            <div className="control-readiness__row-head">
              <span className="control-readiness__label">{m.label}</span>
              <span className="control-readiness__count">
                {m.complete} of {m.total}
              </span>
            </div>
            <div className="control-readiness__track">
              <div
                className={`control-readiness__fill ${fillClass}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export type ControlDetailTabId = "overview" | "gaps" | "evidence" | "mappings" | "guidance";

export type ControlDetailTab = {
  id: ControlDetailTabId;
  label: string;
  content: ReactNode;
  /** Optional compact count pill rendered next to the label (e.g. blocking gaps). */
  badge?: ReactNode;
};

function useEscapeDismiss(onDismiss: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss, active]);
}

/** Locks body scroll while active (overlay mode), restoring the prior value. */
function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}

/**
 * Shared tabbed detail surface for a selected control/composite row.
 * `mode="docked"` renders inline (desktop master-detail column); `mode="overlay"`
 * renders as a full-screen portal (narrow-viewport fallback).
 */
export function ControlDetailPanel({
  tabs,
  activeTab,
  onTabChange,
  onClose,
  headerTitle,
  headerDescription,
  headerStatus,
  mode,
}: {
  tabs: ControlDetailTab[];
  activeTab: ControlDetailTabId;
  onTabChange: (tab: ControlDetailTabId) => void;
  onClose: () => void;
  headerTitle: ReactNode;
  headerDescription?: ReactNode;
  headerStatus?: ReactNode;
  mode: "docked" | "overlay";
}) {
  const isOverlay = mode === "overlay";
  useEscapeDismiss(onClose, isOverlay);
  useBodyScrollLock(isOverlay);
  const backdropPressedRef = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Map<ControlDetailTabId, HTMLButtonElement>>(new Map());
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];
  const activeId = active?.id;

  // Overlay open: move focus to the close button so keyboard/AT users land inside the dialog.
  useEffect(() => {
    if (isOverlay) closeRef.current?.focus();
  }, [isOverlay]);

  // WAI-ARIA tabs keyboard pattern: Left/Right move between tabs, Home/End jump to ends.
  function onTabKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onTabChange(target.id);
    tabRefs.current.get(target.id)?.focus();
  }

  const panel = (
    <div
      className="control-detail-panel"
      role={isOverlay ? "dialog" : undefined}
      aria-modal={isOverlay ? true : undefined}
      aria-labelledby="control-detail-panel-title"
    >
      <div className="control-detail-panel__header">
        <button
          ref={closeRef}
          type="button"
          className="control-detail-panel__close"
          onClick={onClose}
          aria-label="Close detail panel"
        >
          <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="control-detail-panel__title-row">
          <h2 id="control-detail-panel-title" className="control-detail-panel__title">
            {headerTitle}
          </h2>
          {headerStatus}
        </div>
        {headerDescription ? (
          <p className="control-detail-panel__description">{headerDescription}</p>
        ) : null}
      </div>

      {tabs.length > 1 ? (
      <div className="control-detail-panel__tabs" role="tablist" aria-label="Control detail">
        {tabs.map((t, index) => {
          const isActive = t.id === activeTab;
          return (
            <button
              key={t.id}
              ref={(el) => {
                if (el) tabRefs.current.set(t.id, el);
                else tabRefs.current.delete(t.id);
              }}
              type="button"
              role="tab"
              id={`control-detail-tab-${t.id}`}
              aria-selected={isActive}
              aria-controls={`control-detail-panel-${t.id}`}
              tabIndex={isActive ? 0 : -1}
              className={`control-detail-panel__tab${isActive ? " is-active" : ""}`}
              onClick={() => onTabChange(t.id)}
              onKeyDown={(e) => onTabKeyDown(e, index)}
            >
              {t.label}
              {t.badge != null ? (
                <span className="control-detail-panel__tab-badge" aria-hidden>
                  {t.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      ) : null}

      <div
        className="control-detail-panel__body"
        role="tabpanel"
        id={activeId ? `control-detail-panel-${activeId}` : undefined}
        aria-labelledby={activeId ? `control-detail-tab-${activeId}` : undefined}
        tabIndex={0}
      >
        {active?.content}
      </div>
    </div>
  );

  if (!isOverlay) return panel;

  return createPortal(
    <div
      className="control-detail-overlay"
      role="presentation"
      onMouseDown={(e) => {
        backdropPressedRef.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (backdropPressedRef.current && e.target === e.currentTarget) onClose();
        backdropPressedRef.current = false;
      }}
    >
      {panel}
    </div>,
    document.body,
  );
}
