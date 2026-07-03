import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import { useConnectedCatalogState } from "../hooks/useConnectedCatalogState";
import {
  filterCatalog,
  INTEGRATION_CATALOG,
} from "../lib/integrationCatalog";
import "../styles/integrations-page.css";

export default function IntegrationCatalog() {
  const [query, setQuery] = useState("");
  const { hiddenKeys } = useConnectedCatalogState();

  const filtered = useMemo(
    () => filterCatalog(INTEGRATION_CATALOG, hiddenKeys, query),
    [hiddenKeys, query],
  );

  return (
    <div className="integrations-page integration-catalog">
      <div className="integration-catalog__header">
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
        <p className="integration-catalog__empty">
          {query.trim()
            ? `No integrations match "${query.trim()}".`
            : "All available integrations are already connected to this workspace."}
        </p>
      ) : (
        <div id="all-integrations" className="integration-catalog__sections">
          {filtered.map((cat) => (
            <section key={cat.id} id={cat.id} className="integration-catalog__section">
              <div className="integration-catalog__section-head">
                <div>
                  <h3>{cat.title}</h3>
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
                        <IntegrationBrandIcon brand={entry.brand} size={52} variant="plain" className="integrations-explore-card__icon integration-catalog-card__icon" />
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
