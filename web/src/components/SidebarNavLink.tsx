import { NavLink, type NavLinkProps } from "react-router-dom";
import type { ReactNode } from "react";

type Props = Omit<NavLinkProps, "className"> & {
  children: ReactNode;
};

export function sidebarNavClass({ isActive }: { isActive: boolean }) {
  return `app-sidebar__link${isActive ? " is-active" : ""}`;
}

export default function SidebarNavLink({ children, ...props }: Props) {
  return (
    <NavLink className={sidebarNavClass} {...props}>
      {children}
    </NavLink>
  );
}
