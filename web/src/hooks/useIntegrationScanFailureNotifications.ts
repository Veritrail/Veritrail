import { useEffect, useRef } from "react";
import { useRecheckNotifications } from "../context/RecheckNotificationsContext";
import { scanFailureAccountLabel } from "../lib/scanFailureMessages";

type IntegrationScanTarget = {
  id: string;
  last_error: string | null;
  last_scan_at?: string | null;
  label?: string | null;
  external_id?: string | null;
  provider?: string | null;
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
        accountLabel: scanFailureAccountLabel({
          label: item.label,
          externalId: item.external_id,
        }),
        provider: item.provider ?? undefined,
        message,
        failedAt: item.last_scan_at ?? null,
      });
    });
  }, [items, reportScanFailure]);
}
