// Promote the R2 model from its origin repository into the Garage.
//
// The model has three homes and only one of the two hops is automated:
//
//   r2-blueprint/src/{geom,vehicle}.js        <- authored here, the origin
//        |  THIS SCRIPT, run by hand
//        v
//   public/garage/src/{geom,vehicle}.js       <- canonical source for AutoLab
//        |  scripts/sync-r2-model.mjs, automatic on dev/build/test
//        v
//   src/scene/r2/{geom,vehicle}.js            <- generated mirror, never edited
//
// The second hop is enforced; the first is not, which is how the Garage ended
// up a release behind its own model with two fixed bugs still in it. Run this
// after tagging a release in the origin repo.
//
// Only the two pure-model files are copied. Three other files are shared by
// descent but have deliberately diverged, and copying them would destroy
// AutoLab-specific work:
//
//   blueprint.js  AutoLab caps devicePixelRatio at 1.35 and tunes its passes so
//                 the drawing can run in an iframe beside the configurator.
//                 Shader fixes from the origin must be moved across by hand.
//   main.js       AutoLab adds the synced vehicle context and a 30 Hz cap.
//   config.js     AutoLab's own title block and branding.
//
// Usage:  node scripts/promote-garage-model.mjs [path-to-r2-blueprint]
//         R2_BLUEPRINT_PATH=... node scripts/promote-garage-model.mjs
//         --check   report drift and exit 1 without writing

import console from "node:console";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";

const MODEL_FILES = ["geom.js", "vehicle.js"];
const REVIEW_BY_HAND = ["blueprint.js", "main.js", "config.js"];

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const originArg = args.find((a) => !a.startsWith("--"));
const origin = resolve(
  originArg ?? process.env.R2_BLUEPRINT_PATH ?? resolve(homedir(), "Desktop", "r2-blueprint"),
);
const garage = resolve(process.cwd(), "public", "garage", "src");

async function readOrNull(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

const changed = [];
const missing = [];

for (const file of MODEL_FILES) {
  const from = await readOrNull(resolve(origin, "src", file));
  const to = await readOrNull(resolve(garage, file));
  if (from === null) {
    missing.push(file);
    continue;
  }
  if (from === to) continue;
  changed.push(file);
  if (!checkOnly) await writeFile(resolve(garage, file), from);
}

if (missing.length) {
  console.error(`No R2 model at ${origin}. Pass the path, or set R2_BLUEPRINT_PATH.`);
  process.exit(2);
}

if (!changed.length) {
  console.log(`Garage model matches ${origin}.`);
} else if (checkOnly) {
  console.error(`Garage model is behind ${origin}: ${changed.join(", ")}.`);
  console.error("Run: node scripts/promote-garage-model.mjs");
} else {
  console.log(`Promoted from ${origin}: ${changed.join(", ")}.`);
  console.log("Run `pnpm model:sync` (or any dev/build/test) to refresh the Configure mirror.");
}

// Shared by descent, deliberately divergent. Never copied; always worth a look
// after a promote, because a model fix and its shader fix often land together.
const drifted = [];
for (const file of REVIEW_BY_HAND) {
  const from = await readOrNull(resolve(origin, "src", file));
  const to = await readOrNull(resolve(garage, file));
  if (from !== null && to !== null && from !== to) drifted.push(file);
}
if (drifted.length) {
  console.log(`\nDiverged, review by hand (not copied): ${drifted.join(", ")}`);
  console.log(`  diff ${origin}/src/<file> public/garage/src/<file>`);
}

if (checkOnly && changed.length) process.exit(1);
