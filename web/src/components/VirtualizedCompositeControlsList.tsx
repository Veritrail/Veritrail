import { useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppScrollMargin } from "../hooks/useAppScrollMargin";

const APP_SCROLL_SELECTOR = "[data-app-scroll]";

type Props<T> = {
  items: T[];
  getItemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  estimateSize?: () => number;
  className?: string;
};

/** Virtualized composite control cards — keeps DOM small for long framework lists. */
export function VirtualizedCompositeControlsList<T>({
  items,
  getItemKey,
  renderItem,
  estimateSize = () => 72,
  className = "",
}: Props<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useAppScrollMargin(parentRef);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => document.querySelector<HTMLElement>(APP_SCROLL_SELECTOR),
    estimateSize,
    overscan: 6,
    scrollMargin,
  });

  if (items.length === 0) return null;

  return (
    <div ref={parentRef} className={className}>
      <div style={{ position: "relative", height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          return (
            <div
              key={getItemKey(item, virtualRow.index)}
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
              {renderItem(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
