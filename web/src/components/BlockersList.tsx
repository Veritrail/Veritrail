import { Link } from "react-router-dom";
import { labelForCheck } from "../data/checkLabels";
import type { BlockerGroup } from "../lib/orgReadinessBlockers";
import { daysAgo } from "../lib/findingDisplay";

type BlockersListProps = {
  groups: BlockerGroup[];
  totalHighCount: number;
  findingsHref: (checkId: string) => string;
  defaultFindingsHref: string;
};

export function BlockersList({
  groups,
  totalHighCount,
  findingsHref,
  defaultFindingsHref,
}: BlockersListProps) {
  if (groups.length === 0) return null;

  return (
    <div className="org-home__blockers-card">
      {groups.map((group, index) => {
        const metaParts = [
          ...(group.firstSeen ? [daysAgo(group.firstSeen)] : []),
          ...(group.location ? [group.location] : []),
          ...(group.failingControlIds.length > 0
            ? [group.failingControlIds.join(", ")]
            : group.soc2ControlIds.length > 0
              ? [group.soc2ControlIds.join(", ")]
              : []),
          `${group.count} finding${group.count === 1 ? "" : "s"}`,
        ];
        return (
          <div key={group.checkId} className="org-home__blocker-row">
            <span className="org-home__blocker-rank" aria-hidden>
              {index + 1}
            </span>
            <div className="org-home__blocker-copy">
              <p className="org-home__blocker-title">{labelForCheck(group.checkId)}</p>
              <p className="org-home__blocker-meta">{metaParts.join(" · ")}</p>
            </div>
            <span className={`org-home__severity-chip is-${group.severity}`}>
              {group.severity}
            </span>
            <Link
              to={findingsHref(group.checkId) ?? defaultFindingsHref}
              className="org-home__review-btn"
            >
              Review <span aria-hidden>→</span>
            </Link>
          </div>
        );
      })}
      <div className="org-home__blockers-footer">
        <Link to={defaultFindingsHref} className="org-home__section-link">
          View all {totalHighCount} high finding{totalHighCount === 1 ? "" : "s"}{" "}
          <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}
