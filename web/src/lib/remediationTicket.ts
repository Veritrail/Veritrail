export type RemediationTicket = { issue_key: string; issue_url: string };

type FindingTicketSource = {
  evidence?: unknown;
  remediation_ticket_key?: string | null;
  remediation_ticket_url?: string | null;
};

function isGithubTicketUrl(url: string): boolean {
  return /github\.com/i.test(url);
}

function isJiraTicketUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes("atlassian.net") || lower.includes("/browse/");
}

/** Derive linked Jira/GitHub remediation tickets from finding columns + evidence. */
export function extractRemediationTickets(finding: FindingTicketSource): {
  jira: RemediationTicket | null;
  github: RemediationTicket | null;
} {
  const evidence = finding.evidence as
    | {
        jira?: { issue_key?: string; issue_url?: string };
        github_issue?: { issue_key?: string; issue_url?: string };
        iac_remediation_ticket?: { issue_key?: string; issue_url?: string };
      }
    | undefined;

  let jira: RemediationTicket | null = null;
  let github: RemediationTicket | null = null;

  const storedGithub = evidence?.iac_remediation_ticket ?? evidence?.github_issue;
  if (storedGithub?.issue_key && storedGithub.issue_url) {
    github = { issue_key: storedGithub.issue_key, issue_url: storedGithub.issue_url };
  }

  const storedJira = evidence?.jira;
  if (storedJira?.issue_key && storedJira.issue_url) {
    jira = { issue_key: storedJira.issue_key, issue_url: storedJira.issue_url };
    return { jira, github };
  }

  if (finding.remediation_ticket_key && finding.remediation_ticket_url) {
    const ticket = {
      issue_key: finding.remediation_ticket_key,
      issue_url: finding.remediation_ticket_url,
    };
    if (isGithubTicketUrl(finding.remediation_ticket_url)) {
      github = ticket;
    } else {
      jira = ticket;
    }
  }

  return { jira, github };
}

export function hasRemediationTicket(finding: FindingTicketSource): boolean {
  const { jira, github } = extractRemediationTickets(finding);
  return !!(jira || github);
}

export { isGithubTicketUrl, isJiraTicketUrl };
