import { Link } from "react-router-dom";

const CONTACT_EMAIL = "support@veritrail.io";

/** Public branding page for OAuth app verification (Google Cloud Console home page URL). */
export default function Homepage() {
  return (
    <div className="min-h-screen bg-[#F6F8FB] text-zinc-800">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <img src="/brand/veritrail-mark.png" alt="" className="h-6 w-6" aria-hidden />
            <span className="text-lg font-bold tracking-tight text-teal-900">Veritrail</span>
          </div>
          <Link to="/login" className="text-sm font-medium text-zinc-500 hover:text-teal-700">
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight text-teal-900">Veritrail</h1>
        <p className="mt-3 text-lg text-zinc-600">
          Multi-cloud SOC 2 cloud and change evidence automation for engineering teams.
        </p>

        <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-zinc-700">
          <p>
            Veritrail is a read-only cloud compliance-evidence tool. Connect AWS, Google Cloud, and Azure, plus
            GitHub or GitLab for change evidence, then scan daily for posture findings mapped to SOC 2 controls.
            Veritrail produces auditor-ready evidence packs — JSON, CSV, and PDF — on demand.
          </p>
          <p>
            Built for engineering teams heading into SOC 2 who need a credible multi-cloud and change evidence
            layer, not a broad GRC suite.
          </p>
        </div>

        <div className="mt-10">
          <Link
            to="/login"
            className="inline-flex items-center rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-700"
          >
            Sign in to Veritrail
          </Link>
        </div>

        <section className="mt-12 rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Contact</h2>
          <p className="mt-2 text-[15px] text-zinc-700">
            Questions about Veritrail or your data? Email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-teal-700 underline-offset-2 hover:text-teal-800 hover:underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>

        <footer className="mt-12 border-t border-zinc-200 pt-6 text-xs text-zinc-400">
          <div className="flex flex-wrap gap-4">
            <Link to="/privacy" className="hover:text-teal-700">
              Privacy Policy
            </Link>
            <Link to="/terms" className="hover:text-teal-700">
              Terms of Service
            </Link>
            <span>© {new Date().getFullYear()} Veritrail</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
