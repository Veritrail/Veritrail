import { Link } from "react-router-dom";

/** Public marketing home — no auth. Required for Google OAuth app branding verification. */
export default function PublicHome() {
  return (
    <div className="min-h-screen bg-[#F6F8FB] text-zinc-800">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <img src="/brand/veritrail-mark.png" alt="" className="h-6 w-6" aria-hidden />
            <span className="text-lg font-bold tracking-tight text-zinc-900">Veritrail</span>
          </div>
          <Link to="/login" className="text-sm font-semibold text-teal-700 hover:text-teal-800">
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl">
          Read-only cloud compliance evidence for engineering teams
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-zinc-600">
          Veritrail connects to your AWS account with a read-only IAM role, runs daily security and
          compliance scans, and produces auditor-ready evidence packs. It helps teams find stale access,
          over-permissive IAM, and SOC 2 / CIS control gaps — without modifying your cloud environment.
        </p>

        <ul className="mt-8 space-y-3 text-[15px] leading-relaxed text-zinc-700">
          <li className="flex gap-2">
            <span className="font-semibold text-zinc-900">Read-only by design.</span>
            <span>Scans use an enumerated IAM policy — no write access to your account.</span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-zinc-900">Evidence for auditors.</span>
            <span>Download dated ZIP and PDF packs mapped to SOC 2 and CIS controls.</span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-zinc-900">For workspace members.</span>
            <span>Sign in with your company Google account or credentials provided by your admin.</span>
          </li>
        </ul>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/login"
            className="inline-flex items-center rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800"
          >
            Sign in to your workspace
          </Link>
          <a
            href="mailto:privacy@veritrail.app"
            className="inline-flex items-center rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          >
            Contact us
          </a>
        </div>
      </main>

      <footer className="mx-auto max-w-3xl border-t border-zinc-200 px-6 py-8 text-xs text-zinc-400">
        <div className="flex flex-wrap gap-4">
          <Link to="/privacy" className="hover:text-zinc-600">
            Privacy Policy
          </Link>
          <Link to="/terms" className="hover:text-zinc-600">
            Terms of Service
          </Link>
          <span>© {new Date().getFullYear()} Veritrail</span>
        </div>
      </footer>
    </div>
  );
}
