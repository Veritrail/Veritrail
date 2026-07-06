export type FilterChip = {
  id: string;
  label: string;
  count: number;
  urgent?: boolean;
};

export type ToggleChip = {
  id: string;
  label: string;
};

/** Multi-select chip bar — same segmented style as Findings/Compliance filters. */
export function ToggleChipBar({
  chips,
  selected,
  onChange,
  ariaLabel,
  className,
}: {
  chips: readonly ToggleChip[];
  selected: readonly string[];
  onChange: (id: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      className={["vt-toolbar-segmented findings-v2-filter-chip-bar", className].filter(Boolean).join(" ")}
      role="group"
      aria-label={ariaLabel}
    >
      {chips.map((chip) => {
        const isSelected = selected.includes(chip.id);
        return (
          <button
            key={chip.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(chip.id)}
            className={`vt-toolbar-segment findings-v2-filter-chip ${isSelected ? "vt-toolbar-segment--active is-selected" : ""}`}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

export function FilterChipBar({
  chips,
  selected,
  onChange,
  ariaLabel,
}: {
  chips: readonly FilterChip[];
  selected: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="vt-toolbar-segmented findings-v2-filter-chip-bar" role="tablist" aria-label={ariaLabel}>
      {chips.map((chip) => {
        const isSelected = selected === chip.id;
        const showUrgent = chip.urgent && chip.count > 0;
        return (
          <button
            key={chip.id}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onChange(chip.id)}
            className={`vt-toolbar-segment findings-v2-filter-chip ${isSelected ? "vt-toolbar-segment--active is-selected" : ""}`}
          >
            {chip.label}
            <span
              className={
                showUrgent && !isSelected
                  ? "text-red-500/90"
                  : isSelected
                    ? "text-zinc-500"
                    : "text-zinc-400"
              }
            >
              · {chip.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
