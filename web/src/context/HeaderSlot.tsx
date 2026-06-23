import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** DOM node for the app-wide header bar's left region (set by Layout). */
export const HeaderSlotContext = createContext<HTMLElement | null>(null);

/**
 * Render `children` into the app-wide header bar, left of the notifications
 * bell. Pages use this so their top controls (account picker, filters, account
 * switcher) sit on the bell's row instead of opening a new row below it — which
 * otherwise left dead space above the page content.
 */
export function HeaderSlot({ children }: { children: ReactNode }) {
  const el = useContext(HeaderSlotContext);
  return el ? createPortal(children, el) : null;
}
