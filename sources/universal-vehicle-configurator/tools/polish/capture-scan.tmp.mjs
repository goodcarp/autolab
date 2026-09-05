/* global process, console, window, document */
// Same built-site / Playwright / SwiftShader recipe as capture.mjs.
// node tools/polish/capture-scan.mjs [prefix] [baseUrl]
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Buffer } from "node:buffer";

const prefix = process.argv[2] ?? "scan";
const base = process.argv[3] ?? "http://127.0.0.1:4190";
const out = resolve("docs/demo/scan");
mkdirSync(out, { recursive: true });
const log = [];
let browser;

function saveLog() {
  writeFileSync(resolve(out, `${prefix}-log.json`), JSON.stringify(log, null, 2) + "\n");
}

try {
  browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  for (const [device, viewport] of [
    ["desktop", { width: 1440, height: 900 }],
    ["phone", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push({ type: "pageerror", text: String(e) }));
    page.on("console", (m) => {
      if (["error", "warning"].includes(m.type())) errors.push({ type: m.type(), text: m.text() });
    });
    // A host implementation registers the actual page tool. No React/store
    // shortcuts: bodyOpen and the return sweep exercise its public execute path.
    await page.addInitScript(() => {
      window.__scanTools = {};
      Object.defineProperty(document, "modelContext", { configurable: true, value: {
        registerTool(tool) { window.__scanTools[tool.name] = tool; },
        unregisterTool(name) { delete window.__scanTools[name]; },
      } });
    });
    // Install before loading, then pause only after the reduced-motion pose
    // settles. Virtual rAF time makes 500 ms reproducible on slow SwiftShader.
    await page.clock.install();
    await page.goto(`${base}/?v=1&catalog=rivian-r2-2026&paint=paint.esker_silver&wheels=wheels.lt21_as`, {
      waitUntil: "load", timeout: 90_000,
    });
    await page.waitForSelector('[data-live-status="ready"]', { timeout: 90_000 });
    await page.waitForFunction(() => !!window.__scanTools?.present_vehicle_configuration && !!window.__r2);
    await page.waitForTimeout(3000);
    const stage = page.locator('[aria-label="Interactive vehicle configurator"]');
    const present = (patch) => page.evaluate(async (input) => {
      const result = await window.__scanTools.present_vehicle_configuration.execute(input);
      if (!result.ok || result.unapplied?.length) throw new Error(JSON.stringify(result));
      return result;
    }, patch);
    const state = () => page.evaluate(() => ({
      progress: window.__r2.showroom.scan.progress,
      active: window.__r2.showroom.scan.active,
      openT: window.__r2.vehicle.openT,
      mode: document.querySelector(".vehicle-canvas").dataset.mode,
      preset: document.querySelector(".vehicle-canvas").dataset.preset,
    }));
    const shoot = async (name, extra = {}) => {
      const path = `${prefix}-${device}-${name}.png`;
      // animations:"allow" preserves the requested midpoint rather than
      // fast-forwarding CSS while the material scan is paused.
      await stage.screenshot({ path: resolve(out, path), animations: "allow", timeout: 240_000 });
      const entry = { shot: name, device, path, ok: true, ...extra, state: await state(), errors: [...errors] };
      log.push(entry);
      saveLog();
      console.log(JSON.stringify(entry));
    };

    await shoot("angle");
    await page.screenshot({ path: resolve(out, `${prefix}-page-${device}.png`), timeout: 240_000 });

    // Measure actual rasterized non-background pixels, preserving material
    // aperture discards. Rendering just the vehicle into the same canvas omits
    // floor, contact shadow, bloom and HUD, which cannot define the car's bbox.
    // Read alpha immediately (preserveDrawingBuffer is deliberately false).
    const measurement = await page.evaluate(() => {
      const { vehicle, showroom } = window.__r2;
      const { gl, camera, invalidate } = vehicle.root.__r3f.root.getState();
      const savedTarget = gl.getRenderTarget();
      const savedColor = gl.getClearColor(showroom.paint.color.clone());
      const savedAlpha = gl.getClearAlpha();
      const savedAutoClear = gl.autoClear;
      let result;
      try {
        gl.setRenderTarget(null);
        gl.setClearColor(0, 0);
        gl.autoClear = true;
        gl.render(vehicle.root, camera);
        const canvas = document.createElement("canvas");
        canvas.width = gl.domElement.width;
        canvas.height = gl.domElement.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(gl.domElement, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1, count = 0;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            if (pixels[(y * canvas.width + x) * 4 + 3] < 16) continue;
            x0 = Math.min(x0, x); x1 = Math.max(x1, x);
            y0 = Math.min(y0, y); y1 = Math.max(y1, y); count++;
          }
        }
        if (!count) throw new Error("No vehicle pixels in extent capture");
        result = {
          png: canvas.toDataURL("image/png").split(",")[1],
          width: canvas.width, height: canvas.height, alphaThreshold: 16, count,
          bbox: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 },
          widthFraction: (x1 - x0 + 1) / canvas.width,
          clearAir: x0 > 0 && y0 > 0 && x1 < canvas.width - 1 && y1 < canvas.height - 1,
        };
      } finally {
        gl.setRenderTarget(savedTarget);
        gl.setClearColor(savedColor, savedAlpha);
        gl.autoClear = savedAutoClear;
        invalidate();
      }
      return result;
    });
    const { png, ...extent } = measurement;
    writeFileSync(resolve(out, `${prefix}-${device}-angle-mask.png`), Buffer.from(png, "base64"));
    log.push({ shot: "angle-extent", device, ...extent,
      ok: extent.clearAir && (device !== "desktop" || (extent.widthFraction >= 0.62 && extent.widthFraction <= 0.68)),
      targetMet: device !== "desktop" || (extent.widthFraction >= 0.62 && extent.widthFraction <= 0.68),
    });
    saveLog();
    console.log(JSON.stringify(log.at(-1)));

    await present({ viewPreset: "profile" });
    await page.waitForTimeout(1800);
    await shoot("profile");
    // Moving to Profile permanently stops the idle turntable. Reduced motion
    // is then disabled so both real presentation entry points animate.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForTimeout(100);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await stage.locator('[role="application"]').dispatchEvent("keydown", { key: "b", bubbles: true });
    // Flush effects before the 500 ms interval starts; record actual progress
    // below so a missed/settled transition cannot masquerade as a midpoint.
    await page.clock.runFor(32);
    await page.clock.runFor(500);
    const blueprintMid = await state();
    if (!blueprintMid.active || blueprintMid.progress < 0.40 || blueprintMid.progress > 0.52) {
      throw new Error(`Blueprint midpoint missed: ${JSON.stringify(blueprintMid)}`);
    }
    await shoot("blueprint-mid", { trigger: "b key", elapsedMs: 500 });
    await page.clock.runFor(1200);
    await shoot("blueprint-settled");
    if ((await state()).active || (await state()).progress !== 1) throw new Error("Blueprint did not settle");

    await present({ mode: "showroom" });
    await page.clock.runFor(32);
    await page.clock.runFor(500);
    const returnMid = await state();
    if (!returnMid.active || returnMid.progress < 0.48 || returnMid.progress > 0.60) {
      throw new Error(`Return midpoint missed: ${JSON.stringify(returnMid)}`);
    }
    await shoot("showroom-mid", { trigger: "presentation tool", elapsedMs: 500 });
    await page.clock.runFor(1200);
    await shoot("showroom-settled");
    if ((await state()).active || (await state()).progress !== 0) throw new Error("Showroom did not settle");
    // The model's post-settle frame count must remain stable on a parked profile.
    const frameCount = () => page.evaluate(() => window.__r2.vehicle.root.__r3f.root.getState().gl.info.render.frame);
    await page.clock.runFor(2000);
    const parkedFrames = await frameCount();
    await page.clock.runFor(1000);
    const idleFrames = (await frameCount()) - parkedFrames;
    log.push({ shot: "demand-idle", device, extraFrames: idleFrames, ok: idleFrames === 0 });
    saveLog();
    console.log("demand-idle", device, idleFrames);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.runFor(32);
    await present({ mode: "blueprint" });
    await page.clock.runFor(32);
    const reduced = await state();
    if (reduced.active || reduced.progress !== 1) throw new Error("Reduced-motion scan did not snap");
    log.push({ shot: "reduced-motion", device, ok: true, state: reduced });
    await present({ mode: "showroom", bodyOpen: true, viewPreset: "angle" });
    await page.clock.runFor(3000);
    if ((await state()).openT < 0.999) throw new Error("Body did not fully open");
    await shoot("open-angle", { trigger: "presentation tool bodyOpen:true" });
    await present({ viewPreset: "profile" });
    await page.clock.runFor(1800);
    await shoot("open-profile", { trigger: "presentation tool bodyOpen:true" });
    await present({ bodyOpen: false, viewPreset: "interior" });
    await page.clock.runFor(1800);
    await shoot("interior", { purpose: "plain-render interior regression" });
    await context.close();
  }
} catch (error) {
  log.push({ ok: false, error: String(error) });
  console.error(String(error));
  process.exitCode = 1;
} finally {
  saveLog();
  await browser?.close();
}

const rows = log.filter((entry) => entry.path).map((entry) => `| ${entry.device} | ${entry.shot} | [${entry.path}](${entry.path}) |`);
const extents = log.filter((entry) => entry.shot === "angle-extent").map((entry) =>
  `| ${entry.device} | ${entry.width}×${entry.height} | ${JSON.stringify(entry.bbox)} | ${(entry.widthFraction * 100).toFixed(2)}% | ${entry.clearAir} |`);
writeFileSync(resolve(out, `${prefix}-results.md`), [
  "# Scan capture results", "", "| Viewport | Shot | Capture |", "| --- | --- | --- |", ...rows, "",
  "Extent uses the rasterized car-only alpha mask from the capture camera (alpha ≥ 16/255), excluding floor, shadow, bloom and HUD.", "",
  "| Viewport | Canvas pixels | Car bbox | Fraction of canvas width | Clear air |",
  "| --- | --- | --- | --- | --- |", ...extents, "",
  ...log.filter((entry) => entry.ok === false).map((entry) => `Unverified: ${entry.error ?? JSON.stringify(entry)}`), "",
].join("\n"));
if (log.some((entry) => entry.ok === false || entry.errors?.some((error) => error.type !== "warning"))) {
  process.exitCode = 1;
}
