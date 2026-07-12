import { useState, type ReactNode, type WheelEvent } from "react";

export type ConnectValidateItem = { title: string; desc: string };

export type ConnectValidateItemState = "pending" | "running" | "success" | "error";

export function connectValidateItemState(
  index: number,
  verify: { isPending: boolean; isSuccess: boolean; isError: boolean },
  activeIndex = 0,
): ConnectValidateItemState {
  if (verify.isPending) {
    if (index < activeIndex) return "success";
    if (index === activeIndex) return "running";
    return "pending";
  }
  if (verify.isSuccess) return "success";
  if (verify.isError) return index === 0 ? "error" : "pending";
  return "pending";
}

export function CloudConnectField({
  label,
  value,
  readOnly = true,
  placeholder,
  onChange,
  helper,
  formatHint,
  status,
  type = "text",
}: {
  label: string;
  value: string;
  readOnly?: boolean;
  placeholder?: string;
  onChange?: (v: string) => void;
  helper?: string;
  formatHint?: string;
  status?: "idle" | "pending" | "success" | "error";
  type?: "text" | "password";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const validationState =
    status === "success"
      ? "is-success"
      : status === "error"
        ? "is-error"
        : status === "pending"
          ? "is-pending"
          : "";

  return (
    <div className="accounts-connect-field">
      <label className="accounts-connect-field__label">{label}</label>
      {helper ? <p className="accounts-connect-field__helper">{helper}</p> : null}
      <div
        className={`accounts-connect-field__input${!readOnly ? " accounts-connect-field__input--editable" : ""}${
          validationState ? ` ${validationState}` : ""
        }`}
      >
        <input
          type={type}
          readOnly={readOnly}
          value={value}
          placeholder={placeholder}
          onChange={readOnly ? undefined : (e) => onChange?.(e.target.value)}
        />
        {readOnly ? (
          <button type="button" onClick={() => void copy()} className={copied ? "is-copied" : ""}>
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
      {formatHint ? <p className="accounts-connect-field__format">{formatHint}</p> : null}
      {status === "success" ? (
        <p className="accounts-connect-field__status accounts-connect-field__status--success">Verified</p>
      ) : null}
      {status === "error" ? (
        <p className="accounts-connect-field__status accounts-connect-field__status--error">Verification failed</p>
      ) : null}
      {status === "pending" ? (
        <p className="accounts-connect-field__status accounts-connect-field__status--pending">Verifying connection…</p>
      ) : null}
    </div>
  );
}

export function CloudConnectCodeBlock({
  value,
  label,
  rows = 8,
}: {
  value: string;
  label: string;
  rows?: number;
}) {
  const [copied, setCopied] = useState(false);

  function containWheel(event: WheelEvent<HTMLElement>) {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      event.stopPropagation();
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="accounts-connect-code-block">
      <label className="accounts-connect-field__label">{label}</label>
      <pre className="accounts-code-scroll" onWheel={containWheel}>
        <code>{value}</code>
      </pre>
      <button type="button" className="accounts-connect-shell__back" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy commands"}
      </button>
    </div>
  );
}

export function CloudConnectValidateColumn({
  items,
  verify,
  verifyActiveIndex,
  ready,
  idle,
}: {
  items: readonly ConnectValidateItem[];
  verify: { isPending: boolean; isSuccess: boolean; isError: boolean };
  verifyActiveIndex: number;
  ready: boolean;
  idle: boolean;
}) {
  return (
    <section
      className={`accounts-connect-col accounts-connect-col--verify${
        idle ? " accounts-connect-col--verify-idle" : ""
      }${ready && !verify.isPending && !verify.isSuccess ? " accounts-connect-col--verify-ready" : ""}`}
    >
      <header className="accounts-connect-col__head">
        <span className="accounts-connect-col__num">3</span>
        <h3 className="accounts-connect-col__title">Verify access</h3>
        {verify.isSuccess || verify.isPending ? (
          <span
            className={`accounts-connect-col__pill${
              verify.isSuccess
                ? " accounts-connect-col__pill--verified"
                : verify.isPending
                  ? " accounts-connect-col__pill--testing"
                  : ""
            }`}
          >
            {verify.isSuccess ? "Verified" : "Testing..."}
          </span>
        ) : null}
      </header>
      <p className="accounts-connect-col__lede">Before saving the account, Veritrail will validate:</p>
      <ul className="accounts-validate accounts-validate--timeline">
        {items.map((item, index) => {
          const state = connectValidateItemState(index, verify, verifyActiveIndex);
          return (
            <li
              key={item.title}
              className={`accounts-validate__item accounts-validate__item--${state}${
                index < items.length - 1 ? " accounts-validate__item--has-line" : ""
              }`}
            >
              <span className="accounts-validate__marker" aria-hidden>
                {state === "running" ? (
                  <span className="accounts-validate__spinner" />
                ) : state === "success" ? (
                  <svg fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : state === "error" ? (
                  <svg fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : null}
              </span>
              <div>
                <p className="accounts-validate__title">{item.title}</p>
                <p className="accounts-validate__desc">{item.desc}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function CloudConnectPermissionsReview({
  open,
  onToggle,
  title,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="accounts-connect-permissions">
      <button
        type="button"
        className="accounts-connect-permissions__toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        {open ? "Hide permissions" : "Review permissions"}
        <svg
          className={`accounts-connect-permissions__chevron${open ? " is-open" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open ? (
        <section className="accounts-connect-permissions__panel" aria-label={title}>
          <h3 className="accounts-connect-permissions__title">{title}</h3>
          {children}
        </section>
      ) : null}
    </div>
  );
}

export function CloudConnectPermissionRows({
  rows,
}: {
  rows: readonly { role: string; scope: string; purpose: string }[];
}) {
  return (
    <div className="accounts-role-rows">
      {rows.map((row) => (
        <div key={row.role} className="accounts-role-row accounts-role-row--blue">
          <span className="accounts-role-row__icon accounts-role-row__icon--blue" aria-hidden>
            <svg fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607Z"
              />
            </svg>
          </span>
          <div className="accounts-role-row__identity">
            <p className="accounts-role-row__name">{row.role}</p>
            <span className="accounts-role-row__meta">
              {row.scope} · {row.purpose}
            </span>
          </div>
          <span className="accounts-role-row__access accounts-connect-drawer__access accounts-connect-drawer__access--blue">
            Read-only
          </span>
        </div>
      ))}
    </div>
  );
}
