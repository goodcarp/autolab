/* global process, console, URL */
// Bring the embedded Garage up to the Owner's Guide it is a copy of.
//
//   public/garage/src/*.js, styles.css   <- ~/Desktop/r2-blueprint (or R2_BLUEPRINT_PATH)
//
// One module tree serves both: the sheet detects when it is framed and hides
// its own navigation and chip, drops to 30 Hz and a smaller backing buffer, and
// skips browser registration (the configurator owns the agent surface and
// reaches every tool over the bridge). index.html here keeps the vendored
// three.js import map and this page's title; vendor/ and pbr-probe.js are not
// copied. The model files geom.js and vehicle.js are promoted separately by
// promote-garage-model.mjs, and are the same bytes.
//
// Usage:  node scripts/sync-garage-sheet.mjs [path-to-r2-blueprint]
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = resolve(process.argv[2] ?? process.env.R2_BLUEPRINT_PATH ?? resolve(root, "..", "r2-blueprint"));
const FILES = ["blueprint.js", "camera.js", "config.js", "discovery.js", "geom.js", "main.js", "overlay.js", "tooltip-layout.js", "tour.js", "ui.js", "vehicle.js", "webmcp.js"];
if (!existsSync(resolve(source, "src", "webmcp.js"))) { console.error(`no Owner's Guide at ${source}`); process.exit(1); }
let changed = 0;
for (const name of FILES) {
  const from = resolve(source, "src", name), to = resolve(root, "public", "garage", "src", name);
  if (!existsSync(to) || readFileSync(from, "utf8") !== readFileSync(to, "utf8")) { copyFileSync(from, to); changed++; console.log(`updated src/${name}`); }
}
const css = resolve(source, "styles.css"), cssTo = resolve(root, "public", "garage", "styles.css");
if (readFileSync(css, "utf8") !== readFileSync(cssTo, "utf8")) { copyFileSync(css, cssTo); changed++; console.log("updated styles.css"); }
// index.html: the guide's markup with this page's import map, title and fallback text.
const guideHtml = readFileSync(resolve(source, "index.html"), "utf8");
const html = guideHtml
  .replace(/<title>[^<]*<\/title>/, "<title>AutoLab Garage · Hudian RX2 Digital Twin</title>")
  .replace(/"three": "https:\/\/cdn\.jsdelivr\.net\/npm\/three@[0-9.]+\/build\/three\.module(\.min)?\.js"/, '"three": "./vendor/three.module.js"')
  .replace(/"three\/addons\/": "https:\/\/cdn\.jsdelivr\.net\/npm\/three@[0-9.]+\/examples\/jsm\/"/, '"three/addons/": "./vendor/addons/"')
  .replace(/<link rel="modulepreload" href="https:\/\/cdn\.jsdelivr\.net\/npm\/three@[0-9.]+\/build\/three\.module(\.min)?\.js">/, '<link rel="modulepreload" href="./vendor/three.module.js">')
  .replace(/<link rel="modulepreload" href="https:\/\/cdn\.jsdelivr\.net\/npm\/three@[0-9.]+\/examples\/jsm\/geometries\/RoundedBoxGeometry\.js">/, '<link rel="modulepreload" href="./vendor/addons/geometries/RoundedBoxGeometry.js">')
  .replace("This drawing needs WebGL2 and network access to load three.js from the CDN.", "This drawing needs WebGL2. The complete rendering engine ships with AutoLab.");
if (!/vendor\/three\.module\.js/.test(html) || /cdn\.jsdelivr/.test(html)) { console.error("index.html rewrite did not land; leaving it alone"); process.exit(1); }
const htmlTo = resolve(root, "public", "garage", "index.html");
if (readFileSync(htmlTo, "utf8") !== html) { writeFileSync(htmlTo, html); changed++; console.log("updated index.html"); }
console.log(changed ? `${changed} file(s) updated from ${source}` : "embedded Garage already current");
