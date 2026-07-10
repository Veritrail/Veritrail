import { Link } from "react-router-dom";
import { labelForCheck } from "../data/checkLabels";
import type { BlockerGroup } from "../lib/orgReadinessBlockers";
import { sourceTagForCheck } from "../lib/orgReadinessBlockers";

type BlockersListProps = {
  groups: BlockerGroup[];
  findingsHref: (checkId: string) => string;
  defaultFindingsHref: string;
};

export function BlockersList({
  groups,
  findingsHref,
  defaultFindingsHref,
}: BlockersListProps) {
  if (groups.length === 0) return null;

  return (
    <div className="org-home__blockers-card">
      {groups.map((group, index) => {
        const sourceTag = sourceTagForCheck(group.checkId);
        const metaParts = [
          `${group.count} finding${group.count === 1 ? "" : "s"}`,
          ...(group.failingControlIds.length > 0
            ? [`unblocks ${group.failingControlIds.join(", ")}`]
            : group.soc2ControlIds.length > 0
              ? [group.soc2ControlIds.join(", ")]
              : []),
          ...(sourceTag ? [sourceTag] : []),
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
            <Link
              to={findingsHref(group.checkId) ?? defaultFindingsHref}
              className="org-home__review-btn"
            >
              Review <span aria-hidden>→</span>
            </Link>
          </div>
        );
      })}
    </div>
  );
}
