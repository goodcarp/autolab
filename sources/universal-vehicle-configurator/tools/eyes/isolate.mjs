// Which part is that artefact?
//
// The instrument that settled the wheel-arch tear after five rounds of looking
// had failed to. Tint each candidate material a distinct colour, force a
// redraw, capture once: the artefact is whatever colour it turns, and if it
// turns no colour at all it is none of them — which is itself the answer, and
// the one that took longest to reach by eye.
//
//   pnpm eyes:isolate <outDir> [preset]      preset: angle|profile|wheel|interior

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { APP_URL, liveReady, open, report, shoot } from "./lib.mjs";
import process from "node:process";

const out = resolve(process.argv[2] ?? "eyes-isolate");
const preset = process.argv[3] ?? "wheel";
await mkdir(out, { recursive: true });
const r = report("isolate");

// Distinct, maximally separable hues. Roles come from the showroom material
// table; anything not listed keeps its real colour, so an artefact that stays
// unchanged has been excluded rather than merely not looked at.
const TINTS = {
  paint: "#ff0000",
  glass: "#0000ff",
  gloss: "#ffff00",
  cladding: "#ff00ff",
  tyre: "#00ff00",
  rim: "#ffffff",
  rimPocket: "#ff8800",
  disc: "#8800ff",
  trim: "#00ffff",
  chrome: "#00ff88",
  cabin: "#884400",
  screen: "#0088ff",
};

const s = await open({ viewport: { width: 1500, height: 940 } });
if (!(await liveReady(s.page))) {
  r.ok("live renderer available", false, "never reported ready");
  r.finish();
  await s.close();
  process.exit(1);
}
await s.page.waitForTimeout(3000);

const handle = await s.page.evaluate(() => Boolean(window.__r2));
r.ok("the body exposes its material table", handle, "window.__r2");
if (!handle) {
  r.finish();
  await s.close();
  process.exit(1);
}

const label = preset.charAt(0).toUpperCase() + preset.slice(1);
const redraw = async () => {
  // frameloop is "demand", so a tint alone repaints nothing. Bouncing the view
  // preset is the cheapest route to a real redraw.
  await s.page.getByRole("button", { name: "Angle", exact: true }).click();
  await s.page.waitForTimeout(900);
  await s.page.getByRole("button", { name: label, exact: true }).click();
  await s.page.waitForTimeout(1800);
};

await redraw();
await shoot(s.page, ".vc-stage", resolve(out, `${preset}-00-untinted.png`));

const applied = await s.page.evaluate((tints) => {
  const materials = window.__r2?.showroom?.materials ?? {};
  const done = [];
  for (const [role, hex] of Object.entries(tints)) {
    if (materials[role]?.color) {
      materials[role].color.set(hex);
      done.push(role);
    }
  }
  return done;
}, TINTS);
r.ok("tints applied to known roles", applied.length > 0, applied.join(", "));

await redraw();
await shoot(s.page, ".vc-stage", resolve(out, `${preset}-01-tinted.png`));

await writeFile(
  resolve(out, "legend.json"),
  `${JSON.stringify({ preset, url: APP_URL, tints: Object.fromEntries(applied.map((k) => [k, TINTS[k]])) }, null, 2)}\n`,
);

r.ok("captured an untinted and a tinted frame", true, out);
process.stdout.write(`\nlegend: ${resolve(out, "legend.json")}\n`);
process.stdout.write("anything that did not change colour is none of the tinted roles.\n");
r.finish();
await s.close();
