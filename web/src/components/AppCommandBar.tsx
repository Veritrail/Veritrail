import type { ReactNode } from "react";

export function AppCommandBar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={["veritrail-command-bar", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
