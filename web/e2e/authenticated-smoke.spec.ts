import { expect, test } from "@playwright/test";

function uniqueEmail() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `smoke@veritrail-smoke-${suffix}.com`;
}

test("new user can sign up, land in AWS onboarding, and open account security", async ({ page }) => {
  const email = uniqueEmail();
  const password = `Veritrail smoke ${Date.now()} passphrase`;
  const org = `Veritrail Smoke ${Date.now()}`;

  await page.goto("/login?mode=signup");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();

  await page.getByLabel("Organization name").fill(org);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByRole("heading", { name: "Connect your AWS account" })).toBeVisible();

  await page.goto("/account");
  await expect(page.getByText(email).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Account security posture" })).toBeVisible();
  await expect(page.getByRole("button", { name: /set up 2fa/i })).toBeVisible();
});
