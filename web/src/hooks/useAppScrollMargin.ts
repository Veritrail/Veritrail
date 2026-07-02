import { useCallback, useLayoutEffect, useState } from "react";

const APP_SCROLL_SELECTOR = "[data-app-scroll]";

/** Offset of `el` from the top of the app scroll pane — stable while scrolling. */
function appScrollMargin(el: HTMLElement, scrollRoot: HTMLElement): number {
  const rootRect = scrollRoot.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  return elRect.top - rootRect.top + scrollRoot.scrollTop;
}

/** Scroll margin for `@tanstack/react-virtual` when the list lives inside the app scroll pane. */
export function useAppScrollMargin() {
  const [scrollMargin, setScrollMargin] = useState(0);
  const [el, setEl] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const scrollRoot = document.querySelector<HTMLElement>(APP_SCROLL_SELECTOR);
    if (!el || !scrollRoot) {
      setScrollMargin(0);
      return;
    }

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
  }, [el]);

  const ref = useCallback((node: HTMLElement | null) => {
    setEl(node);
  }, []);

  return { ref, scrollMargin };
}
