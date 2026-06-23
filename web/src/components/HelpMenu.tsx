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
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-52 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg shadow-zinc-950/[0.08]">
          <Link
            to="/reference"
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50"
          >
            Reference
          </Link>
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Veritrail support request")}`}
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50"
          >
            Contact support
          </a>
          <Link
            to="/privacy"
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50"
          >
            Privacy
          </Link>
          <Link
            to="/terms"
            onClick={() => setOpen(false)}
            className="block px-3 py-2.5 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50"
          >
            Terms
          </Link>
        </div>
      )}
    </div>
  );
}
