/* global process, console */
// Reproducible showroom captures: node tools/polish/capture.mjs <prefix> [baseUrl]
// Drives the built site (serve dist/ on 4190) through every preset, paint and
// wheel with Playwright + SwiftShader, under prefers-reduced-motion so the
// camera lands on its pose instead of easing (and the idle turntable stays off).
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const prefix = process.argv[2] ?? "capture";
const base = process.argv[3] ?? "http://127.0.0.1:4190";
const outDir = resolve("docs/demo/polish");
mkdirSync(outDir, { recursive: true });
const q = (paint, wheels) =>
  `${base}/?v=1&catalog=rivian-r2-2026&paint=paint.${paint}&wheels=wheels.${wheels}`;
const shots = [
  { name: "angle-esker-lt21", url: q("esker_silver", "lt21_as"), preset: "Angle" },
  { name: "profile-esker-lt21", url: q("esker_silver", "lt21_as"), preset: "Profile" },
  { name: "wheel-esker-lt21", url: q("esker_silver", "lt21_as"), preset: "Wheel" },
  { name: "interior-esker-lt21", url: q("esker_silver", "lt21_as"), preset: "Interior" },
  { name: "blueprint-esker-lt21", url: q("esker_silver", "lt21_as"), preset: "Angle", mode: "Blueprint" },
  { name: "open-angle-esker-lt21", url: q("esker_silver", "lt21_as"), preset: "Angle", open: true },
  { name: "open-profile-esker-lt21", url: q("esker_silver", "lt21_as"), preset: "Profile", open: true },
  { name: "angle-glacier-lt21", url: q("glacier_white", "lt21_as"), preset: "Angle" },
  { name: "angle-catalina-lt21", url: q("catalina_blue", "lt21_as"), preset: "Angle" },
  { name: "angle-forest-lt21", url: q("forest_green", "lt21_as"), preset: "Angle" },
  { name: "angle-launch-lt21", url: q("launch_green", "lt21_as"), preset: "Angle" },
  { name: "angle-borealis-lt21", url: q("borealis", "lt21_as"), preset: "Angle" },
  { name: "wheel-esker-bs20at", url: q("esker_silver", "bs20_at"), preset: "Wheel" },
  { name: "angle-esker-bs20at", url: q("esker_silver", "bs20_at"), preset: "Angle" },
  { name: "wheel-esker-bc20", url: q("esker_silver", "bc20_as"), preset: "Wheel" },
  { name: "wheel-esker-mg19", url: q("esker_silver", "mg19_as"), preset: "Wheel" },
];
const garage = [
  { name: "garage-iso", url: `${base}/garage/index.html?view=iso&snap=1&adv=2` },
  { name: "garage-side-open", url: `${base}/garage/index.html?view=side&snap=1&adv=2&open=1` },
  { name: "garage-q34f-explode", url: `${base}/garage/index.html?view=q34f&explode=1` },
];

// SHOTS=name,name narrows the run; NO_GARAGE=1 skips the drawing pages.
const only = process.env.SHOTS ? new Set(process.env.SHOTS.split(",")) : null;
const selected = only ? shots.filter((shot) => only.has(shot.name)) : shots;
const garageSelected = process.env.NO_GARAGE ? [] : garage;

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
const log = [];
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push({ type: "pageerror", text: String(error) }));
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    errors.push({ type: message.type(), text: message.text() });
  }
});

for (const shot of selected) {
  const started = Date.now();
  errors.length = 0;
  try {
    await page.goto(shot.url, { waitUntil: "load", timeout: 90_000 });
    await page.waitForSelector('[data-live-status="ready"]', { timeout: 90_000 });
    await page.waitForTimeout(2500);
    const picker = page.getByLabel("Vehicle view presets");
    // Under SwiftShader the post chain makes each frame slow enough that
    // Playwright's stability checks time out, so clicks are forced.
    const click = { force: true, timeout: 120_000 };
    await picker.getByRole("button", { name: shot.preset, exact: true }).click(click);
    if (shot.mode) {
      await page.getByLabel("Vehicle rendering mode").getByRole("button", { name: shot.mode }).click(click);
    }
    if (shot.open) {
      await page.getByRole("button", { name: "Open body" }).click(click);
    }
    await page.waitForTimeout(shot.open ? 3000 : 1800);
    const stage = page.locator('[aria-label="Interactive vehicle configurator"]');
    await stage.screenshot({ path: resolve(outDir, `${prefix}-${shot.name}.png`), timeout: 240_000 });
    const readout = await page.locator(".vc-selection-readout").innerText().catch(() => "");
    log.push({ shot: shot.name, ok: true, readout, ms: Date.now() - started, errors: [...errors] });
  } catch (error) {
    log.push({ shot: shot.name, ok: false, error: String(error), errors: [...errors] });
  }
  console.log(JSON.stringify(log.at(-1)));
}
for (const shot of garageSelected) {
  errors.length = 0;
  try {
    await page.goto(shot.url, { waitUntil: "load", timeout: 90_000 });
    await page.waitForTimeout(9000);
    await page.screenshot({ path: resolve(outDir, `${prefix}-${shot.name}.png`) });
    log.push({ shot: shot.name, ok: true, errors: [...errors] });
  } catch (error) {
    log.push({ shot: shot.name, ok: false, error: String(error), errors: [...errors] });
  }
  console.log(JSON.stringify(log.at(-1)));
}
writeFileSync(resolve(outDir, `${prefix}-log.json`), JSON.stringify(log, null, 2));
await browser.close();
