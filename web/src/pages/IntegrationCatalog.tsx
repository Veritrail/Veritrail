import { useMemo } from "react";

import {
  IntegrationBrandIcon,
  IntegrationCatalogComingSoonButton,
  IntegrationCatalogConnectLink,
} from "../components/IntegrationsUi";
import { useConnectedCatalogState } from "../hooks/useConnectedCatalogState";
import {
  filterCatalogForDisplay,
  INTEGRATION_CATALOG,
  isCatalogEntryComingSoon,
  type CatalogEntry,
} from "../lib/integrationCatalog";
import "../styles/integrations-page.css";

function sectionCountLabel(entries: CatalogEntry[]): string {
  const available = entries.filter((entry) => !isCatalogEntryComingSoon(entry)).length;
  const comingSoon = entries.filter((entry) => isCatalogEntryComingSoon(entry)).length;
  const parts: string[] = [];
  if (available > 0) {
    parts.push(available === 1 ? "1 available" : `${available} available`);
  }
  if (comingSoon > 0) {
    parts.push(comingSoon === 1 ? "1 coming soon" : `${comingSoon} coming soon`);
  }
  return parts.join(" · ");
}

export default function IntegrationCatalog() {
  const { hiddenKeys } = useConnectedCatalogState();

  const filtered = useMemo(
    () => filterCatalogForDisplay(INTEGRATION_CATALOG, hiddenKeys),
    [hiddenKeys],
  );

  return (
    <div className="integrations-page integration-catalog">
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
                      {sectionCountLabel(cat.entries)}
                    </span>
                  </div>
                  <p>{cat.blurb}</p>
                </div>
              </div>
              <div className="integrations-explore-grid integration-catalog__grid">
                {cat.entries.map((entry) => {
                  const isComingSoon = isCatalogEntryComingSoon(entry);
                  return (
                    <article
                      key={entry.key}
                      className={`integrations-explore-card integration-catalog-card${isComingSoon ? " integration-catalog-card--soon" : ""}`}
                    >
                      <div className="integration-catalog-card__top">
                        <IntegrationBrandIcon
                          brand={entry.brand}
                          size={40}
                          variant="plain"
                          className="integration-catalog-card__icon"
                        />
                        <div className="integration-catalog-card__body">
                          <div className="integration-catalog-card__name">{entry.name}</div>
                          <p className="integration-catalog-card__desc">{entry.description}</p>
                        </div>
                        {isComingSoon ? (
                          <IntegrationCatalogComingSoonButton />
                        ) : (
                          <IntegrationCatalogConnectLink href={entry.href!} />
                        )}
                      </div>
                      <div className="integration-catalog-card__foot">
                        <div className="integration-catalog-card__tags" aria-label={`${entry.name} categories`}>
                          {entry.tags.map((tag) => (
                            <span key={tag} className="integration-catalog-card__tag">
                              {tag}
                            </span>
                          ))}
                        </div>
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
