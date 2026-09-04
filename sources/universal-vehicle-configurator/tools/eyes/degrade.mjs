// Does the page degrade honestly, and is it usable without a mouse?
//
// This is the harness that was written and thrown away twice in one day. It
// answers questions that cannot be answered by reading the source: whether the
// WebGL detector agrees with the renderer it gates, whether the thing on screen
// is in the accessibility tree, and whether a gesture the hint promises exists.
//
//   pnpm eyes:degrade [outDir]

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import {
  APP_URL, GARAGE_URL, clearPoint, frameChanged, liveReady, open, report, shoot, touchDrag, touchPinch,
} from "./lib.mjs";

const out = process.argv[2] ? resolve(process.argv[2]) : null;
if (out) await mkdir(out, { recursive: true });
const r = report("degrade");

// --- honours prefers-reduced-motion -----------------------------------------
await r.guard("reduced motion block", async () => {
  const s = await open({ viewport: { width: 1400, height: 900 }, reducedMotion: "reduce" });
  await liveReady(s.page);
  await s.page.waitForTimeout(2500);
  const flag = await s.page.locator(".vehicle-canvas").getAttribute("data-reduced-motion");
  r.ok("reduced motion is honoured and reported", flag === "true", `data-reduced-motion=${flag}`);
  await s.close();
});

// --- degrades honestly with no WebGL ----------------------------------------
await r.guard("no-WebGL block", async () => {
  const s = await open({ viewport: { width: 1400, height: 900 }, webgl: false });
  await s.page.waitForTimeout(6000);
  const canvas = s.page.locator(".vehicle-canvas");
  const renderer = await canvas.getAttribute("data-renderer");
  const text = await canvas.innerText();
  r.ok("no WebGL: does not claim live 3D", renderer !== "live_3d", `data-renderer=${renderer}`);
  r.ok("no WebGL: names what it is showing instead", /authored still/i.test(text));
  r.ok(
    "no WebGL: withholds the open-body control",
    (await s.page.getByRole("button", { name: /Open body/i }).count()) === 0,
  );
  r.ok("no WebGL: human view controls still work",
    await s.page.getByRole("button", { name: "Profile", exact: true }).isEnabled().catch(() => false));
  // The still is the only thing on screen here, so it must be in the tree.
  const still = s.page.locator(".vc-angle-view, .vc-profile-view").first();
  r.ok("no WebGL: the visible still is not hidden from assistive tech",
    (await still.getAttribute("aria-hidden")) !== "true");
  r.ok("no WebGL: no uncaught page errors", s.errors.length === 0, s.errors[0] ?? "");
  if (out) await shoot(s.page, ".vc-stage", resolve(out, "no-webgl.png"));
  await s.close();
});

// --- reachable by touch, on both render paths --------------------------------
for (const device of ["iPhone 13", "iPad (gen 7)"]) {
  for (const webgl of [true, false]) {
   await r.guard(`touch ${device} ${webgl ? "live" : "no-webgl"} block`, async () => {
    const label = `${device.split(" ")[0].toLowerCase()}/${webgl ? "live" : "no-webgl"}`;
    const s = await open({ device, webgl });
    if (webgl) await liveReady(s.page);
    await s.page.waitForTimeout(webgl ? 4500 : 3000);
    // Start clear of any control, and stay inside the stage: on a 390 px phone
    // a drag from the geometric centre lands on a view button and a 190 px
    // sweep leaves the viewport entirely.
    const origin = await clearPoint(s.page, ".vc-stage");
    const reach = Math.round(Math.min(origin.box.width * 0.3, 150));
    const before = await shoot(s.page, ".vc-stage");
    await touchDrag(s.context, s.page, {
      from: { x: origin.x, y: origin.y },
      to: { x: origin.x - reach, y: origin.y + 18 },
    });
    const after = await shoot(s.page, ".vc-stage");
    const diff = frameChanged(before, after);
    r.ok(`touch ${label}: drag changes the view`, diff.changed, `${(diff.fraction * 100).toFixed(1)}% of samples differ`);

    await s.page.getByRole("button", { name: "Profile", exact: true }).tap();
    await s.page.waitForTimeout(1200);
    r.ok(`touch ${label}: control taps still register`,
      (await s.page.locator(".vehicle-canvas").getAttribute("data-preset")) === "profile");
    await s.close();
   });
  }
}

// --- the Garage, on its own --------------------------------------------------
await r.guard("garage block", async () => {
  const s = await open({ url: GARAGE_URL, device: "iPhone 13" });
  await s.page.waitForTimeout(5000);
  const hint = (await s.page.locator("#hint").textContent()) ?? "";
  r.ok("garage: the hint names a gesture touch actually has", /pinch/i.test(hint), hint.trim());
  r.ok("garage: carries its provenance note", (await s.page.locator(".tb-note").count()) > 0);
  const box = await s.page.locator("#gl").boundingBox();
  const before = await shoot(s.page, "#stage");
  await touchPinch(s.context, s.page, {
    centre: { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) },
  });
  const diff = frameChanged(before, await shoot(s.page, "#stage"));
  r.ok("garage: pinch changes the view", diff.changed, `${(diff.fraction * 100).toFixed(1)}% of samples differ`);
  await s.close();
});

// --- lays out without sideways scroll ---------------------------------------
for (const [label, width, height] of [["phone", 390, 844], ["tablet", 834, 1112], ["laptop", 1440, 900], ["wide", 1920, 1080]]) {
 await r.guard(`layout ${label} block`, async () => {
  const s = await open({ viewport: { width, height } });
  await liveReady(s.page);
  await s.page.waitForTimeout(3000);
  const overflow = () => s.page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  const configure = await overflow();
  r.ok(`layout ${label}: Configure does not scroll sideways`, configure <= 1, `${configure}px`);
  if (out) await s.page.screenshot({ path: resolve(out, `configure-${label}.png`) });

  const garage = s.page.getByRole("button", { name: "Garage", exact: true });
  if (await garage.count()) {
    // Generous, because this runs after several browser contexts have already
    // competed for the machine.
    await garage.click({ timeout: 60_000 });
    await s.page.waitForTimeout(6000);
    const inGarage = await overflow();
    r.ok(`layout ${label}: Garage does not scroll sideways`, inGarage <= 1, `${inGarage}px`);
    if (out) await s.page.screenshot({ path: resolve(out, `garage-${label}.png`) });
  }
  await s.close();
 });
}

process.stdout.write(`\nagainst ${APP_URL}\n`);
r.finish();
