/** Pass rate across the full control set. Matches History timeline. */
export function controlPostureScore(
  rows: Array<{ status: string }>,
): number | null {
  const total = rows.length;
  const passed = rows.filter((r) => r.status === "pass").length;
  return total > 0 ? Math.round((passed / total) * 100) : null;
}
