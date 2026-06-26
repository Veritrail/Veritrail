import type { ReactNode } from "react";

/** Full-width page column inside Layout's padded main area. */
export function ProductShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex w-full min-w-0 max-w-none flex-col ${className}`}>{children}</div>;
}
