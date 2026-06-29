/** Pass rate among controls with pass/fail status (excludes no_data). Matches History timeline. */
export function controlPostureScore(
  rows: Array<{ status: string }>,
): number | null {
  const passed = rows.filter((r) => r.status === "pass").length;
  const failed = rows.filter((r) => r.status === "fail").length;
  const scored = passed + failed;
  return scored > 0 ? Math.round((passed / scored) * 100) : null;
}
