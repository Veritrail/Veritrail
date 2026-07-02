import { useLayoutEffect, useState, type RefObject } from "react";

const APP_SCROLL_SELECTOR = "[data-app-scroll]";

/** Offset of `el` from the top of the app scroll pane — stable while scrolling. */
function appScrollMargin(el: HTMLElement, scrollRoot: HTMLElement): number {
  const rootRect = scrollRoot.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  return elRect.top - rootRect.top + scrollRoot.scrollTop;
}

/** Scroll margin for `@tanstack/react-virtual` when the list lives inside the app scroll pane. */
export function useAppScrollMargin(ref: RefObject<HTMLElement | null>) {
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
