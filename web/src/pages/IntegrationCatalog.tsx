import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import type { IntegrationBrandId } from "../lib/integrationBrands";
import "../styles/integrations-page.css";

type CatalogEntry = {
  key: string;
  brand: IntegrationBrandId;
  name: string;
  description: string;
  href?: string;
  comingSoon?: boolean;
};

type CatalogCategory = {
  id: string;
  title: string;
  blurb: string;
  entries: CatalogEntry[];
};

/** Full integration directory. Connected-state management stays on the
    Integrations page; this is the neutral "what can Veritrail talk to" view. */
const CATALOG: CatalogCategory[] = [
  {
    id: "cloud",
    title: "Cloud providers",
    blurb: "Posture scanning, audit evidence, and findings across your cloud accounts.",
    entries: [
      { key: "aws", brand: "aws", name: "AWS", description: "Cloud posture, audit evidence, and automated remediation.", href: "/accounts" },
      { key: "gcp", brand: "gcp", name: "Google Cloud", description: "Multi-cloud posture checks and security findings.", href: "/integrations/gcp" },
      { key: "azure", brand: "azure", name: "Microsoft Azure", description: "Defender, storage, RBAC, and policy compliance checks.", href: "/integrations/azure" },
    ],
  },
  {
    id: "source-control",
    title: "Source control & SDLC",
    blurb: "Branch protection, review evidence, and change history.",
    entries: [
      { key: "github", brand: "github", name: "GitHub", description: "Repository governance and CI/CD safeguards.", href: "/integrations/github" },
      { key: "gitlab", brand: "gitlab", name: "GitLab", description: "Protected branches, approvals, and pipelines.", href: "/integrations/gitlab" },
    ],
  },
  {
    id: "identity",
    title: "Identity providers",
    blurb: "Directory sync, MFA posture, and access-review evidence.",
    entries: [
      { key: "entra", brand: "entra", name: "Microsoft Entra ID", description: "User inventory, MFA enforcement, admin review.", href: "/integrations/entra" },
      { key: "google-workspace", brand: "google-workspace", name: "Google Workspace", description: "User activity and admin governance evidence.", href: "/integrations/google-workspace" },
      { key: "okta", brand: "okta", name: "Okta", description: "Identity directory sync and access reviews.", href: "/integrations/okta" },
    ],
  },
  {
    id: "scanners",
    title: "Vulnerability scanners",
    blurb: "Bring scanner results into vulnerability-management evidence.",
    entries: [
      { key: "snyk", brand: "snyk", name: "Snyk", description: "Import open code and dependency issues.", href: "/integrations/scanners/snyk" },
      { key: "wiz", brand: "wiz", name: "Wiz", description: "Cloud vulnerability findings as evidence.", href: "/integrations/scanners/wiz" },
      { key: "tenable", brand: "tenable", name: "Tenable", description: "Vulnerability management coverage evidence.", href: "/integrations/scanners/tenable" },
      { key: "qualys", brand: "qualys", name: "Qualys", description: "Scanner coverage and findings export.", href: "/integrations/scanners/qualys" },
      { key: "orca", brand: "orca", name: "Orca", description: "Agentless cloud scanning evidence.", href: "/integrations/scanners/orca" },
      { key: "aikido", brand: "aikido", name: "Aikido", description: "AppSec findings as audit evidence.", href: "/integrations/scanners/aikido" },
    ],
  },
  {
    id: "siem",
    title: "SIEM & monitoring",
    blurb: "Signal evidence that logging and alerting operate.",
    entries: [
      { key: "splunk", brand: "splunk", name: "Splunk", description: "SIEM signal evidence.", href: "/integrations/siem/splunk" },
      { key: "datadog", brand: "datadog", name: "Datadog", description: "Monitoring signal evidence.", href: "/integrations/siem/datadog" },
      { key: "elastic", brand: "elastic", name: "Elastic", description: "SIEM export adapter.", href: "/integrations/siem/elastic" },
    ],
  },
  {
    id: "ticketing",
    title: "Ticketing & remediation",
    blurb: "Turn findings into tracked remediation work.",
    entries: [
      { key: "jira", brand: "jira", name: "Jira", description: "Create Jira issues from findings for remediation tracking.", href: "/integrations/jira" },
      { key: "iac-repository", brand: "iac", name: "IaC repository", description: "Link Terraform/Terragrunt repos where cloud fixes land as PRs.", href: "/integrations/iac-repository" },
      { key: "azure-boards", brand: "azure-devops", name: "Azure Boards", description: "Create work items from findings.", href: "/integrations/azure-boards" },
      { key: "azure-devops", brand: "azure-devops", name: "Azure DevOps Pipelines", description: "Track work and pipelines.", comingSoon: true },
    ],
  },
  {
    id: "alerts",
    title: "Alerts & digests",
    blurb: "Route scan alerts and weekly digests to your team.",
    entries: [
      { key: "slack", brand: "slack", name: "Slack", description: "Scan alerts and weekly digests for your channel.", href: "/integrations/slack" },
    ],
  },
];

export default function IntegrationCatalog() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CATALOG;
    return CATALOG.map((cat) => ({
      ...cat,
      entries: cat.entries.filter(
        (e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
      ),
    })).filter((cat) => cat.entries.length > 0);
  }, [query]);

  const total = CATALOG.reduce((n, c) => n + c.entries.length, 0);

  return (
    <div className="integrations-page integration-catalog">
      <div className="integration-catalog__header">
        <div>
          <h2 className="integration-catalog__title">Integration catalog</h2>
          <p className="integration-catalog__subtitle">
            {total} integrations across cloud, identity, scanners, and delivery.
          </p>
        </div>
        <div className="integration-catalog__actions">
          <Link to="/integrations" className="integration-catalog__back">
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back to connected integrations
          </Link>
          <input
            className="integration-catalog__search"
            type="search"
            placeholder="Search integrations..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search integrations"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="integration-catalog__empty">No integrations match "{query.trim()}".</p>
      ) : (
        filtered.map((cat) => (
          <section key={cat.id} className="integration-catalog__section">
            <div className="integration-catalog__section-head">
              <h3>{cat.title}</h3>
              <p>{cat.blurb}</p>
            </div>
            <div className="integrations-explore-grid">
              {cat.entries.map((entry) => {
                const isComingSoon = entry.comingSoon || !entry.href;
                return (
                  <article
                    key={entry.key}
                    className={`integrations-explore-card${isComingSoon ? " integrations-explore-card--coming-soon" : ""}`}
                  >
                    <IntegrationBrandIcon brand={entry.brand} size={48} variant="plain" className="integrations-explore-card__icon" />
                    <div className="integrations-explore-card__body">
                      <div className="integrations-explore-card__name">{entry.name}</div>
                      <p className="integrations-explore-card__desc">{entry.description}</p>
                    </div>
                    {isComingSoon ? (
                      <button type="button" className="integrations-connect-btn integrations-connect-btn--coming-soon" disabled>
                        Coming soon
                      </button>
                    ) : (
                      <Link to={entry.href!} className="integrations-connect-btn">
                        Connect
                      </Link>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
