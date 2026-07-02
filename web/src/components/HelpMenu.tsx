import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

const SUPPORT_EMAIL = "elazar.chodjayev@cloud-castles.com";

export default function HelpMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="veritrail-header-action"
        aria-label="Help"
        aria-expanded={open}
      >
        <svg className="veritrail-header-action__icon" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </button>

      {open && (
        <div className="veritrail-popover-panel absolute right-0 top-full z-40 mt-2 w-52 overflow-hidden py-1">
          <Link
            to="/reference"
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50"
          >
            Documentation
          </Link>
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Veritrail support request")}`}
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50"
          >
            Contact Support
          </a>
        </div>
      )}
    </div>
  );
}
