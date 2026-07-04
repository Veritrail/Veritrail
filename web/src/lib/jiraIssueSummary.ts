import { displayFindingTitle, resourceName } from "./findingDisplay";

const VERITRAIL_PREFIX = "[Veritrail]";

const EMBEDDED_RESOURCE_RE = /^(.+?)\s+[`']([^`']+)[`'](.*)$/s;
const NAME_BOUNDARY_RE = (name: string) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");

function namesMatch(embeddedName: string, shortName: string): boolean {
  return embeddedName === shortName || embeddedName.toLowerCase() === shortName.toLowerCase();
}

function cleanDetail(rest: string): string {
  return rest.replace(/^\s*—\s*/, "").trim();
}

function parseEmbeddedTitle(title: string): { titleType: string; embeddedName: string; detail: string } | null {
  const match = title.match(EMBEDDED_RESOURCE_RE);
  if (!match) return null;
  return {
    titleType: match[1].trim(),
    embeddedName: match[2].trim(),
    detail: cleanDetail(match[3]),
  };
}

function violationSummaryFromCheck(checkId: string): string {
  if (checkId.includes("least_privilege")) {
    return "Least privilege violation";
  }
  const parts = checkId.split(".");
  if (parts.length >= 2) {
    const noun = parts[parts.length - 1].replace(/_/g, " ");
    if (noun) {
      return noun.charAt(0).toUpperCase() + noun.slice(1);
    }
  }
  return "Security finding";
}

function extractViolationSummary(detail: string, checkId: string): string {
  const text = detail.trim();
  if (!text) return violationSummaryFromCheck(checkId);
  if (text.toLowerCase().startsWith("least privilege violation")) {
    return "Least privilege violation";
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function violationFromDisplayTitle(displayTitle: string, shortName: string, checkId: string): string {
  const match = displayTitle.match(NAME_BOUNDARY_RE(shortName));
  if (match && match.index !== undefined && match.index > 0) {
    const after = cleanDetail(displayTitle.slice(match.index + match[0].length));
    if (after) {
      return extractViolationSummary(after, checkId);
    }
  }
  return extractViolationSummary(displayTitle, checkId);
}

export function buildJiraIssueSummary(finding: {
  check_id: string;
  resource_arn: string;
  title: string;
}): string {
  const shortName = resourceName(finding.resource_arn);
  const displayTitle = displayFindingTitle(finding.title).trim();

  const parsed = parseEmbeddedTitle(displayTitle);
  if (parsed && namesMatch(parsed.embeddedName, shortName)) {
    const violation = extractViolationSummary(parsed.detail, finding.check_id);
    return `${VERITRAIL_PREFIX} ${violation}: ${shortName}`;
  }

  if (shortName && displayTitle.toLowerCase().includes(shortName.toLowerCase())) {
    const violation = violationFromDisplayTitle(displayTitle, shortName, finding.check_id);
    return `${VERITRAIL_PREFIX} ${violation}: ${shortName}`;
  }

  const violation = extractViolationSummary(displayTitle, finding.check_id);
  return `${VERITRAIL_PREFIX} ${violation}: ${shortName}`;
}
