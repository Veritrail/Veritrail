import { api } from "../api";

export type FindingPage<T> = {
  items: T[];
  total: number;
  next_cursor: string | null;
};

export type FetchAllFindingsParams = {
  status?: string;
  account_id?: string;
  check_id?: string;
  severity?: string;
};

/** Cursor-walk /v1/findings until next_cursor is null (API max page size 500). */
export async function fetchAllFindings<T>(
  params: FetchAllFindingsParams = {},
): Promise<{ items: T[]; total: number }> {
  const search = new URLSearchParams();
  search.set("limit", "500");
  if (params.status) search.set("status", params.status);
  if (params.account_id) search.set("account_id", params.account_id);
  if (params.check_id) search.set("check_id", params.check_id);
  if (params.severity) search.set("severity", params.severity);

  const items: T[] = [];
  let cursor: string | null = null;
  let total = 0;

  for (;;) {
    const qs = new URLSearchParams(search);
    if (cursor) qs.set("cursor", cursor);
    const page = await api<FindingPage<T>>(`/v1/findings?${qs.toString()}`);
    items.push(...page.items);
    total = page.total;
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }

  return { items, total };
}
