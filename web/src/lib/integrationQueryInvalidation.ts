import type { QueryClient } from "@tanstack/react-query";

type IntegrationComplianceCacheOptions = {
  /** Integration status query key, e.g. ["okta-integration"] or ["integration", "entra"]. */
  integrationStatusKey?: readonly unknown[];
  /** GitHub/GitLab scope-repos API path used as a query key prefix. */
  scopeReposPath?: string;
  /** After sync, briefly refresh scan-run-latest (not used on disconnect). */
  refreshScanRunLatest?: boolean;
};

/** Invalidate queries Compliance, Findings, and composite grading depend on. */
export function invalidateIntegrationComplianceCaches(
  qc: QueryClient,
  options: IntegrationComplianceCacheOptions = {},
): void {
  const { integrationStatusKey, scopeReposPath, refreshScanRunLatest } = options;

  if (integrationStatusKey) {
    void qc.invalidateQueries({ queryKey: [...integrationStatusKey] });
  }
  if (scopeReposPath) {
    void qc.invalidateQueries({ queryKey: [scopeReposPath] });
  }

  void qc.invalidateQueries({ queryKey: ["findings"] });
  void qc.invalidateQueries({ queryKey: ["findings-snapshot-all"] });
  void qc.invalidateQueries({ queryKey: ["controls"] });
  void qc.invalidateQueries({ queryKey: ["compliance-hero"] });
  void qc.invalidateQueries({ queryKey: ["evidence-coverage"] });

  if (refreshScanRunLatest) {
    setTimeout(() => void qc.invalidateQueries({ queryKey: ["scan-run-latest"] }), 300);
  }
}
