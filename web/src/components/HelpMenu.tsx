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
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200/90 bg-white/80 text-zinc-600 shadow-[0_1px_2px_rgba(15,23,42,0.04)] outline-none transition hover:border-zinc-300 hover:bg-white hover:text-zinc-900 focus-visible:ring-4 focus-visible:ring-zinc-900/[0.06]"
        aria-label="Help"
        aria-expanded={open}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.5 9.25a2.5 2.5 0 1 1 3.5 2.29c-.73.32-1.25.99-1.25 1.79v.42"
          />
          <path strokeLinecap="round" d="M12 17h.01" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-52 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg shadow-zinc-950/[0.08]">
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
