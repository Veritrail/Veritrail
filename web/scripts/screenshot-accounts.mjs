// One-off visual check for the accounts dashboard redesign.
// Usage: node scripts/screenshot-accounts.mjs
import { chromium } from "@playwright/test";

const base = process.env.BASE_URL || "http://127.0.0.1:5173";
const outDir = process.env.OUT_DIR || "/tmp/veritrail-shots";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

await page.goto(`${base}/login`);
// Inputs are readonly until focused (anti-autofill), so click + type.
const email = page.locator("#email");
await email.click();
await email.pressSequentially("dev@veritrail.io");
const password = page.locator('input[type="password"]');
await password.click();
await password.pressSequentially("dev-veritrail-2026");
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL(/\/(dashboard|accounts|findings)/, { timeout: 15000 });

await page.goto(`${base}/accounts`);
await page.waitForTimeout(4000);
await page.screenshot({ path: `${outDir}/accounts-dashboard.png`, fullPage: false });
await page.screenshot({ path: `${outDir}/accounts-dashboard-full.png`, fullPage: true });

await page.goto(`${base}/accounts?view=all`);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/accounts-manage.png`, fullPage: true });

await browser.close();
console.log(`saved to ${outDir}`);
