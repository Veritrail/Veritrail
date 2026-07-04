import { assetTypeLabel, displayFindingTitle, resourceName } from "./findingDisplay";

const VERITRAIL_PREFIX = "[Veritrail]";

const EMBEDDED_RESOURCE_RE = /^(.+?)\s+[`']([^`']+)[`'](.*)$/s;

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

function normalizeTypeLabel(titleType: string, checkTypeLabel: string): string {
  const trimmed = titleType.trim();
  if (!trimmed) return checkTypeLabel;
  const titleLower = trimmed.toLowerCase();
  const checkLower = checkTypeLabel.toLowerCase();
  if (titleLower === "role" || titleLower === "user") return checkTypeLabel;
  if (titleLower === checkLower || titleLower.includes(checkLower) || checkLower.includes(titleLower)) {
    return checkTypeLabel;
  }
  return trimmed
    .split(" ")
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === "iam") return "IAM";
      if (lower === "aws") return "AWS";
      if (lower === "s3") return "S3";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function buildJiraIssueSummary(finding: {
  check_id: string;
  resource_arn: string;
  title: string;
}): string {
  const shortName = resourceName(finding.resource_arn);
  const displayTitle = displayFindingTitle(finding.title).trim();
  const checkTypeLabel = assetTypeLabel(finding.check_id);

  const parsed = parseEmbeddedTitle(displayTitle);
  if (parsed && namesMatch(parsed.embeddedName, shortName)) {
    const headline = `${normalizeTypeLabel(parsed.titleType, checkTypeLabel)} ${shortName}`;
    if (parsed.detail) {
      return `${VERITRAIL_PREFIX} ${headline} — ${parsed.detail}`;
    }
    return `${VERITRAIL_PREFIX} ${headline}`;
  }

  if (shortName && displayTitle.includes(shortName)) {
    return `${VERITRAIL_PREFIX} ${displayTitle}`;
  }

  return `${VERITRAIL_PREFIX} ${shortName} — ${displayTitle}`;
}
