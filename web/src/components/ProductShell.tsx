import type { ReactNode } from "react";

/** Left-aligned content column inside the app main area (not centered). */
export function ProductShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`w-full min-w-0 max-w-none ${className}`}>{children}</div>;
}
