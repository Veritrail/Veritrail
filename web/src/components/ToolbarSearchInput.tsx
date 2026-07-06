import type { ChangeEvent } from "react";

type ToolbarSearchInputProps = {
  id: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  "aria-label": string;
  className?: string;
};

export function ToolbarSearchInput({
  id,
  name,
  value,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
  className,
}: ToolbarSearchInputProps) {
  return (
    <div className={["vt-toolbar-search", className].filter(Boolean).join(" ")}>
      <label className="vt-toolbar-search__input-wrap" htmlFor={id}>
        <svg
          className="vt-toolbar-search__icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#9ca3af"
          strokeWidth={2}
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path strokeLinecap="round" d="M20 20l-3-3" />
        </svg>
        <input
          id={id}
          name={name ?? id}
          type="search"
          placeholder={placeholder}
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          aria-label={ariaLabel}
        />
      </label>
    </div>
  );
}
