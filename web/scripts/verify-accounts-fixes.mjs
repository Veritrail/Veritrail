// Verify accounts dashboard follow-up fixes.
import { chromium } from "@playwright/test";

const base = process.env.BASE_URL || "http://127.0.0.1:5173";
const outDir = process.env.OUT_DIR || "/tmp/veritrail-shots";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

await page.goto(`${base}/login`);
const email = page.locator("#email");
await email.click();
await email.pressSequentially("dev@veritrail.io");
const password = page.locator('input[type="password"]');
await password.click();
await password.pressSequentially("dev-veritrail-2026");
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL(/\/(dashboard|accounts|findings)/, { timeout: 15000 });

await page.goto(`${base}/accounts`);
await page.waitForTimeout(3500);

const breadcrumbInHeader = page.locator(".veritrail-app-header__slot .accounts-dashboard__all-link");
const breadcrumbCount = await breadcrumbInHeader.count();
const addOnDashboard = page.locator(".accounts-dashboard .accounts-detail-header__add-btn");
const addCount = await addOnDashboard.count();

await page.screenshot({ path: `${outDir}/accounts-fixes-dashboard.png`, fullPage: true });

// Click first priority finding if present
const findingRow = page.locator(".accounts-detail-overview__list-row--findings").first();
if (await findingRow.count()) {
  await findingRow.click();
  await page.waitForTimeout(2500);
  const drawerOpen = await page.locator(".finding-drawer, [class*='finding-drawer']").count();
  console.log("after finding click url:", page.url());
  console.log("drawer elements:", drawerOpen);
  await page.screenshot({ path: `${outDir}/accounts-fixes-finding-drawer.png`, fullPage: false });
}

console.log("breadcrumb in header:", breadcrumbCount);
console.log("add button on dashboard:", addCount);
await browser.close();
