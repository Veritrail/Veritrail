import { useRef, type ComponentType } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppScrollMargin } from "../hooks/useAppScrollMargin";
import type { FindingDrawerTab } from "./FindingDrawer";

const APP_SCROLL_SELECTOR = "[data-app-scroll]";

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
  FindingRow: ComponentType<FindingRowProps>;
  keyPrefix?: string;
  className?: string;
};

/** Virtualized list of finding group rows — keeps DOM small for large accounts. */
export function VirtualizedFindingsGroups({
  groups,
  expandedCheckIds,
  toggleExpandedCheck,
  onReview,
  FindingRow,
  keyPrefix = "",
  className = "",
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useAppScrollMargin(parentRef);
  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => document.querySelector<HTMLElement>(APP_SCROLL_SELECTOR),
    estimateSize: () => 56,
    overscan: 8,
    scrollMargin,
  });

  if (groups.length === 0) return null;

  return (
    <div ref={parentRef} className={className}>
      <div style={{ position: "relative", height: virtualizer.getTotalSize() }}>
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
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
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
    </div>
  );
}
