import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

export function ConnectShellHeader({
  title,
  subtitle,
  className,
  actions,
}: {
  title: string;
  subtitle: string;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={`accounts-connect-shell__header${className ? ` ${className}` : ""}`}>
      <div className="accounts-connect-shell__header-copy">
        <h2 className="accounts-connect-shell__title">{title}</h2>
        <p className="accounts-connect-shell__subtitle">{subtitle}</p>
      </div>
      {actions ? <div className="accounts-connect-shell__header-actions">{actions}</div> : null}
    </div>
  );
}

export function CloudConnectOverlay({
  onDismiss,
  children,
  ariaLabelledBy,
}: {
  onDismiss: () => void;
  children: ReactNode;
  ariaLabelledBy?: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return createPortal(
    <div
      className="accounts-onboarding-modal"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        className="accounts-onboarding-modal__panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function CloudConnectShell({
  title,
  subtitle,
  headerActions,
  children,
  footer,
  embedded = false,
  showSuccess = false,
  successTitle = "Connected",
  successCopy = "Initial scan started. Closing setup...",
}: {
  title: string;
  subtitle: string;
  headerActions?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  embedded?: boolean;
  showSuccess?: boolean;
  successTitle?: string;
  successCopy?: string;
}) {
  return (
    <div
      className={`accounts-connect-shell accounts-connect-shell--deploy-review${
        embedded ? " accounts-connect-shell--embedded" : ""
      }`}
    >
      {showSuccess ? (
        <div className="accounts-connect-success" role="status" aria-live="polite">
          <div className="accounts-connect-success__icon" aria-hidden>
            <span />
            <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="accounts-connect-success__title">{successTitle}</p>
          <p className="accounts-connect-success__copy">{successCopy}</p>
        </div>
      ) : null}
      <div className="accounts-connect-shell__layout">
        <div className="accounts-connect-shell__main">
          <ConnectShellHeader
            title={title}
            subtitle={subtitle}
            className="accounts-connect-shell__header--verify"
            actions={headerActions}
          />
          {children}
          <div className="accounts-connect-shell__footer accounts-connect-shell__footer--verify">{footer}</div>
        </div>
      </div>
    </div>
  );
}
