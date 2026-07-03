import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import "../styles/homepage.css";

const CONTACT_EMAIL = "support@veritrail.io";

function VeritrailWordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <img src="/brand/veritrail-mark.png" alt="" className="h-7 w-7" aria-hidden />
      <span className="text-lg font-bold tracking-tight text-teal-900">Veritrail</span>
    </div>
  );
}

function PrimaryButton({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center justify-center rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700"
    >
      {children}
    </Link>
  );
}

function OutlineButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center justify-center rounded-lg border border-teal-600 bg-white px-4 py-2.5 text-sm font-semibold text-teal-700 shadow-sm transition hover:bg-teal-50"
    >
      {children}
    </a>
  );
}

const RECENT_EVIDENCE = [
  { brand: "aws" as const, source: "AWS", label: "S3 Bucket Public Access Disabled", updated: "2h ago" },
  { brand: "github" as const, source: "GitHub", label: "GitHub Branch Protection Enabled", updated: "1d ago" },
  { brand: "gcp" as const, source: "GCP", label: "CloudTrail Logging Enabled", updated: "1d ago" },
  { brand: "azure" as const, source: "Azure", label: "Storage Account Encryption Enabled", updated: "3d ago" },
];

function SparklineIcon({ className = "", path }: { className?: string; path?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 16" fill="none" aria-hidden>
      <path
        d={path ?? "M1 12 L10 9 L18 11 L26 6 L34 8 L42 3 L47 5"}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const FEATURES = [
  {
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4h8z" />
      </svg>
    ),
    label: "Read-only access",
  },
  {
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0 1 12 2.944a11.955 11.955 0 0 1-8.618 3.04A12.02 12.02 0 0 0 3 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    label: "SOC 2 mapped",
  },
  {
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
      </svg>
    ),
    label: "Daily evidence collection",
  },
  {
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
      </svg>
    ),
    label: "JSON / CSV / PDF exports",
  },
];

const WHY_ITEMS = [
  {
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 0 0 4 4h9a5 5 0 1 0-.1-9.999 5.002 5.002 0 1 0-9.78 2.096A4.001 4.001 0 0 0 3 15z" />
      </svg>
    ),
    title: "Multi-cloud posture evidence",
    body: "Collect read-only configuration evidence across AWS, Google Cloud, and Azure — mapped to SOC 2 controls in one place.",
  },
  {
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2C6.477 2 2 6.593 2 12.253c0 4.526 2.862 8.368 6.839 9.724.5.095.683-.222.683-.494 0-.244-.009-.89-.014-1.747-2.782.62-3.369-1.375-3.369-1.375-.455-1.184-1.11-1.5-1.11-1.5-.908-.636.069-.623.069-.623 1.004.072 1.532 1.057 1.532 1.057.892 1.566 2.341 1.114 2.91.852.091-.662.349-1.114.635-1.37-2.221-.259-4.555-1.139-4.555-5.068 0-1.12.39-2.034 1.029-2.751-.103-.26-.446-1.302.098-2.714 0 0 .84-.276 2.75 1.051A9.358 9.358 0 0 1 12 6.949c.85.004 1.705.118 2.504.346 1.909-1.327 2.747-1.051 2.747-1.051.546 1.412.203 2.454.1 2.714.64.717 1.027 1.631 1.027 2.751 0 3.939-2.337 4.806-4.565 5.06.359.318.679.945.679 1.904 0 1.374-.013 2.483-.013 2.82 0 .274.18.594.688.493C19.14 20.617 22 16.778 22 12.253 22 6.593 17.523 2 12 2Z" />
      </svg>
    ),
    title: "GitHub and GitLab change evidence",
    body: "Track branch protection, code review, and deployment controls from your source-control platforms alongside cloud posture.",
  },
  {
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
      </svg>
    ),
    title: "Mapped findings and exports",
    body: "Every finding ties to a SOC 2 control. Export auditor-ready JSON, CSV, or PDF evidence packs on demand.",
  },
];

