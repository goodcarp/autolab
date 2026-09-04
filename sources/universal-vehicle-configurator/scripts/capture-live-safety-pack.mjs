import { execFile } from "node:child_process";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const run = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const appUrl = process.argv[2] ?? "http://127.0.0.1:4176/";
const outputRoot = resolve(projectRoot, "public/images");

const captureCss = `
  html, body, #root, .configurator-shell, .configurator-workspace,
  .configurator-viewport, .vehicle-canvas, .vc-stage {
    width: 100% !important;
    height: 100% !important;
    min-height: 0 !important;
    margin: 0 !important;
  }
  html, body { overflow: hidden !important; }
  .configurator-workspace { display: block !important; overflow: hidden !important; }
  .configurator-viewport {
    position: relative !important;
    inset: auto !important;
    padding: 0 !important;
  }
  .vc-stage {
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }
  .configurator-header, .configurator-rail, .vc-object, .vc-hud, .vc-status,
  .vc-model-attribution, .vc-hotspots, .vc-focus-card, .vc-view-picker,
  .vc-footer, .configuration-facts, .configuration-change {
    display: none !important;
  }
`;

async function toWebp(pngPath, webpPath, quality) {
  await run("/usr/local/bin/cwebp", ["-quiet", "-q", String(quality), pngPath, "-o", webpPath]);
  await unlink(pngPath);
}

async function capture(browser, {
  fileName,
  viewport,
  preset,
  mode = "showroom",
  focus,
  quality = 90,
}) {
  const page = await browser.newPage({ viewport });
  try {
    await page.goto(appUrl, { waitUntil: "networkidle" });
    await page.locator('[data-live-status="ready"]').waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: preset, exact: true }).click();
    if (mode === "blueprint") {
      await page.getByRole("button", { name: "Blueprint", exact: true }).click();
    }
    if (focus) {
      await page.getByRole("button", { name: `Focus ${focus}`, exact: true }).click();
    }
    await page.waitForTimeout(mode === "blueprint" ? 1_800 : 900);
    await page.addStyleTag({ content: captureCss });
    await page.waitForTimeout(250);

    const pngPath = resolve(outputRoot, `${fileName}.png`);
    const webpPath = resolve(outputRoot, `${fileName}.webp`);
    await page.locator(".vc-stage").screenshot({ path: pngPath });
    await toWebp(pngPath, webpPath, quality);
    process.stdout.write(`captured ${webpPath}\n`);
  } finally {
    await page.close();
  }
}

await mkdir(outputRoot, { recursive: true });
await mkdir(dirname(resolve(outputRoot, "showroom-fallback.webp")), { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader"],
});

try {
  await capture(browser, {
    fileName: "showroom-fallback",
    viewport: { width: 1600, height: 900 },
    preset: "Angle",
    quality: 90,
  });
  await capture(browser, {
    fileName: "vehicle-side",
    viewport: { width: 1600, height: 900 },
    preset: "Profile",
    quality: 90,
  });
  await capture(browser, {
    fileName: "vehicle-side-blueprint",
    viewport: { width: 1600, height: 900 },
    preset: "Profile",
    mode: "blueprint",
    quality: 92,
  });
  await capture(browser, {
    fileName: "representative-wheel-inset",
    viewport: { width: 512, height: 512 },
    preset: "Wheel",
    focus: "Wheel package",
    quality: 90,
  });
} finally {
  await browser.close();
}
