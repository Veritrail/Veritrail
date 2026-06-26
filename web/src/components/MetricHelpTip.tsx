import { useId } from "react";

type MetricHelpTipProps = {
  text: string;
  /** Short name for screen readers, e.g. "Coverage" */
  metric?: string;
};

export function MetricHelpTip({ text, metric }: MetricHelpTipProps) {
  const tooltipId = useId();
  const ariaLabel = metric ? `What ${metric} means` : "What this metric means";

  return (
    <span className="metric-help-tip group relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-describedby={tooltipId}
        className="metric-help-tip__trigger"
      >
        ?
      </button>
      <span id={tooltipId} role="tooltip" className="metric-help-tip__content">
        {text}
      </span>
    </span>
  );
}
