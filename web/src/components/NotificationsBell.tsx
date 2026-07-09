import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  useRecheckNotifications,
  type CloudTrailNotification,
  type NotificationItem,
} from "../context/RecheckNotificationsContext";
import { friendlyPolicyGenerationError } from "../lib/policyGenerationErrors";
import {
  friendlyScanFailureMessage,
  scanFailureNotificationTitle,
  scanFailureUserAction,
} from "../lib/scanFailureMessages";
import { checkLabels } from "../data/checkLabels";

function formatWhen(ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function cloudTrailTitle(item: CloudTrailNotification): string {
  if (item.status === "running") return "CloudTrail Analyzes running";
  if (item.status === "succeeded") return "CloudTrail Analyzes complete";
  return "CloudTrail Analyzes failed";
}

function cloudTrailBody(item: CloudTrailNotification): string {
  if (item.message) return friendlyPolicyGenerationError(item.message);
  if (item.status === "running") return "~15 min · resource ARNs · IAM unchanged until you apply";
  if (item.status === "succeeded") return "Rebuild suggestion to apply resource ARNs.";
  return "Could not complete analysis for this role.";
}

function itemStyles(item: NotificationItem): string {
  if (item.kind === "scan_failure") return "border-red-100 bg-red-50/90";
  if (item.kind === "cloudtrail") {
    if (item.status === "running") return "border-indigo-100 bg-indigo-50/80";
    if (item.status === "succeeded") return "border-emerald-100 bg-emerald-50/90";
    return "border-amber-100 bg-amber-50/90";
  }
  return item.status === "verified" ? "border-emerald-100 bg-emerald-50/90" : "border-amber-100 bg-amber-50/90";
}

function itemTitle(item: NotificationItem): string {
  if (item.kind === "scan_failure") {
    return scanFailureNotificationTitle(item.accountLabel, item.provider);
  }
  if (item.kind === "cloudtrail") return cloudTrailTitle(item);
  return item.status === "verified" ? "Verified" : "Still open";
}

function itemBody(item: NotificationItem): string {
  if (item.kind === "scan_failure") {
    return friendlyScanFailureMessage(item.message, {
      provider: item.provider,
      accountLabel: item.accountLabel,
    });
  }
  if (item.kind === "cloudtrail") return cloudTrailBody(item);
  return item.status === "verified"
    ? "Re-check passed — finding resolved."
    : "Verify finished — issue still detected.";
}

function itemSubtitle(item: NotificationItem): string {
  if (item.kind === "scan_failure") return scanFailureUserAction(item.provider);
  if (item.kind === "cloudtrail") return item.roleLabel;
  return checkLabels[item.checkId] ?? item.checkId;
}

function titleColor(item: NotificationItem): string {
  if (item.kind === "scan_failure") return "text-red-950";
  if (item.kind === "cloudtrail") {
    if (item.status === "running") return "text-indigo-950";
    if (item.status === "succeeded") return "text-emerald-950";
    return "text-amber-950";
  }
  return item.status === "verified" ? "text-emerald-950" : "text-amber-950";
}

function isNotificationError(item: NotificationItem): boolean {
  if (item.kind === "scan_failure") return true;
  return item.kind === "cloudtrail" && item.status === "failed";
}

function isNotificationSuccess(item: NotificationItem): boolean {
  if (item.kind === "verify" && item.status === "verified") return true;
  return item.kind === "cloudtrail" && item.status === "succeeded";
}

type BellTone = "error" | "success" | "neutral";

function bellToneFromHistory(items: NotificationItem[]): BellTone {
  if (items.some(isNotificationError)) return "error";
  if (items.some(isNotificationSuccess)) return "success";
  return "neutral";
}

const BELL_ICON_CLASS: Record<BellTone, string> = {
  error: "text-red-600",
  success: "text-emerald-600",
  neutral: "text-zinc-600",
};

const BELL_BADGE_CLASS: Record<BellTone, string> = {
  error: "bg-red-600",
  success: "bg-emerald-600",
  neutral: "bg-blue-600",
};

export default function NotificationsBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);
  const {
    pendingRecheck,
    pendingCloudTrail,
    notificationHistory,
    notificationCount,
    dismissNotification,
    clearAll,
  } = useRecheckNotifications();

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setPanelPos(null);
      return;
    }
    const update = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      setPanelPos({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      const panel = document.getElementById("veritrail-notifications-panel");
      if (panel?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function viewFinding(findingId: string) {
    setOpen(false);
    navigate(`/findings?finding=${encodeURIComponent(findingId)}`);
  }

  const historyVisible = notificationHistory.filter(
    (h) =>
      !(
        h.kind === "cloudtrail" &&
        h.status === "running" &&
        pendingCloudTrail?.notificationId === h.id
      ),
  );

  const hasItems = pendingRecheck || pendingCloudTrail || historyVisible.length > 0;
  const unreadHistory = historyVisible.filter((h) => !h.readAt);
  const bellTone =
    notificationCount > 0 ? bellToneFromHistory(unreadHistory) : "neutral";
  const panel =
    open && panelPos
      ? createPortal(
          <div
            id="veritrail-notifications-panel"
            className="veritrail-popover-panel fixed z-[200] w-[min(38rem,calc(100vw-1.5rem))] overflow-hidden"
            style={{ top: panelPos.top, right: panelPos.right }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
              <p className="text-sm font-semibold text-zinc-900">Notifications</p>
              {notificationHistory.length > 0 && (
                <button
                  type="button"
                  onClick={() => clearAll()}
                  className="text-xs font-medium text-zinc-500 hover:text-zinc-800"
                >
                  Clear log
                </button>
              )}
            </div>
            <div className="min-h-[16rem] max-h-[min(36rem,calc(100vh-6rem))] overflow-y-auto overscroll-contain px-4 py-4">
              {!hasItems && (
                <p className="px-1 py-8 text-center text-sm text-zinc-500">No notifications right now.</p>
              )}
              {pendingRecheck && (
                <div className="mb-3 rounded-lg border border-indigo-100 bg-indigo-50/80 px-4 py-3.5">
                  <div className="flex items-start gap-2.5">
                    <Spinner />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-indigo-950">Verifying</p>
                      <p className="mt-1.5 text-sm leading-relaxed text-indigo-900/85">
                        {checkLabels[pendingRecheck.checkId] ?? pendingRecheck.checkId}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => viewFinding(pendingRecheck.findingId)}
                    className="mt-3 text-sm font-semibold text-indigo-700 hover:text-indigo-900"
                  >
                    View finding
                  </button>
                </div>
              )}
              {pendingCloudTrail && (
                <div className="mb-3 rounded-lg border border-indigo-100 bg-indigo-50/80 px-4 py-3.5">
                  <div className="flex items-start gap-2.5">
                    <Spinner />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-indigo-950">CloudTrail Analyzes</p>
                      <p className="mt-1.5 text-sm leading-relaxed text-indigo-900/85">
                        ~15 min · checking AWS job status
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => viewFinding(pendingCloudTrail.findingId)}
                    className="mt-3 text-sm font-semibold text-indigo-700 hover:text-indigo-900"
                  >
                    View finding
                  </button>
                </div>
              )}
              {historyVisible.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onView={() => {
                    if (item.kind === "scan_failure") {
                      setOpen(false);
                      navigate("/accounts");
                      return;
                    }
                    viewFinding(item.findingId);
                  }}
                  onDismiss={() => dismissNotification(item.id)}
                />
              ))}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`veritrail-header-action${notificationCount > 0 ? ` veritrail-header-action--${bellTone}` : ""}`}
        aria-label={notificationCount ? `${notificationCount} notifications` : "Notifications"}
        aria-expanded={open}
      >
        <span className={`veritrail-header-action__icon-wrap ${BELL_ICON_CLASS[bellTone]}`}>
          <svg className="veritrail-header-action__icon" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
            />
          </svg>
          {notificationCount > 0 && (
            <span
              className={`veritrail-header-action__badge ${BELL_BADGE_CLASS[bellTone]}`}
            >
              {notificationCount > 9 ? "9+" : notificationCount}
            </span>
          )}
        </span>
      </button>
      {panel}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function NotificationRow({
  item,
  onView,
  onDismiss,
}: {
  item: NotificationItem;
  onView: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className={`mb-3 rounded-lg border px-4 py-3.5 last:mb-0 ${itemStyles(item)} ${item.readAt ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <p className={`text-sm font-semibold leading-snug ${titleColor(item)}`}>{itemTitle(item)}</p>
        <span className="shrink-0 pt-0.5 text-xs font-medium text-zinc-500">{formatWhen(item.completedAt)}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 break-words">{itemBody(item)}</p>
      <p className="mt-2.5 text-sm font-medium leading-snug text-zinc-800">{itemSubtitle(item)}</p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {item.kind === "scan_failure" ? (
          <button type="button" onClick={onView} className="text-sm font-semibold text-zinc-800 underline hover:text-zinc-950">
            Open Accounts
          </button>
        ) : (
          <button type="button" onClick={onView} className="text-sm font-semibold text-zinc-800 underline hover:text-zinc-950">
            View finding
          </button>
        )}
        {!item.readAt && (
          <button type="button" onClick={onDismiss} className="text-sm font-medium text-zinc-500 hover:text-zinc-800">
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
