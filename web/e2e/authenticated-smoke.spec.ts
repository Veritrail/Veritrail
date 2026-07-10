import { expect, test } from "@playwright/test";

// Self-registration was removed (accounts are created via workspace invites),
// so the old sign-up → onboarding smoke flow can no longer run unauthenticated.
// This spec now guards the invariant that signup is unreachable from the UI.
test("signup mode is unreachable — login screen renders instead", async ({ page }) => {
  await page.goto("/login?mode=signup");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in to veritrail/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account" })).toHaveCount(0);
  await expect(page.getByText(/signups are invite-only/i)).toBeVisible();
});
