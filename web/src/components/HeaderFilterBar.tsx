import { Children, Fragment, type ReactNode } from "react";

import { AppCommandBar } from "./AppCommandBar";

/**
 * App header filter row — flat inline values (icon + value, no pill boxes).
 * Use `showAccountSeparator` on History only for the divider after account.
 */
export function HeaderFilterBar({
  children,
  className = "",
  showAccountSeparator = false,
}: {
  children: ReactNode;
  className?: string;
  showAccountSeparator?: boolean;
}) {
  const items = Children.toArray(children);

  return (
    <AppCommandBar
      className={["header-filter-bar", "header-filter-bar--inline", className].filter(Boolean).join(" ")}
    >
      {items.map((child, index) => (
        <Fragment key={index}>
          {child}
          {showAccountSeparator && index === 0 && items.length > 1 ? (
            <span className="header-filter-divider" aria-hidden />
          ) : null}
        </Fragment>
      ))}
    </AppCommandBar>
  );
}
