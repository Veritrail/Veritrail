/** Parse AWS policy-generation startedOn (ISO) to epoch ms. */
export function parseAwsPolicyGenStartedOn(iso: string | undefined | null): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Human elapsed label for in-flight CloudTrail policy generation. */
export function formatCloudTrailElapsed(startedAt: number, now = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m`;
}

/** Earliest trustworthy start time across local tracking + AWS job metadata. */
export function cloudTrailJobStartedAt(args: {
  pendingStartedAt?: number;
  historyStartedAt?: number;
  awsStartedOn?: string | null;
}): number | undefined {
  const candidates: number[] = [];
  if (args.pendingStartedAt) candidates.push(args.pendingStartedAt);
  if (args.historyStartedAt) candidates.push(args.historyStartedAt);
  const aws = parseAwsPolicyGenStartedOn(args.awsStartedOn);
  if (aws) candidates.push(aws);
  if (!candidates.length) return undefined;
  return Math.min(...candidates);
}
