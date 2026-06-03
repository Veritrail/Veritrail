import { useEffect } from "react";

const SCROLL_ROOT_SELECTOR = "[data-app-scroll]";

/** Lock app scroll without overflow:hidden on html (breaks sticky/fixed sidebars). */
export function useAppScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    const scrollRoot = document.querySelector<HTMLElement>(SCROLL_ROOT_SELECTOR);
    const body = document.body;
    const windowScrollY = window.scrollY;

    const saved = {
      rootTop: scrollRoot?.scrollTop ?? 0,
      rootOverflow: scrollRoot?.style.overflow ?? "",
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      bodyPaddingRight: body.style.paddingRight,
    };

    if (scrollRoot) {
      scrollRoot.style.overflow = "hidden";
    }

    if (windowScrollY > 0) {
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      body.style.position = "fixed";
      body.style.top = `-${windowScrollY}px`;
      body.style.left = "0";
      body.style.right = "0";
      body.style.width = "100%";
      if (scrollbarWidth > 0) {
        body.style.paddingRight = `${scrollbarWidth}px`;
      }
    }

    return () => {
      if (scrollRoot) {
        scrollRoot.style.overflow = saved.rootOverflow;
        scrollRoot.scrollTop = saved.rootTop;
      }
      if (windowScrollY > 0) {
        body.style.position = saved.bodyPosition;
        body.style.top = saved.bodyTop;
        body.style.left = saved.bodyLeft;
        body.style.right = saved.bodyRight;
        body.style.width = saved.bodyWidth;
        body.style.paddingRight = saved.bodyPaddingRight;
        window.scrollTo(0, windowScrollY);
      }
    };
  }, [locked]);
}
