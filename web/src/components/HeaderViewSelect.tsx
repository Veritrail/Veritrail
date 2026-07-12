import { HistoryFilterDropdown } from "./HistoryFilterDropdown";
import "../styles/history-page.css";

export type HeaderViewOption<T extends string> = {
  value: T;
  label: string;
};

export function HeaderViewSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = "",
}: {
  value: T;
  options: readonly HeaderViewOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <HistoryFilterDropdown
      label="View"
      value={value}
      options={options.map((option) => ({ value: option.value, label: option.label }))}
      onChange={(next) => onChange(next as T)}
      ariaLabel={ariaLabel}
      boxClassName={["history-filter-dropdown--view", "shrink-0", className].filter(Boolean).join(" ")}
    />
  );
}
