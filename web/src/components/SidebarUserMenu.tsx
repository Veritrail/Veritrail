import { NavLink } from "react-router-dom";
import { logout } from "../api";

const navItem = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-[17px] leading-snug font-medium transition-all ${
    isActive
      ? "bg-[#152033] text-white shadow-sm ring-1 ring-white/10"
      : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100"
  }`;

export default function SidebarUserMenu() {
  return (
    <div className="space-y-0.5">
      <NavLink to="/account" className={navItem}>
        <svg className="h-6 w-6 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        Account
      </NavLink>
      <button
        type="button"
        onClick={() => {
          void logout().finally(() => {
            window.location.href = "/login?signed_out=1";
          });
        }}
        className="flex w-full items-center gap-3.5 rounded-xl px-4 py-3.5 text-[17px] leading-snug font-medium text-slate-500 transition-all hover:bg-white/6 hover:text-slate-100"
      >
        <svg className="h-6 w-6 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Sign out
      </button>
    </div>
  );
}
