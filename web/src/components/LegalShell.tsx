import { Link } from "react-router-dom";
import type { ReactNode } from "react";

/** Minimal public shell for legal pages (privacy, terms). No auth, no app chrome. */
export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#F6F8FB] text-zinc-800">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/brand/veritrail-mark.png" alt="" className="h-6 w-6" aria-hidden />
            <span className="text-lg font-bold tracking-tight text-zinc-900">Veritrail</span>
          </Link>
          <Link to="/login" className="text-sm font-medium text-zinc-500 hover:text-zinc-800">
            Back to sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-950">{title}</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: {updated}</p>
        <div className="legal-prose mt-8 space-y-6 text-[15px] leading-relaxed text-zinc-700">
          {children}
        </div>
        <footer className="mt-12 border-t border-zinc-200 pt-6 text-xs text-zinc-400">
          <div className="flex flex-wrap gap-4">
            <Link to="/privacy" className="hover:text-zinc-600">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-zinc-600">Terms of Service</Link>
            <span>© {new Date().getFullYear()} Veritrail</span>
          </div>
        </footer>
      </main>
    </div>
  );
}

/** Section heading inside a legal page. */
export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-zinc-900">{heading}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}
