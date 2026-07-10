export const FRAMEWORKS = [
  { id: "soc2", label: "SOC 2", fullLabel: "SOC 2 Trust Services Criteria" },
  {
    id: "cis_aws_l1",
    label: "CIS AWS L1",
    fullLabel: "CIS AWS Foundations — selected controls (not full benchmark parity)",
  },
  { id: "iso27001", label: "ISO 27001", fullLabel: "ISO 27001 Annex A" },
] as const;

export type FrameworkId = (typeof FRAMEWORKS)[number]["id"];

export function frameworkLabel(id: string): string {
  return FRAMEWORKS.find((f) => f.id === id)?.label ?? id;
}
