import { api } from "../api";
import { findingPageSchema } from "./apiSchemas";

export type FindingPage<T> = {
  items: T[];
  total: number;
  next_cursor: string | null;
};

export type FetchAllFindingsParams = {
  status?: string;
  account_id?: string;
  gcp_project_id?: string;
  azure_subscription_id?: string;
  provider?: string;
  check_id?: string;
  severity?: string;
};

/** Hard ceiling on findings pulled into memory + rendered at once. Results are
 * ordered by risk_score desc, so the cap keeps the highest-risk findings.
 * Protects against pathological accounts (10k+ findings) OOM-ing or jank-ing the
 * tab. Callers surface `truncated` so the cap is never silent. */
export const FINDINGS_FETCH_CAP = 5000;

/** Safety cap on pagination loops (500 findings/page → 50k rows max). */
const FINDINGS_MAX_PAGES = 100;

/** Cursor-walk /v1/findings (API max page size 500), bounded by maxItems. */
export async function fetchAllFindings<T>(
  params: FetchAllFindingsParams = {},
  { maxItems = FINDINGS_FETCH_CAP }: { maxItems?: number } = {},
): Promise<{ items: T[]; total: number; truncated: boolean }> {
  const search = new URLSearchParams();
  search.set("limit", "500");
  if (params.status) search.set("status", params.status);
  if (params.account_id) search.set("account_id", params.account_id);
  if (params.gcp_project_id) search.set("gcp_project_id", params.gcp_project_id);
  if (params.azure_subscription_id) search.set("azure_subscription_id", params.azure_subscription_id);
  if (params.provider) search.set("provider", params.provider);
  if (params.check_id) search.set("check_id", params.check_id);
  if (params.severity) search.set("severity", params.severity);

  const items: T[] = [];
  let cursor: string | null = null;
  let total = 0;

  for (let pageNum = 0; pageNum < FINDINGS_MAX_PAGES; pageNum += 1) {
    const qs = new URLSearchParams(search);
    if (cursor) qs.set("cursor", cursor);
    const page = await api(`/v1/findings?${qs.toString()}`, { schema: findingPageSchema });
    const prevLen = items.length;
    items.push(...(page.items as T[]));
    total = page.total ?? items.length;
    if (items.length >= maxItems) {
      items.length = maxItems; // keep the top-N highest-risk; drop the rest
      break;
    }
    const next = page.next_cursor ?? null;
    if (!next || (items.length === prevLen && next === cursor)) break;
    cursor = next;
  }

  return { items, total, truncated: total > items.length };
}
