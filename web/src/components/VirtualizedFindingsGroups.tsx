import { useLayoutEffect, useRef, useState, type ComponentType, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FindingDrawerTab } from "./FindingDrawer";

const APP_SCROLL_SELECTOR = "[data-app-scroll]";

/** Offset of `el` from the top of the app scroll pane — stable while scrolling. */
function appScrollMargin(el: HTMLElement, scrollRoot: HTMLElement): number {
  const rootRect = scrollRoot.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  return elRect.top - rootRect.top + scrollRoot.scrollTop;
}

function useAppScrollMargin(ref: RefObject<HTMLElement | null>) {
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    const scrollRoot = document.querySelector<HTMLElement>(APP_SCROLL_SELECTOR);
    if (!el || !scrollRoot) return;

    const update = () => setScrollMargin(appScrollMargin(el, scrollRoot));

    update();
    const ro = new ResizeObserver(update);
    ro.observe(scrollRoot);
    ro.observe(el);
    scrollRoot.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      ro.disconnect();
      scrollRoot.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [ref]);

  return scrollMargin;
}

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
    </div>
  );
}
