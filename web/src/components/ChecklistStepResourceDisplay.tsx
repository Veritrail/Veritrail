import { useMemo, useState } from "react";

export const RESOURCE_FILTER_GROUP_THRESHOLD = 15;

export type NamedResourceRow = { name: string; region: string };

/** Each resource is its own bordered row-card: teal dot · mono name · region pill. */
function ResourceCardList({ rows }: { rows: NamedResourceRow[] }) {
  return (
    <ul className="checklist-step-drawer__resource-cards">
      {rows.map((row) => (
        <li key={`${row.name}:${row.region}`} className="checklist-step-drawer__resource-card">
          <span className="checklist-step-drawer__resource-dot" aria-hidden />
          <span className="checklist-step-drawer__resource-name">{row.name}</span>
          <span className="checklist-step-drawer__resource-region">{row.region}</span>
        </li>
      ))}
    </ul>
  );
}

function ResourceTable({ rows }: { rows: NamedResourceRow[] }) {
  return (
    <div className="checklist-step-drawer__resource-table-wrap">
      <ResourceCardList rows={rows} />
    </div>
  );
}

function GroupedResourceTable({ resources }: { resources: NamedResourceRow[] }) {
  const [filter, setFilter] = useState("");
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(() => new Set());

  const normalizedFilter = filter.trim().toLowerCase();

  const filteredResources = useMemo(() => {
    if (!normalizedFilter) return resources;
    return resources.filter(
      (row) =>
        row.name.toLowerCase().includes(normalizedFilter) ||
        row.region.toLowerCase().includes(normalizedFilter),
    );
  }, [normalizedFilter, resources]);

  const groups = useMemo(() => {
    const byRegion = new Map<string, NamedResourceRow[]>();
    for (const row of filteredResources) {
      const list = byRegion.get(row.region) ?? [];
      list.push(row);
      byRegion.set(row.region, list);
    }
    return [...byRegion.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([region, rows]) => ({
        region,
        rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [filteredResources]);

  const regionCount = useMemo(() => {
    const regions = new Set(resources.map((row) => row.region));
    return regions.size;
  }, [resources]);

  const toggleRegion = (region: string) => {
    setExpandedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });
  };

  return (
    <div className="checklist-step-drawer__resource-grouped">
      <label className="checklist-step-drawer__resource-filter">
        <span className="sr-only">Filter resources or regions</span>
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter resources or regions..."
          className="checklist-step-drawer__resource-filter-input"
        />
      </label>

      {groups.length > 0 ? (
        <div className="checklist-step-drawer__resource-groups">
          {groups.map((group) => {
            const isExpanded = expandedRegions.has(group.region);
            const toggle = () => toggleRegion(group.region);

            return (
              <div
                key={group.region}
                className={`checklist-step-drawer__resource-group${isExpanded ? " is-expanded" : ""}`}
              >
                <button
                  type="button"
                  className="checklist-step-drawer__resource-group-summary"
                  aria-expanded={isExpanded}
                  onClick={toggle}
                >
                  <span
                    className={`compliance-control-card__chevron${isExpanded ? " is-open" : ""}`}
                    aria-hidden
                  >
                    ›
                  </span>
                  <span className="checklist-step-drawer__resource-group-title">{group.region}</span>
                  <span className="checklist-step-drawer__resource-group-count">
                    {group.rows.length}
                  </span>
                </button>

                {isExpanded ? (
                  <div className="checklist-step-drawer__resource-group-body">
                    <ResourceCardList rows={group.rows} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="checklist-step-drawer__muted">No resources match this filter.</p>
      )}

      <p className="checklist-step-drawer__resource-footer">
        Showing {filteredResources.length} of {resources.length} across {regionCount}{" "}
        {regionCount === 1 ? "region" : "regions"}
      </p>
    </div>
  );
}

export function ChecklistStepResourceDisplay({ resources }: { resources: NamedResourceRow[] }) {
  if (resources.length > RESOURCE_FILTER_GROUP_THRESHOLD) {
    return <GroupedResourceTable resources={resources} />;
  }
  return <ResourceTable rows={resources} />;
}
