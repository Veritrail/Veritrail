export type FilterChip = {
  id: string;
  label: string;
  count: number;
  urgent?: boolean;
};

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
    <div className="findings-v2-filter-chip-bar" role="tablist" aria-label={ariaLabel}>
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
            className={`findings-v2-filter-chip ${isSelected ? "is-selected" : ""}`}
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
