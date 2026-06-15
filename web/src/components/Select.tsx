import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/select.css";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  /** Extra classes on the trigger button (e.g. width). */
  className?: string;
  size?: "sm" | "md";
  align?: "left" | "right";
};

type Coords = { top: number; left?: number; right?: number; minWidth: number };

/** App-styled dropdown that matches the web design — replaces the native
    <select> so the open menu isn't the OS-rendered popup. The menu renders in a
    portal so it is never clipped by an ancestor's overflow. */
export function Select({
  value,
  onChange,
  options,
  disabled,
  className = "",
  size = "md",
  align = "left",
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const base = { top: r.bottom + 6, minWidth: r.width };
    setCoords(align === "right" ? { ...base, right: window.innerWidth - r.right } : { ...base, left: r.left });
  }

  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScrollResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [open]);

  return (
    <div className={`vigil-select vigil-select--${size}`}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`vigil-select__btn ${className}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="vigil-select__value">{selected?.label ?? "Select"}</span>
        <svg
          className={`vigil-select__chev${open ? " vigil-select__chev--open" : ""}`}
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden
        >
          <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            className={`vigil-select__menu vigil-select--${size}`}
            role="listbox"
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              right: coords.right,
              minWidth: coords.minWidth,
            }}
          >
            {options.map((o) => {
              const active = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={o.disabled}
                  onClick={() => {
                    if (o.disabled) return;
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`vigil-select__opt${active ? " vigil-select__opt--active" : ""}`}
                >
                  <span>{o.label}</span>
                  {active && (
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
                      <path d="M5 10.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
