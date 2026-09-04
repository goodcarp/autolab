/**
 * Build the layered compositor frames.
 *
 * The trick Tesla and Porsche use: instead of rendering every paint colour,
 * render the body once in near-white and derive a mask of the paintable region.
 * At runtime the chosen colour is multiplied through that mask, so one render
 * serves every colour. It collapses a paints x wheels x angles matrix down to
 * wheels x angles, and it recolours instantly with no GPU and no download.
 *
 * The mask is derived by differencing two renders of the same view under two
 * strongly separated paints. Pixels that move are body paint; pixels that do
 * not are glass, tyres, trim, shadow and backdrop. That is exact, and it needs
 * no hand-authored matte.
 *
 *   node scripts/build-layered-frames.mjs [appUrl]
 *
 * Requires the local production preview and headless Chrome.
 */

import { execFile } from "node:child_process";
import { mkdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const run = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const appUrl = process.argv[2] ?? "http://127.0.0.1:4176/";
const outputRoot = resolve(projectRoot, "public/images/layered");

/** Near-white body so a multiply keeps highlights bright and shadows dark. */
const BASE_PAINT = "paint.glacier_white";
/** Two widely separated paints; their difference is the paintable region. */
const PROBE_A = "paint.launch_green";
const PROBE_B = "paint.borealis";

const VIEWS = [
  { id: "angle", preset: "Angle" },
  { id: "profile", preset: "Profile" },
];

const captureCss = `
  html, body, #root, .configurator-shell, .configurator-workspace,
  .configurator-viewport, .vehicle-canvas, .vc-stage {
    width: 100% !important; height: 100% !important; min-height: 0 !important; margin: 0 !important;
  }
  html, body { overflow: hidden !important; }
  .configurator-workspace { display: block !important; overflow: hidden !important; }
  .configurator-viewport { position: relative !important; inset: auto !important; padding: 0 !important; }
  .vc-stage { border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
  /* Chrome must not appear in a frame that is later tinted. */
  .configurator-rail, .configurator-header, .vc-hud, .vc-status, .vc-footer,
  .vc-view-picker, .vc-mode-switch, .vc-hotspots, .configuration-facts,
  .vc-model-attribution, .vc-drag-hint { display: none !important; }
`;

function buildUrl(paintId) {
  const query = [
    "v=1",
    "catalog=rivian-r2-2026",
    "build=build.performance",
    `paint=${paintId}`,
    "wheels=wheels.lt21_as",
    "interior=interior.black_crater",
  ].join("&");
  return `${appUrl.replace(/\?.*$/, "").replace(/\/$/, "")}/?${query}`;
}

async function shoot(browser, { paintId, preset, outPath }) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  try {
    await page.goto(buildUrl(paintId), { waitUntil: "networkidle" });
    await page.locator('[data-live-status="ready"]').waitFor({ timeout: 45_000 });
    await page.getByRole("button", { name: preset, exact: true }).click();
    // Let the camera settle and the paint material update before capturing.
    await page.waitForTimeout(1_400);
    await page.addStyleTag({ content: captureCss });
    await page.waitForTimeout(350);
    await page.locator(".vc-stage").screenshot({ path: outPath });
  } finally {
    await page.close();
  }
}

await mkdir(outputRoot, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader"],
});

const scratch = [];
try {
  for (const view of VIEWS) {
    const basePng = resolve(outputRoot, `${view.id}-base.png`);
    const aPng = resolve(outputRoot, `${view.id}-a.png`);
    const bPng = resolve(outputRoot, `${view.id}-b.png`);
    scratch.push(basePng, aPng, bPng);

    await shoot(browser, { paintId: BASE_PAINT, preset: view.preset, outPath: basePng });
    process.stdout.write(`base   ${view.id}\n`);
    await shoot(browser, { paintId: PROBE_A, preset: view.preset, outPath: aPng });
    process.stdout.write(`probeA ${view.id}\n`);
    await shoot(browser, { paintId: PROBE_B, preset: view.preset, outPath: bPng });
    process.stdout.write(`probeB ${view.id}\n`);
  }
} finally {
  await browser.close();
}

// Derive the masks and encode, in one Python pass so PIL is loaded once.
const py = `
import sys
from PIL import Image, ImageChops, ImageFilter

views = ${JSON.stringify(VIEWS.map((v) => v.id))}
out = ${JSON.stringify(outputRoot)}

for v in views:
    a = Image.open(f"{out}/{v}-a.png").convert("RGB")
    b = Image.open(f"{out}/{v}-b.png").convert("RGB")
    # Pixels that move between two very different paints are the paintable body.
    diff = ImageChops.difference(a, b).convert("L")
    peak = diff.getextrema()[1] or 1
    # Normalise, then a gentle floor so JPEG-ish noise in static regions is not
    # mistaken for paint, and a slight blur so the tint edge is not aliased.
    mask = diff.point(lambda p: min(255, int(p * 255 / peak)))
    mask = mask.point(lambda p: 0 if p < 46 else p)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=0.6))
    # Emit the coverage in the ALPHA channel over flat white, so CSS mask-image
    # works in its default alpha mode. Luminance masking is unevenly supported.
    matte = Image.new("RGBA", mask.size, (255, 255, 255, 0))
    matte.putalpha(mask)
    matte.save(f"{out}/{v}-paintmask.webp", format="WEBP", quality=92, method=6, exact=True)

    base = Image.open(f"{out}/{v}-base.png").convert("RGB")
    base.save(f"{out}/{v}-base-final.png")

    covered = sum(mask.point(lambda p: 1 if p > 128 else 0).getdata())
    total = mask.size[0] * mask.size[1]
    print(f"{v}: mask covers {covered/total*100:.1f}% of frame")
`;
await run("python3", ["-c", py]).then(({ stdout }) => process.stdout.write(stdout));

for (const view of VIEWS) {
  for (const [src, dest, quality] of [
    [`${view.id}-base-final.png`, `${view.id}-base.webp`, 90],
  ]) {
    await run("/usr/local/bin/cwebp", [
      "-quiet",
      "-q",
      String(quality),
      resolve(outputRoot, src),
      "-o",
      resolve(outputRoot, dest),
    ]);
    await unlink(resolve(outputRoot, src));
    process.stdout.write(`encoded ${dest}\n`);
  }
}

for (const file of scratch) {
  await unlink(file).catch(() => undefined);
}
process.stdout.write("layered frames built\n");
