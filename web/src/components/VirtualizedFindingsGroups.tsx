import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FindingDrawerTab } from "./FindingDrawer";

type Finding = {
  id: string;
  check_id: string;
  resource_arn: string;
  title: string;
  severity: string;
  risk_score: number;
  status: string;
  evidence: Record<string, unknown>;
  first_seen: string;
  last_seen: string;
};

type FindingRowProps = {
  groupKey: string;
  items: Finding[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onReview: (items: Finding[], focus?: Finding, tab?: FindingDrawerTab) => void;
};

type Props = {
  groups: [string, Finding[]][];
  expandedCheckIds: Set<string>;
  toggleExpandedCheck: (key: string) => void;
  onReview: (items: Finding[], focus?: Finding, tab?: FindingDrawerTab) => void;
  FindingRow: React.ComponentType<FindingRowProps>;
  keyPrefix?: string;
};

/** Virtualized list of finding group rows — keeps DOM small for large accounts. */
export function VirtualizedFindingsGroups({
  groups,
  expandedCheckIds,
  toggleExpandedCheck,
  onReview,
  FindingRow,
  keyPrefix = "",
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => parentRef.current?.closest(".findings-v2-table") ?? parentRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  if (groups.length === 0) return null;

  return (
    <div ref={parentRef} style={{ position: "relative", height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const [groupKey, items] = groups[virtualRow.index];
        const expandKey = keyPrefix ? `${keyPrefix}${groupKey}` : groupKey;
        return (
          <div
            key={expandKey}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <FindingRow
              groupKey={groupKey}
              items={items}
              expanded={expandedCheckIds.has(expandKey)}
              onToggleExpanded={() => toggleExpandedCheck(expandKey)}
              onReview={onReview}
            />
          </div>
        );
      })}
    </div>
  );
}
