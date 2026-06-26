export type EvidenceSourceEntry = {
  vendor: string;
  owner?: string | null;
  cadence?: string | null;
  scope_description?: string | null;
  source_type?: string | null;
  updated_at?: string | null;
};

export type EvidenceSourceCategory = {
  key: string;
  label: string;
  composite_ids: string[];
  entry: EvidenceSourceEntry | null;
};

export const VULN_ASSET_SCOPES = [
  "Production AWS accounts",
  "Containers & images",
  "Production AWS + containers",
  "All environments",
  "Other",
] as const;

export const VULN_SCAN_CADENCES = [
  "Continuous",
  "Daily",
  "Weekly",
  "Monthly",
  "Quarterly",
  "Ad hoc",
] as const;

export function registryKeyForComposite(compositeId: string): string | null {
  const map: Record<string, string> = {
    identity_governance: "identity_access",
    asset_inventory: "asset_inventory",
    secure_sdlc: "secure_sdlc",
    change_management: "change_management",
    data_protection: "data_protection",
    vulnerability_management: "vulnerability_management",
    container_vulnerability_monitoring: "vulnerability_management",
    logging_monitoring: "logging_monitoring",
    backup_resilience: "backup_resilience",
    endpoint_security: "endpoint_security",
  };
  return map[compositeId] ?? null;
}

export function buildExternalCoverageNote(scope: string, cadence?: string) {
  const cadencePart = cadence?.trim() ? ` Cadence: ${cadence.trim()}.` : "";
  return `Managed outside AWS. Scope: ${scope.trim()}.${cadencePart}`;
}

export function buildExternalWizardTitle(source: string, compositeTitle: string) {
  return `${source.trim()} — ${compositeTitle}`;
}

export function buildVulnWizardNote(scope: string, cadence: string) {
  return `External vulnerability coverage via uploaded proof. Asset scope: ${scope}. Scan cadence: ${cadence}.`;
}

export function buildVulnWizardTitle(vendor: string, compositeTitle: string) {
  return `${vendor} — ${compositeTitle}`.slice(0, 300);
}
