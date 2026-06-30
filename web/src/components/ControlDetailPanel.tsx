import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ReadinessMetric } from "../lib/controlReadiness";

/** True when the docked master-detail column doesn't fit — matches the CSS breakpoint. */
export function useNarrowControlDetail(): boolean {
  const query = "(max-width: 1180px)";
  const [narrow, setNarrow] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setNarrow(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export type ControlDetailTabId = "overview" | "gaps" | "evidence" | "mappings" | "guidance";

export type ControlDetailTab = {
  id: ControlDetailTabId;
  label: string;
  content: ReactNode;
};

/** Concrete N-of-M readiness counts — deliberately not a "likelihood to pass" score. */
export function ControlReadinessBar({ metrics }: { metrics: ReadinessMetric[] }) {
  if (metrics.length === 0) return null;
  return (
    <div className="control-readiness">
      {metrics.map((m) => {
        const pct = m.total > 0 ? Math.round((m.complete / m.total) * 100) : 0;
        const fillClass =
          m.total === 0
            ? "control-readiness__fill--empty"
            : m.complete < m.total
              ? "control-readiness__fill--incomplete"
              : "";
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
  headerEyebrow,
  headerTitle,
  headerDescription,
  headerStatus,
  mode,
}: {
  tabs: ControlDetailTab[];
  activeTab: ControlDetailTabId;
  onTabChange: (tab: ControlDetailTabId) => void;
  onClose: () => void;
  headerEyebrow?: ReactNode;
  headerTitle: ReactNode;
  headerDescription?: ReactNode;
  headerStatus?: ReactNode;
  mode: "docked" | "overlay";
}) {
  const isOverlay = mode === "overlay";
  useEscapeDismiss(onClose, isOverlay);
  const backdropPressedRef = useRef(false);
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  const panel = (
    <div
      className="control-detail-panel"
      role={isOverlay ? "dialog" : undefined}
      aria-modal={isOverlay ? true : undefined}
      aria-labelledby="control-detail-panel-title"
    >
      <div className="control-detail-panel__header">
        <button
          type="button"
          className="control-detail-panel__close"
          onClick={onClose}
          aria-label="Close detail panel"
        >
          <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
        {headerEyebrow ? <p className="control-detail-panel__eyebrow">{headerEyebrow}</p> : null}
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

      <div className="control-detail-panel__tabs" role="tablist" aria-label="Control detail">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === activeTab}
            className={`control-detail-panel__tab${t.id === activeTab ? " is-active" : ""}`}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="control-detail-panel__body" role="tabpanel">
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
