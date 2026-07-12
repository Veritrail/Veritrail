import { CHECK_CONTROL_IDS_MAP } from "../data/checkControlIdsMap";
import { isAbsenceGapCheck } from "./evidenceGap";

export type BlockerFinding = {
  id: string;
  check_id: string;
  severity: string;
  account_id?: string | null;
  account_label?: string | null;
  account_name?: string | null;
  first_seen?: string;
  resource_arn?: string;
  evidence?: Record<string, unknown>;
};

export type BlockerGroup = {
  checkId: string;
  count: number;
  severity: "critical" | "high";
  firstSeen: string | null;
  location: string | null;
  /** Deduped SOC 2 control ids this check maps to (blocked while findings stay open). */
  soc2ControlIds: string[];
  /** Subset of soc2ControlIds currently in fail status (preferred ranking signal). */
  failingControlIds: string[];
};

/** Optional map of control_id → status from /v1/controls. */
export type ControlStatusById = Record<string, string>;

export function isHighSeverity(severity: string): boolean {
  return severity === "critical" || severity === "high";
}

export function soc2ControlIdsForCheck(checkId: string): string[] {
  const refs = CHECK_CONTROL_IDS_MAP[checkId] ?? [];
  const ids: string[] = [];
  for (const ref of refs) {
    if (ref.framework === "soc2" && !ids.includes(ref.control_id)) ids.push(ref.control_id);
  }
  return ids;
}

/** Org-level source tag for the blocker meta line; cloud checks carry no tag. */
export function sourceTagForCheck(checkId: string): string | null {
  if (checkId.startsWith("github.")) return "GitHub";
  if (checkId.startsWith("gitlab.")) return "GitLab";
  if (checkId.startsWith("entra.")) return "Entra ID";
  if (checkId.startsWith("google_workspace.")) return "Google Workspace";
  return null;
}

/** Split org-wide high findings into ranked blockers vs. absence-gap capabilities. */
export function partitionBlockerFindings(findings: BlockerFinding[]): {
  blockerFindings: BlockerFinding[];
  absenceGapFindings: BlockerFinding[];
} {
  const blockerFindings: BlockerFinding[] = [];
  const absenceGapFindings: BlockerFinding[] = [];
  for (const finding of findings) {
    if (isAbsenceGapCheck(finding.check_id)) absenceGapFindings.push(finding);
    else blockerFindings.push(finding);
  }
  return { blockerFindings, absenceGapFindings };
}

/** "CC6.1" / "CC6.1 and CC6.2" / "CC6.1, CC6.2 and CC6.3" / cap 3 + "and more". */
export function formatControlList(ids: string[]): string {
  if (ids.length === 0) return "";
  if (ids.length === 1) return ids[0];
  if (ids.length === 2) return `${ids[0]} and ${ids[1]}`;
  if (ids.length === 3) return `${ids[0]}, ${ids[1]} and ${ids[2]}`;
  return `${ids[0]}, ${ids[1]}, ${ids[2]} and more`;
}

export function itemsPhrase(groupCount: number): string {
  if (groupCount === 1) return "the item below";
  if (groupCount === 2) return "the two items below";
  return "the three items below";
}

function failingControlsForCheck(
  soc2ControlIds: string[],
  controlStatusById?: ControlStatusById,
): string[] {
  if (!controlStatusById) return [];
  return soc2ControlIds.filter((id) => controlStatusById[id] === "fail");
}

function findingLocation(finding: BlockerFinding): string | null {
  const sourceTag = sourceTagForCheck(finding.check_id);
  if (sourceTag) return sourceTag;
  const evidence = finding.evidence ?? {};
  for (const key of ["region", "home_region"]) {
    const value = evidence[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const key of ["disabled_regions", "affected_regions"]) {
    const value = evidence[key];
    if (Array.isArray(value)) {
      const regions = value.filter((region): region is string => typeof region === "string" && !!region.trim());
      if (regions.length > 0) return regions.length === 1 ? regions[0] : `${regions.length} regions`;
    }
  }
  const arnRegion = finding.resource_arn?.split(":")[3];
  return arnRegion || null;
}

/** Group open critical|high findings by check_id; rank and take top N. */
export function groupBlockerFindings(
  findings: BlockerFinding[],
  limit = 3,
  controlStatusById?: ControlStatusById,
): BlockerGroup[] {
  const high = findings.filter((f) => isHighSeverity(f.severity));
  const findingsByCheck = new Map<string, BlockerFinding[]>();
  for (const finding of high) {
    const rows = findingsByCheck.get(finding.check_id) ?? [];
    rows.push(finding);
    findingsByCheck.set(finding.check_id, rows);
  }
  const groups: BlockerGroup[] = [...findingsByCheck.entries()].map(([checkId, rows]) => {
    const soc2ControlIds = soc2ControlIdsForCheck(checkId);
    const firstSeen = rows
      .map((finding) => finding.first_seen)
      .filter((value): value is string => !!value)
      .sort()[0] ?? null;
    return {
      checkId,
      count: rows.length,
      severity: rows.some((finding) => finding.severity === "critical") ? "critical" : "high",
      firstSeen,
      location: rows.map(findingLocation).find((value): value is string => !!value) ?? null,
      soc2ControlIds,
      failingControlIds: failingControlsForCheck(soc2ControlIds, controlStatusById),
    };
  });
  groups.sort(
    (a, b) =>
      b.failingControlIds.length - a.failingControlIds.length ||
      b.soc2ControlIds.length - a.soc2ControlIds.length ||
      b.count - a.count ||
      a.checkId.localeCompare(b.checkId),
  );
  return groups.slice(0, limit);
}

export function clearedByBlockers(groups: BlockerGroup[]): number {
  return groups.reduce((sum, group) => sum + group.count, 0);
}

/** Prefer failing controls when present; otherwise all mapped SOC 2 ids. */
export function unblockedControlIds(groups: BlockerGroup[]): string[] {
  const ids: string[] = [];
  for (const group of groups) {
    const preferred =
      group.failingControlIds.length > 0 ? group.failingControlIds : group.soc2ControlIds;
    for (const id of preferred) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids.sort();
}

/** Dev guard: subline X must equal sum of displayed row counts; N must match org-wide high count. */
export function assertBlockerMath(
  highCount: number,
  groups: BlockerGroup[],
  options?: { absenceGapCount?: number },
): void {
  const cleared = clearedByBlockers(groups);
  console.assert(
    cleared <= highCount,
    `[org-readiness] clearedByBlockers (${cleared}) must not exceed highCount (${highCount})`,
  );
  if (options?.absenceGapCount != null) {
    console.assert(
      cleared + options.absenceGapCount <= highCount,
      `[org-readiness] blocker (${cleared}) + absence-gap (${options.absenceGapCount}) counts must not exceed highCount (${highCount})`,
    );
  }
  for (const group of groups) {
    console.assert(group.count > 0, `[org-readiness] blocker row count must be > 0 for ${group.checkId}`);
    console.assert(
      !isAbsenceGapCheck(group.checkId),
      `[org-readiness] absence-gap check ${group.checkId} must not appear in blocker rows`,
    );
  }
}
