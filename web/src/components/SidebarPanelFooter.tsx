import { useEffect, useState } from "react";

const APP_VERSION = "v2.4.1";
const THEME_STORAGE_KEY = "veritrail-theme";

type SidebarPanelFooterProps = {
  collapsed: boolean;
  onToggleCollapse: () => void;
};

export default function SidebarPanelFooter({ collapsed, onToggleCollapse }: SidebarPanelFooterProps) {
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(THEME_STORAGE_KEY) !== "light";
  });

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, darkMode ? "dark" : "light");
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
  }, [darkMode]);

  return (
    <div className={`sidebar-panel-footer${collapsed ? " is-collapsed" : ""}`}>
      <button
        type="button"
        className="sidebar-panel-footer__theme"
        aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        aria-pressed={darkMode}
        onClick={() => setDarkMode((v) => !v)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
          />
        </svg>
      </button>

      <span className="sidebar-panel-footer__version">{APP_VERSION}</span>

      <button
        type="button"
        className="sidebar-panel-footer__collapse"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-pressed={collapsed}
        onClick={onToggleCollapse}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d={collapsed ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"}
          />
        </svg>
      </button>
    </div>
  );
}
