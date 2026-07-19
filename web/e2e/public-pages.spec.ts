import { expect, test } from "@playwright/test";

test.describe("public launch pages", () => {
  test("privacy and terms render without the authenticated app shell", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
    await expect(page.getByText("read-only compliance-evidence tool")).toBeVisible();

    await page.goto("/terms");
    await expect(page.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
    await expect(page.getByText("No compliance or audit guarantee")).toBeVisible();
  });

  test("login screen exposes the primary credential flow", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in to veritrail/i })).toBeVisible();
    // Self-registration is disabled — no sign-up toggle without an invite.
    await expect(page.getByRole("button", { name: /sign up/i })).toHaveCount(0);
  });
});
