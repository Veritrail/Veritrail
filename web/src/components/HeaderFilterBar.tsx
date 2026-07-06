import type { ReactNode } from "react";

import { AppCommandBar } from "./AppCommandBar";

/** App header filter row — pill selector cards in a horizontal row. */
export function HeaderFilterBar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <AppCommandBar className={["header-filter-bar", className].filter(Boolean).join(" ")}>
      {children}
    </AppCommandBar>
  );
}
