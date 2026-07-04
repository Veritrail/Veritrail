import { useMemo } from "react";
import { Link } from "react-router-dom";

import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import { useConnectedCatalogState } from "../hooks/useConnectedCatalogState";
import { filterCatalog, INTEGRATION_CATALOG } from "../lib/integrationCatalog";
import "../styles/integrations-page.css";

function sectionCountLabel(count: number): string {
  if (count === 0) return "";
  return count === 1 ? "1 available" : `${count} available`;
}

export default function IntegrationCatalog() {
  const { hiddenKeys } = useConnectedCatalogState();

  const filtered = useMemo(
    () => filterCatalog(INTEGRATION_CATALOG, hiddenKeys),
    [hiddenKeys],
  );

  return (
    <div className="integrations-page integration-catalog">
      <header className="integration-catalog__header">
        <h1 className="integration-catalog__title">Integration catalog</h1>
        <p className="integration-catalog__subtitle">
          Connect tools to collect evidence, enrich findings, and route remediation.
        </p>
      </header>
      {filtered.length === 0 ? (
        <p className="integration-catalog__empty">
          All available integrations are already connected to this workspace.
        </p>
      ) : (
        <div id="all-integrations" className="integration-catalog__sections">
          {filtered.map((cat) => (
            <section key={cat.id} id={cat.id} className="integration-catalog__section">
              <div className="integration-catalog__section-head">
                <div className="integration-catalog__section-copy">
                  <div className="integration-catalog__section-title-row">
                    <h2>{cat.title}</h2>
                    <span className="integration-catalog__section-count">
                      {sectionCountLabel(cat.entries.length)}
                    </span>
                  </div>
                  <p>{cat.blurb}</p>
                </div>
              </div>
              <div className="integrations-explore-grid integration-catalog__grid">
                {cat.entries.map((entry) => {
                  const isComingSoon = entry.comingSoon || !entry.href;
                  return (
                    <article
                      key={entry.key}
                      className={`integrations-explore-card integration-catalog-card${isComingSoon ? " integrations-explore-card--coming-soon" : ""}`}
                    >
                      <div className="integration-catalog-card__main">
                        <IntegrationBrandIcon
                          brand={entry.brand}
                          size={52}
                          variant="plain"
                          className="integrations-explore-card__icon integration-catalog-card__icon"
                        />
                        <div className="integration-catalog-card__body">
                          <div className="integration-catalog-card__name">{entry.name}</div>
                          <p className="integration-catalog-card__desc">{entry.description}</p>
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
                      </div>
                      <div className="integration-catalog-card__tags" aria-label={`${entry.name} categories`}>
                        {entry.tags.map((tag) => (
                          <span key={tag} className="integration-catalog-card__tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
