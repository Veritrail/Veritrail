import { extractRemediationTickets, type RemediationTicket } from "./remediationTicket";

export const FINDING_RESOURCE_BULK_CAP = 50;

type TicketSource = {
  id: string;
  evidence?: unknown;
  remediation_ticket_key?: string | null;
  remediation_ticket_url?: string | null;
};

export function findingHasJiraTicket(finding: TicketSource): boolean {
  return !!extractRemediationTickets(finding).jira;
}

export function partitionJiraEligibleFindingIds(findings: TicketSource[]): {
  eligible: string[];
  skippedAlreadyLinked: string[];
} {
  const eligible: string[] = [];
  const skippedAlreadyLinked: string[] = [];
  for (const finding of findings) {
    if (findingHasJiraTicket(finding)) {
      skippedAlreadyLinked.push(finding.id);
    } else {
      eligible.push(finding.id);
    }
  }
  return { eligible, skippedAlreadyLinked };
}

export type BulkJiraCombinedResult = {
  issue: RemediationTicket;
  linkedCount: number;
  skippedAlreadyLinked: string[];
};

export type BulkJiraSeparateResult = {
  succeeded: number;
  failed: number;
  skippedAlreadyLinked: string[];
};
