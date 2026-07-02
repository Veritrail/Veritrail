import { forwardRef, type ReactNode } from "react";

type DrawerSize = "sm" | "md" | "lg" | "xl";

const DRAWER_WIDTH: Record<DrawerSize, string> = {
  sm: "max-w-[min(100vw,32rem)]",
  md: "max-w-[min(100vw,40rem)]",
  lg: "max-w-[min(100vw,44rem)]",
  xl: "max-w-[min(96vw,80rem)]",
};

export const DrawerShell = forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    onClose: () => void;
    labelledBy: string;
    size?: DrawerSize;
    widthClassName?: string;
    panelClassName?: string;
    backdropClassName?: string;
    backdropZIndexClassName?: string;
    panelZIndexClassName?: string;
  }
>(function DrawerShell(
  {
    children,
    onClose,
    labelledBy,
    size = "md",
    widthClassName,
    panelClassName = "",
    backdropClassName = "",
    backdropZIndexClassName = "z-[100]",
    panelZIndexClassName = "z-[110]",
  },
  ref,
) {
  return (
    <>
      <div
        className={["vt-drawer-backdrop", backdropZIndexClassName, backdropClassName]
          .filter(Boolean)
          .join(" ")}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        className={[
          "vt-drawer-panel",
          panelZIndexClassName,
          widthClassName ?? DRAWER_WIDTH[size],
          panelClassName,
        ]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </>
  );
});