function DashboardPreview() {
  return (
    <div className="homepage-dashboard-stack">
      <div className="homepage-dashboard-card homepage-dashboard-card--back-2" aria-hidden>
        <div className="homepage-peek-card">
          <span className="homepage-peek-card__title">Evidence</span>
          <div className="homepage-peek-card__row">
            <div className="homepage-peek-card__icon-box homepage-peek-card__icon-box--doc">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z"
                />
              </svg>
            </div>
            <div className="homepage-peek-card__skeleton">
              <span className="homepage-peek-card__bar homepage-peek-card__bar--wide" />
              <span className="homepage-peek-card__bar homepage-peek-card__bar--narrow" />
            </div>
          </div>
          <div className="homepage-peek-card__skeleton homepage-peek-card__skeleton--stacked">
            <span className="homepage-peek-card__bar" />
            <span className="homepage-peek-card__bar homepage-peek-card__bar--medium" />
            <span className="homepage-peek-card__bar homepage-peek-card__bar--short" />
          </div>
        </div>
      </div>
      <div className="homepage-dashboard-card homepage-dashboard-card--back-1" aria-hidden>
        <div className="homepage-peek-card">
          <span className="homepage-peek-card__title">Mappings</span>
          <div className="homepage-peek-card__row">
            <div className="homepage-peek-card__icon-box homepage-peek-card__icon-box--shield">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0 1 12 2.944a11.955 11.955 0 0 1-8.618 3.04A12.02 12.02 0 0 0 3 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </div>
            <div className="homepage-peek-card__skeleton">
              <span className="homepage-peek-card__bar homepage-peek-card__bar--wide" />
              <span className="homepage-peek-card__bar homepage-peek-card__bar--narrow" />
            </div>
          </div>
          <div className="homepage-peek-card__rows">
            <span className="homepage-peek-card__bar" />
            <span className="homepage-peek-card__bar homepage-peek-card__bar--medium" />
            <span className="homepage-peek-card__bar homepage-peek-card__bar--short" />
          </div>
        </div>
      </div>

      <div className="homepage-dashboard-card homepage-dashboard-card--main">
        <div className="homepage-dashboard__header">
          <h2 className="homepage-dashboard__title">SOC 2 Overview</h2>
          <p className="homepage-dashboard__subtitle">Continuous evidence for cloud and engineering teams</p>
        </div>

        <div className="homepage-dashboard__stats">
          <div className="homepage-stat-card homepage-stat-card--sparkline">
            <div className="homepage-stat-card__value homepage-stat-card__value--navy">98%</div>
            <div className="homepage-stat-card__label">Controls covered</div>
            <SparklineIcon className="homepage-stat-card__sparkline" />
          </div>
          <div className="homepage-stat-card homepage-stat-card--sparkline">
            <div className="homepage-stat-card__value homepage-stat-card__value--navy">2,472</div>
            <div className="homepage-stat-card__label">Evidence items</div>
            <SparklineIcon
              className="homepage-stat-card__sparkline homepage-stat-card__sparkline--navy"
              path="M1 10 L9 12 L17 8 L25 9 L33 5 L41 7 L47 4"
            />
          </div>
          <div className="homepage-stat-card">
            <div className="homepage-stat-card__value homepage-stat-card__value--green">96%</div>
            <div className="homepage-stat-card__label">Healthy</div>
          </div>
          <div className="homepage-stat-card">
            <div className="homepage-stat-card__value homepage-stat-card__value--orange">3</div>
            <div className="homepage-stat-card__label">Risks</div>
          </div>
        </div>

        <div className="homepage-dashboard__body">
          <div className="homepage-dashboard__evidence">
            <h3 className="homepage-dashboard__section-title">Recent evidence</h3>
            <table className="homepage-evidence-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Source</th>
                  <th scope="col" className="homepage-evidence-table__updated">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {RECENT_EVIDENCE.map((row) => (
                  <tr key={row.label}>
                    <td className="homepage-evidence-table__item">{row.label}</td>
                    <td>
                      <span className="homepage-evidence-table__source">
                        <IntegrationBrandIcon brand={row.brand} size={18} variant="plain" />
                        <span>{row.source}</span>
                      </span>
                    </td>
                    <td className="homepage-evidence-table__updated">{row.updated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="homepage-dashboard__donut-panel">
            <h3 className="homepage-dashboard__section-title">Controls by status</h3>
            <div className="homepage-donut-wrap">
              <div className="homepage-donut" aria-hidden />
              <div className="homepage-donut__label">
                <span>98%</span>
                <span className="homepage-donut__sublabel">Covered</span>
              </div>
            </div>
            <ul className="homepage-donut-legend">
              <li>
                <span className="homepage-donut-legend__dot homepage-donut-legend__dot--green" aria-hidden />
                In place <span className="homepage-donut-legend__count">(142)</span>
              </li>
              <li>
                <span className="homepage-donut-legend__dot homepage-donut-legend__dot--yellow" aria-hidden />
                Partial <span className="homepage-donut-legend__count">(6)</span>
              </li>
              <li>
                <span className="homepage-donut-legend__dot homepage-donut-legend__dot--red" aria-hidden />
                Not in place <span className="homepage-donut-legend__count">(2)</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

const DIAGRAM_ICON_SIZE = 68;

function IntegrationDiagram() {
  const clouds: Array<"aws" | "gcp" | "azure"> = ["aws", "gcp", "azure"];
  const arrowStroke = {
    fill: "none",
    stroke: "#94a3b8",
    strokeWidth: 2,
    strokeDasharray: "5 4",
    strokeLinecap: "round",
  } as const;

  return (
    <div className="homepage-diagram" aria-hidden>
      <div className="homepage-diagram__sources">
        {clouds.map((brand) => (
          <IntegrationBrandIcon key={brand} brand={brand} size={DIAGRAM_ICON_SIZE} />
        ))}
      </div>

      <svg
        className="homepage-diagram__arrows homepage-diagram__arrows--desktop"
        viewBox="0 0 120 240"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <marker
            id="homepage-diagram-arrow"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
          >
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#94a3b8" />
          </marker>
        </defs>
        <path
          d="M0,42 C48,42 68,78 120,120"
          markerEnd="url(#homepage-diagram-arrow)"
          {...arrowStroke}
        />
        <path d="M0,120 C58,120 62,120 120,120" markerEnd="url(#homepage-diagram-arrow)" {...arrowStroke} />
        <path
          d="M0,198 C48,198 68,162 120,120"
          markerEnd="url(#homepage-diagram-arrow)"
          {...arrowStroke}
        />
      </svg>

      <svg
        className="homepage-diagram__arrows homepage-diagram__arrows--mobile"
        viewBox="0 0 240 72"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <marker
            id="homepage-diagram-arrow-mobile"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
          >
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#94a3b8" />
          </marker>
        </defs>
        <path
          d="M40,0 C40,28 52,48 120,72"
          markerEnd="url(#homepage-diagram-arrow-mobile)"
          {...arrowStroke}
        />
        <path d="M120,0 L120,72" markerEnd="url(#homepage-diagram-arrow-mobile)" {...arrowStroke} />
        <path
          d="M200,0 C200,28 188,48 120,72"
          markerEnd="url(#homepage-diagram-arrow-mobile)"
          {...arrowStroke}
        />
      </svg>

      <div className="homepage-diagram__target">
        <img src="/brand/veritrail-mark.png" alt="" className="homepage-diagram__mark" />
      </div>
    </div>
  );
}

/** Public branding page for OAuth app verification (Google Cloud Console home page URL). */
export default function Homepage() {
  return (
    <div className="min-h-screen bg-[#F6F8FB] text-zinc-800">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <VeritrailWordmark />
          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm font-medium text-zinc-500 hover:text-zinc-700">
              Sign in
            </Link>
            <PrimaryButton to="/login">Sign in to Veritrail</PrimaryButton>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 py-12 sm:py-16 lg:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-600">
                Cloud compliance evidence
              </p>
              <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-teal-900 sm:text-4xl lg:text-[2.65rem] lg:leading-[1.15]">
                Continuous SOC 2 evidence for cloud and engineering teams.
              </h1>
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-zinc-600 sm:text-base">
                Veritrail connects to AWS, Google Cloud, Azure, GitHub, and GitLab to collect read-only evidence,
                map findings to SOC 2 controls, and produce auditor-ready exports on demand.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <PrimaryButton to="/login">Sign in to Veritrail</PrimaryButton>
                <OutlineButton href="#how-it-works">See how it works →</OutlineButton>
              </div>
            </div>
            <DashboardPreview />
          </div>
        </section>

        {/* Feature bar */}
        <section className="border-y border-zinc-200/80 bg-white">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-8 sm:grid-cols-4 sm:gap-8 sm:py-10">
            {FEATURES.map((feature) => (
              <div key={feature.label} className="homepage-feature flex flex-row items-center gap-3">
                <div className="homepage-feature__icon">{feature.icon}</div>
                <span className="homepage-feature__label">{feature.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-14 sm:py-20">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <IntegrationDiagram />
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Why teams use Veritrail</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-zinc-600">
                One read-only evidence layer across your cloud and engineering stack — built for SOC 2, not a broad GRC
                suite.
              </p>
              <ul className="mt-8 space-y-6">
                {WHY_ITEMS.map((item) => (
                  <li key={item.title} className="flex gap-4">
                    <div className="homepage-benefit__icon flex shrink-0 items-center justify-center">
                      {item.icon}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-zinc-600">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-xs text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Veritrail, Inc.</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link to="/privacy" className="hover:text-zinc-600">
              Privacy Policy
            </Link>
            <Link to="/terms" className="hover:text-zinc-600">
              Terms of Service
            </Link>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-medium text-teal-600 hover:text-teal-700"
            >
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
