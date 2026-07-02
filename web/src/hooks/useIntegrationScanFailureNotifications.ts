import { useEffect, useRef } from "react";
import { useRecheckNotifications } from "../context/RecheckNotificationsContext";

type IntegrationScanTarget = {
  id: string;
  last_error: string | null;
  last_scan_at?: string | null;
};

/** Push integration `last_error` values into the notification bell (once per distinct failure). */
export function useIntegrationScanFailureNotifications(items: IntegrationScanTarget[]) {
  const { reportScanFailure } = useRecheckNotifications();
  const lastReportedRef = useRef<Record<string, string>>({});

  useEffect(() => {
    items.forEach((item) => {
      const message = item.last_error?.trim();
      if (!message) return;
      const failureKey = `${item.last_scan_at ?? ""}:${message}`;
      if (lastReportedRef.current[item.id] === failureKey) return;
      lastReportedRef.current[item.id] = failureKey;
      reportScanFailure({
        accountId: item.id,
        message,
        failedAt: item.last_scan_at ?? null,
      });
    });
  }, [items, reportScanFailure]);
}
