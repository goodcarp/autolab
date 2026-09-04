/* global process, console */
// Rail + phone-width captures: node tools/polish/capture-rail.mjs <prefix> [baseUrl]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const prefix = process.argv[2] ?? "capture";
const base = process.argv[3] ?? "http://127.0.0.1:4190";
const outDir = resolve("docs/demo/polish");
mkdirSync(outDir, { recursive: true });
const url = `${base}/?v=1&catalog=rivian-r2-2026&paint=paint.esker_silver&wheels=wheels.lt21_as`;
const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];
for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${name}: ${m.text()}`); });
  await page.goto(url, { waitUntil: "load", timeout: 90_000 });
  await page.waitForSelector('[data-live-status="ready"]', { timeout: 90_000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: resolve(outDir, `${prefix}-page-${name}.png`) });
  const wheels = page.locator(".config-group--wheels").first();
  const box = await wheels.boundingBox().catch(() => null);
  if (box) {
    await wheels.scrollIntoViewIfNeeded().catch(() => {});
    await wheels.screenshot({ path: resolve(outDir, `${prefix}-rail-wheels-${name}.png`) }).catch((e) => errors.push(`${name}: rail ${e}`));
  } else {
    errors.push(`${name}: wheel group not found`);
  }
  await context.close();
}
console.log(JSON.stringify({ errors }));
await browser.close();
