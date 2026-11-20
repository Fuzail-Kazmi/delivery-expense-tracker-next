import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { execFileSync, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import pg from "pg";
import { chromium } from "playwright-core";

const schema = "delivery_expense_test_" + randomUUID().replaceAll("-", "");
const env = {
  ...process.env,
  TRACKER_SCHEMA: schema,
  ADMIN_PASSWORD: randomUUID(),
};
execFileSync(process.execPath, ["scripts/migrate.mjs"], {
  env,
  stdio: "inherit",
});
const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const base = "http://127.0.0.1:" + port;
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "-H",
    "127.0.0.1",
    "-p",
    String(port),
  ],
  { env: { ...env, APP_ORIGIN: base }, stdio: "ignore" },
);
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/signin")).ok) break;
    } catch {
      /* starting */
    }
    await pause(150);
  }
  browser = await chromium.launch({
    channel: process.env.CHROME_PATH ? undefined : "chrome",
    executablePath: process.env.CHROME_PATH,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  const nav = async (name) => {
    if (await button("Open menu").isVisible())
      await button("Open menu").click();
    await page
      .locator(".sidebar")
      .getByRole("button", { name, exact: true })
      .click();
  };
  const label = (name) => page.getByLabel(name, { exact: true });
  const waitForSave = async () => {
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/data") &&
          r.request().method() === "POST" &&
          r.status() === 201,
      ),
      button("Save record").click(),
    ]);
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  };
  await page.goto(base);
  await label("Email address").fill("admin@sfk.com");
  await label("Password").fill(env.ADMIN_PASSWORD);
  await button("Sign in").click();
  await button("Add bottles").waitFor();
  await nav("Bottle prices");
  await button("Add price").click();
  await label("Date").fill("2026-01-01");
  await label("Bottle price").fill("150");
  await waitForSave();
  await nav("Settings");
  await label("Balance limit (Rs.)").fill("1200");
  await button("Save limit").click();
  await page.getByText("Balance limit saved.").waitFor();
  await nav("Dashboard");
  await button("Add bottles").click();
  await label("Date").fill("2026-01-31");
  await label("Bottle quantity").fill("10");
  assert.equal(await label("Price per bottle").inputValue(), "150");
  await page.locator('[name="notes"]').fill("January water");
  await waitForSave();
  await button("Record payment").click();
  await label("Date").fill("2026-02-01");
  await label("Amount paid").fill("1000");
  await waitForSave();
  const metric = page
    .locator(".metric")
    .filter({ hasText: "Bottles with a balance" });
  assert.equal(await page.locator(".due-card>strong").innerText(), "Rs. 500");
  assert.equal(await metric.locator("strong").innerText(), "4");
  assert.match(
    await metric.innerText(),
    /3 fully unpaid.*1 partly paid.*Rs. 50/,
  );
  await button("Filter dates").click();
  await label("From date").fill("2026-02-01");
  await label("To date").fill("2026-02-01");
  assert.match(
    await page.locator(".statement-strip").innerText(),
    /Rs\. 1,500/,
  );
  assert.match(await page.locator(".statement-strip").innerText(), /Rs\. 500/);
  await button("Notifications").click();
  await page.getByText("Balance reached Rs. 1,500").waitFor();
  await button("Notifications").click();
  await nav("Reports");
  await label("From date").fill("2026-02-01");
  await label("To date").fill("2026-02-01");
  const download = page.waitForEvent("download");
  await button("Download CSV").click();
  const file = await download;
  assert.match(
    await readFile(await file.path(), "utf8"),
    /"0","4","3","50","1500","0","1000","500","1000","2026-02-01"/,
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: undefined,
    });
  });
  await button("Share report").click();
  await page.getByText("Report copied for sharing.").waitFor();
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /closing due Rs\. 500.*4 bottles/,
  );
  await page.emulateMedia({ media: "print" });
  assert.ok((await page.pdf()).length > 1000);
  await page.emulateMedia({ media: "screen" });
  await nav("Bottle deliveries");
  await label("Search Bottle deliveries").fill("January water");
  await page.getByText("January water", { exact: true }).waitFor();
  await label("Search Bottle deliveries").fill("unmatched");
  await page.getByText("No records match this view.").waitFor();
  await nav("Ledger");
  await page.getByText("Owing Rs. 500").waitFor();
  await nav("Payments");
  await label("Select all payments").check();
  await button("Delete selected (1)").click();
  await button("No, keep it").click();
  await page.getByText("Rs. 1,000", { exact: true }).waitFor();
  await button("Use dark theme").click();
  await page.locator(".app.dark").waitFor();
  await page.reload();
  await page.locator(".app.dark").waitFor();
  await nav("Dashboard");
  await page.locator(".due-card").waitFor();
  for (const width of [320, 390, 768, 1366]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Layout overflow at " + width,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "Browser passed: all seven tabs, entry and pricing, partial payment, date filter, dated threshold alert, search, cancellation, CSV/share/PDF, saved theme, and four screen widths.",
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exit = once(server, "exit");
    server.kill();
    await exit;
  }
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("DROP SCHEMA " + schema + " CASCADE");
  } finally {
    await db.end();
  }
}
