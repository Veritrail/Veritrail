import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

type ToolbarSearchInputProps = {
  id: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  "aria-label": string;
  className?: string;
  suggestions?: string[];
  /** When set, picking a suggestion applies it (e.g. as a filter tag) and clears the input. */
  onSelectSuggestion?: (suggestion: string) => void;
};

export function ToolbarSearchInput({
  id,
  name,
  value,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
  className,
  suggestions = [],
  onSelectSuggestion,
}: ToolbarSearchInputProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const query = value.trim().toLowerCase();
  const matches = useMemo(() => {
    if (query.length < 2) return [];
    return suggestions
      .filter((suggestion) => suggestion.toLowerCase() !== query && suggestion.toLowerCase().includes(query))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(query);
        const bStarts = b.toLowerCase().startsWith(query);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.localeCompare(b);
      })
      .slice(0, 6);
  }, [query, suggestions]);
  const open = focused && matches.length > 0;
  const listboxId = `${id}-suggestions`;

  const updateMenuPosition = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    setMenuPosition({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }
    updateMenuPosition();
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const update = () => updateMenuPosition();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setFocused(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [value]);

  const selectSuggestion = (suggestion: string) => {
    if (onSelectSuggestion) {
      // The handler owns clearing the input — a second onChange("") here would
      // race its URL write (functional setSearchParams updates don't reliably
      // chain within one tick) and drop the just-applied filter.
      onSelectSuggestion(suggestion);
    } else {
      onChange(suggestion);
    }
    setFocused(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? matches.length - 1 : index - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(matches[activeIndex]);
    } else if (event.key === "Escape") {
      setFocused(false);
    }
  };

  const menu =
    open && menuPosition
      ? createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label="Finding search suggestions"
            className="vt-toolbar-search__suggestions fixed z-[120] overflow-hidden rounded-xl border border-[#e2e8f0] bg-white py-1.5 shadow-lg shadow-zinc-900/10"
            style={{ top: menuPosition.top, left: menuPosition.left, width: menuPosition.width }}
          >
            {matches.map((suggestion, index) => (
              <button
                key={suggestion}
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`vt-toolbar-search__suggestion ${index === activeIndex ? "is-active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSuggestion(suggestion)}
              >
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                  <circle cx="11" cy="11" r="7" />
                  <path strokeLinecap="round" d="M20 20l-3-3" />
                </svg>
                <span className="truncate">{suggestion}</span>
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={["vt-toolbar-search", className].filter(Boolean).join(" ")}>
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
          ref={inputRef}
          id={id}
          name={name ?? id}
          type="search"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          placeholder={placeholder}
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            onChange(event.target.value);
            setFocused(true);
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          aria-label={ariaLabel}
        />
      </label>
      {menu}
    </div>
  );
}
