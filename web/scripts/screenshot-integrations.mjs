// One-off visual check for the integrations card redesign.
// Usage: node scripts/screenshot-integrations.mjs
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

await page.goto(`${base}/integrations`);
await page.waitForTimeout(4000);
await page.screenshot({ path: `${outDir}/integrations-hub.png`, fullPage: false });
await page.screenshot({ path: `${outDir}/integrations-hub-full.png`, fullPage: true });

await page.goto(`${base}/integrations/catalog`);
await page.waitForTimeout(2500);
// Force lazy-loaded brand icons to resolve before capturing.
await page.evaluate(async () => {
  await Promise.all(
    Array.from(document.images)
      .filter((img) => !img.complete)
      .map((img) => new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      })),
  );
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/integrations-catalog.png`, fullPage: true });
// Catalog scrolls inside the app shell, so capture the lower sections too.
await page.evaluate(() => {
  const scroller = document.querySelector(".veritrail-app-content") || document.scrollingElement;
  scroller.scrollTop = scroller.scrollHeight;
});
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/integrations-catalog-bottom.png`, fullPage: false });

await browser.close();
console.log(`saved to ${outDir}`);
