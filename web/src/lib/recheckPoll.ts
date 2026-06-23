import { fetchAllFindings } from "./fetchAllFindings";

export const RECHECK_POLL_MS = 1500;
/** Slow-path Celery recheck (full IAM/S3 collect) can take several minutes. */
export const RECHECK_WAIT_MS = 180_000;

export type FindingSnapshot = {
  id: string;
  status: string;
  last_seen: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchCheckFindings(checkId: string): Promise<FindingSnapshot[]> {
  const { items } = await fetchAllFindings<FindingSnapshot>({ status: "all", check_id: checkId });
  return items;
}

export function snapshotFindings(
  items: FindingSnapshot[],
  rowIds: string[],
): Map<string, Pick<FindingSnapshot, "status" | "last_seen">> {
  const ids = new Set(rowIds);
  return new Map(
    items.filter((f) => ids.has(f.id)).map((f) => [f.id, { status: f.status, last_seen: f.last_seen }]),
  );
}

export function hasRecheckUpdate(
  rowIds: string[],
  baseline: Map<string, Pick<FindingSnapshot, "status" | "last_seen">>,
  current: FindingSnapshot[],
  queuedAtMs: number,
): boolean {
  const byId = new Map(current.map((f) => [f.id, f]));
  for (const id of rowIds) {
    const before = baseline.get(id);
    if (!before) continue;
    const after = byId.get(id);
    if (!after) {
      if (before.status === "open") return true;
      continue;
    }
    if (after.status !== before.status) return true;
    if (new Date(after.last_seen).getTime() > new Date(before.last_seen).getTime() + 500) return true;
    if (new Date(after.last_seen).getTime() >= queuedAtMs - 3000) return true;
  }
  return false;
}

export function summarizeRefreshOutcome(
  rowIds: string[],
  baseline: Map<string, Pick<FindingSnapshot, "status" | "last_seen">>,
  current: FindingSnapshot[],
): { resolved: number; stillOpen: number } {
  const byId = new Map(current.map((f) => [f.id, f]));
  let resolved = 0;
  let stillOpen = 0;

  for (const id of rowIds) {
    const before = baseline.get(id);
    if (!before || before.status !== "open") continue;
    const after = byId.get(id);
    if (!after || after.status === "resolved") {
      resolved += 1;
    } else if (after.status === "open") {
      stillOpen += 1;
    }
  }

  return { resolved, stillOpen };
}

export async function waitForRecheckUpdate(
  checkId: string,
  rowIds: string[],
  baseline: Map<string, Pick<FindingSnapshot, "status" | "last_seen">>,
  queuedAtMs: number,
): Promise<"updated" | "timeout"> {
  const deadline = queuedAtMs + RECHECK_WAIT_MS;

  while (Date.now() < deadline) {
    const items = await fetchCheckFindings(checkId);
    if (hasRecheckUpdate(rowIds, baseline, items, queuedAtMs)) {
      return "updated";
    }
    if (Date.now() >= deadline) break;
    await sleep(RECHECK_POLL_MS);
  }

  return "timeout";
}
