import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type MetricHelpTipProps = {
  text: string;
  /** Short name for screen readers, e.g. "Coverage" */
  metric?: string;
};

type TooltipPosition = { top: number; left: number };

export function MetricHelpTip({ text, metric }: MetricHelpTipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const open = hovering || focused || pinned;
  const ariaLabel = metric ? `What ${metric} means` : "What this metric means";

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setPosition({
      top: rect.top,
      left: rect.left + rect.width / 2,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
  }, [open, updatePosition, text]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updatePosition();
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!pinned) return;
    function onDocumentMouseDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || tooltipRef.current?.contains(target)) return;
      setPinned(false);
    }
    function onDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPinned(false);
    }
    document.addEventListener("mousedown", onDocumentMouseDown);
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentMouseDown);
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [pinned]);

  const tooltip =
    open && position
      ? createPortal(
          <span
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            className="metric-help-tip__content metric-help-tip__content--portal"
            style={{
              top: position.top,
              left: position.left,
            }}
          >
            {text}
          </span>,
          document.body,
        )
      : null;

  return (
    <>
      <span
        className={`metric-help-tip${open ? " metric-help-tip--open" : ""}`}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        <button
          ref={triggerRef}
          type="button"
          aria-label={ariaLabel}
          aria-describedby={open ? tooltipId : undefined}
          aria-expanded={pinned}
          className="metric-help-tip__trigger"
          onClick={() => setPinned((value) => !value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          ?
        </button>
      </span>
      {tooltip}
    </>
  );
}
