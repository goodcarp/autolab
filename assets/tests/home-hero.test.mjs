// The landing page's hero: one call to action (Fly the Tesla Roadster), the exploding-Roadster
// film with its poster and reduced-motion path, the Build / Learn / Create navigation, the
// favicon, and the agent tools in site.js. The page markup under test is the real index.html.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
const require = createRequire(new URL("../../sources/universal-vehicle-configurator/package.json", import.meta.url));
const { JSDOM } = require("jsdom");

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const exists = (path) => existsSync(new URL(path, root));
const homeHtml = read("index.html");
const engineHtml = read("engine/index.html");
const siteJs = read("assets/site.js");
const parse = (html, url = "https://autolab.test/") => new JSDOM(html, { url }).window.document;

test("the hero has exactly one call to action, and it flies the Tesla Roadster", () => {
  const doc = parse(homeHtml);
  const hero = doc.querySelector(".hero");
  const actions = hero.querySelectorAll("a.btn, button.btn");
  assert.equal(actions.length, 1);
  const fly = actions[0];
  assert.equal(fly.textContent.trim(), "Fly the Tesla Roadster");
  assert.equal(fly.getAttribute("href"), "garage/?vehicle=roadster&play=1");
  assert.ok(fly.classList.contains("primary"));
  // the old calls to action and the in-place tour are gone
  for (const text of ["Open the Configurator", "Open the Owner's Guide", "See the Engine", "Play the guided tour"]) {
    assert.equal(hero.textContent.includes(text), false, `${text} should be gone from the hero`);
  }
  assert.equal(doc.getElementById("hero-demo"), null);
  assert.equal(hero.querySelector("iframe"), null);
  assert.equal(exists("assets/home-demo.mjs"), false);
  assert.equal(/home-demo/.test(homeHtml + siteJs), false);
  // the copy stays as written
  assert.equal(hero.querySelector(".eyebrow").textContent, "Beta");
  assert.equal(hero.querySelector("h1").textContent, "Superintelligencefor car lovers.");
  assert.match(hero.querySelector(".lede").textContent, /^Buy, learn, repair, play\./);
  assert.match(hero.querySelector(".hero-note").textContent, /^Now available for Muse/);
  // the experience cards keep their own Open and Source buttons
  for (const id of ["card-configure", "card-garage", "card-engine"]) {
    const labels = [...doc.querySelectorAll(`#${id} .card-actions .btn`)].map((a) => a.textContent.trim());
    assert.ok(labels.includes("Open") && labels.includes("Source"), `${id} keeps Open and Source`);
  }
});

// H.264 comes first: on this drawing (fine screen-space hatching) it beat VP9 at every bitrate
// tried (SSIM 0.984 at 1.66 MB against 0.968 at 2.1 MB on the same four seconds), so the WebM is
// the fallback for browsers without H.264 rather than the first choice.
test("the hero film: muted looping video, mp4 then webm, a poster, a still fallback and a description", () => {
  const doc = parse(homeHtml);
  const video = doc.querySelector(".hero #hero-video");
  assert.ok(video, "the hero has a video");
  for (const attr of ["autoplay", "muted", "loop", "playsinline"]) assert.ok(video.hasAttribute(attr), `video has ${attr}`);
  assert.equal(video.getAttribute("preload"), "metadata");
  assert.equal(video.getAttribute("poster"), "assets/hero/roadster-explode.webp");
  const sources = [...video.querySelectorAll("source")].map((s) => [s.getAttribute("type"), s.getAttribute("src"), s.getAttribute("media")]);
  assert.deepEqual(sources, [
    ["video/mp4", "assets/hero/roadster-explode-960.mp4", "(max-width: 720px)"],
    ["video/mp4", "assets/hero/roadster-explode.mp4", null],
    ["video/webm", "assets/hero/roadster-explode.webm", null],
  ]);
  assert.equal(video.querySelector("img").getAttribute("src"), "assets/hero/roadster-explode.jpg");
  for (const path of ["assets/hero/roadster-explode.webp", "assets/hero/roadster-explode.jpg", ...sources.map((s) => s[1])]) {
    assert.ok(exists(path), `${path} is on disk`);
    assert.ok(statSync(new URL(path, root)).size > 10_000, `${path} is not empty`);
  }
  for (const path of ["assets/hero/roadster-explode.mp4", "assets/hero/roadster-explode.webm"]) {
    assert.ok(statSync(new URL(path, root)).size < 6e6, `${path} stays under 6 MB`);
  }
  const description = doc.getElementById(video.getAttribute("aria-describedby"));
  assert.match(description.textContent, /Tesla Roadster/);
  // the pause button only appears once site.js can drive it
  assert.equal(doc.getElementById("hero-video-toggle").hidden, true);
});

test("navigation reads AutoLab, Build, Learn, Create, GitHub on the landing and engine pages", () => {
  const home = parse(homeHtml);
  const brand = home.querySelector(".top .brand");
  assert.equal(brand.getAttribute("href"), "./");
  assert.equal(brand.getAttribute("aria-current"), "page");
  assert.match(brand.textContent, /AutoLab/);
  assert.deepEqual([...home.querySelectorAll("#site-navigation a")].map((a) => [a.textContent, a.getAttribute("href")]), [
    ["Build", "configure/"], ["Learn", "garage/"], ["Create", "engine/"], ["GitHub", "https://github.com/goodcarp/autolab"],
  ]);
  const engine = parse(engineHtml, "https://autolab.test/engine/");
  assert.equal(engine.querySelector(".top .brand").getAttribute("href"), "../");
  assert.deepEqual([...engine.querySelectorAll("#site-navigation a")].map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("aria-current")]), [
    ["Build", "../configure/", null], ["Learn", "../garage/", null], ["Create", "./", "page"], ["GitHub", "https://github.com/goodcarp/autolab", null],
  ]);
});

test("both pages use the official mark as the favicon, and the SVG draws as the mark", () => {
  for (const [html, prefix] of [[homeHtml, ""], [engineHtml, "../"]]) {
    const doc = parse(html);
    const icons = [...doc.querySelectorAll('link[rel="icon"]')].map((l) => [l.getAttribute("href"), l.getAttribute("type")]);
    assert.deepEqual(icons.at(-1), [`${prefix}assets/brand/favicon.svg`, "image/svg+xml"]);
    assert.equal(icons.some(([href]) => href.endsWith("autolab-mark.png")), false);
    for (const [href] of icons) assert.ok(exists(href.replace(/^\.\.\//, "")), `${href} is on disk`);
  }
  const svg = new JSDOM(read("assets/brand/favicon.svg"), { contentType: "image/svg+xml" }).window.document.documentElement;
  // Without fill="none" on the root, the mark's outline-only paths fill black and the icon is a blob.
  assert.equal(svg.getAttribute("fill"), "none");
  const [, , w, h] = svg.getAttribute("viewBox").split(/\s+/).map(Number);
  assert.equal(w, h, "a square viewBox, so the mark fills the tab icon");
  assert.equal(svg.querySelector("clipPath"), null);
});

// ---- site.js in the real page ---------------------------------------------
function loadPage(t, { reduced = false, intersection = false, blocked = false } = {}) {
  const dom = new JSDOM(homeHtml, { url: "https://autolab.test/", pretendToBeVisual: true, runScripts: "outside-only" });
  const win = dom.window, doc = win.document;
  const calls = { play: 0, pause: 0 };
  const paused = new WeakMap();
  const proto = win.HTMLMediaElement.prototype;
  Object.defineProperty(proto, "paused", { configurable: true, get() { return paused.get(this) ?? true; } });
  proto.play = function () {
    calls.play++;
    if (blocked) return Promise.reject(Object.assign(new Error("autoplay is not allowed"), { name: "NotAllowedError" }));
    paused.set(this, false); this.dispatchEvent(new win.Event("play")); return Promise.resolve();
  };
  proto.pause = function () { calls.pause++; if (paused.get(this) === false) { paused.set(this, true); this.dispatchEvent(new win.Event("pause")); } };
  const motionListeners = [];
  const motion = { matches: reduced, addEventListener: (type, fn) => motionListeners.push(fn) };
  win.matchMedia = (query) => (/reduced-motion/.test(query) ? motion : { matches: true, addEventListener() {} });
  let observe = null;
  if (intersection) win.IntersectionObserver = class { constructor(fn) { observe = fn; } observe() {} disconnect() {} };
  win.eval(siteJs);
  t.after(() => win.close());
  return {
    win, doc, calls, video: doc.getElementById("hero-video"), toggle: doc.getElementById("hero-video-toggle"),
    setReduced(value) { motion.matches = value; motionListeners.forEach((fn) => fn()); },
    intersect(visible) { observe([{ isIntersecting: visible }]); },
  };
}

test("the film starts on its own, and the button pauses and resumes it", (t) => {
  const { calls, video, toggle } = loadPage(t);
  assert.equal(toggle.hidden, false);
  assert.equal(calls.play, 1);
  assert.equal(video.paused, false);
  assert.equal(toggle.getAttribute("aria-label"), "Pause the animation");
  toggle.click();
  assert.equal(video.paused, true);
  assert.equal(toggle.getAttribute("aria-label"), "Play the animation");
  assert.equal(toggle.dataset.paused, "true");
  toggle.click();
  assert.equal(video.paused, false);
  assert.equal(calls.play, 2);
});

test("reduced motion keeps the poster: no autoplay, nothing played until the person asks", (t) => {
  const { calls, video, toggle } = loadPage(t, { reduced: true });
  assert.equal(video.hasAttribute("autoplay"), false);
  assert.equal(calls.play, 0);
  assert.equal(toggle.getAttribute("aria-label"), "Play the animation");
  toggle.click();
  assert.equal(calls.play, 1);
  assert.equal(video.paused, false);
});

test("a blocked autoplay leaves the poster and a Play button that works", async (t) => {
  const { calls, toggle } = loadPage(t, { blocked: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.play, 1);
  assert.equal(toggle.getAttribute("aria-label"), "Play the animation");
  toggle.click();
  assert.equal(calls.play, 2, "the person's click asks again");
});

test("turning reduced motion on while it plays stops the film", (t) => {
  const { video, setReduced, toggle } = loadPage(t);
  assert.equal(video.paused, false);
  setReduced(true);
  assert.equal(video.paused, true);
  assert.equal(toggle.getAttribute("aria-label"), "Play the animation");
});

test("the film rests while the tab is hidden or the hero is off screen", (t) => {
  const { win, doc, video, intersect } = loadPage(t, { intersection: true });
  assert.equal(video.paused, false);
  intersect(false);
  assert.equal(video.paused, true);
  intersect(true);
  assert.equal(video.paused, false);
  Object.defineProperty(doc, "hidden", { configurable: true, value: true });
  doc.dispatchEvent(new win.Event("visibilitychange"));
  assert.equal(video.paused, true);
  Object.defineProperty(doc, "hidden", { configurable: true, value: false });
  doc.dispatchEvent(new win.Event("visibilitychange"));
  assert.equal(video.paused, false);
});

test("when no video source loads, the poster stays and the button goes away", (t) => {
  const { win, video, toggle } = loadPage(t);
  const sources = video.querySelectorAll("source");
  sources[sources.length - 1].dispatchEvent(new win.Event("error"));
  assert.equal(toggle.hidden, true);
  assert.equal(video.getAttribute("poster"), "assets/hero/roadster-explode.webp");
});

test("the agent tools name Build, Learn and Create, and the Owner's Guide entry names the Roadster's Play run", async (t) => {
  const { win } = loadPage(t);
  const { experiences } = await win.autolab.list_autolab_experiences();
  // values made in the page's realm compare by content, so copy them into this one first
  assert.deepEqual(JSON.parse(JSON.stringify(experiences.map((e) => [e.id, e.label]))), [["configure", "Build"], ["garage", "Learn"], ["engine", "Create"]]);
  const garage = experiences.find((e) => e.id === "garage");
  assert.match(garage.summary, /opens on the Tesla Roadster/);
  assert.match(garage.summary, /Play/);
  assert.equal(garage.play.url, "https://autolab.test/garage/?vehicle=roadster&play=1");
  assert.equal(garage.play.label, "Fly the Tesla Roadster");
  const overview = await win.autolab.get_autolab_overview();
  assert.equal(overview.navigation.Learn, "https://autolab.test/garage/");
  // the sheet lists the open tool with its unchanged ids and the new labels
  const sheet = win.document.getElementById("sheet-body").textContent;
  assert.match(sheet, /open_autolab_experience/);
  assert.match(sheet, /Build, the Configurator \('configure'\); Learn, the Owner's Guide \('garage'\)/);
  await assert.rejects(win.autolab.open_autolab_experience({ experience: "garage-play" }), /configure, garage, engine/);
});

test("the open tool keeps its enum and its closed schema", async (t) => {
  const registered = [];
  const dom = new JSDOM(homeHtml, { url: "https://autolab.test/", pretendToBeVisual: true, runScripts: "outside-only" });
  const win = dom.window;
  t.after(() => win.close());
  win.matchMedia = () => ({ matches: true, addEventListener() {} });
  win.HTMLMediaElement.prototype.play = () => Promise.resolve();
  win.HTMLMediaElement.prototype.pause = () => {};
  win.document.modelContext = { registerTool: async (tool) => { registered.push(tool); } };
  win.eval(siteJs);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual([...registered.map((tool) => tool.name)], ["list_autolab_experiences", "get_autolab_overview", "open_autolab_experience"]);
  const open = registered.find((tool) => tool.name === "open_autolab_experience");
  assert.deepEqual([...open.inputSchema.properties.experience.enum], ["configure", "garage", "engine"]);
  assert.equal(open.inputSchema.additionalProperties, false);
  assert.match(open.description, /Build.*Learn.*Create/s);
  assert.match(win.document.getElementById("chip-label").textContent, /3 agent tools/);
});

test("the tools dialog inerts the hero and the header links, keeps its trigger live and restores prior inert state", (t) => {
  const { win, doc } = loadPage(t);
  const existing = doc.createElement("aside");
  existing.setAttribute("inert", "keep");
  doc.body.prepend(existing);
  const chip = doc.getElementById("chip"), sheet = doc.getElementById("tools-sheet"), close = doc.getElementById("sheet-close");
  const media = doc.getElementById("hero-media");
  chip.click();
  assert.equal(sheet.hidden, false);
  assert.equal(chip.getAttribute("aria-expanded"), "true");
  assert.equal(doc.activeElement, close);
  assert.ok(media.closest("[inert]"), "the hero is inert behind the dialog");
  for (const selector of [".brand", ".nav", ".nav-toggle"]) assert.equal(doc.querySelector(selector).hasAttribute("inert"), true, selector);
  assert.equal(sheet.closest("[inert]"), null);
  assert.equal(chip.closest("[inert]"), null);
  close.click();
  assert.equal(sheet.hidden, true);
  assert.equal(media.closest("[inert]"), null);
  for (const selector of [".brand", ".nav", ".nav-toggle"]) assert.equal(doc.querySelector(selector).hasAttribute("inert"), false, selector);
  assert.equal(existing.getAttribute("inert"), "keep");
  assert.equal(doc.activeElement, chip);
  chip.click();
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(sheet.hidden, true);
  assert.equal(existing.getAttribute("inert"), "keep");
  assert.equal(doc.activeElement, chip);
});

// The one button has to be on the first screen at tablet and narrow-desktop sizes too. The overlay
// (headline over the film) starts at 721 px, where the old two-column hero did, for any window that
// is not a tall portrait one; the stacked layout caps the film's height so the headline, the lede
// and the button fit above the fold. A browser sweep of 240 window sizes from 721 to 960 px wide
// and 650 to 1400 px tall found the button above the fold at every one; this guards the two rules.
test("the hero keeps its button on the first screen between phone and desktop widths", () => {
  const css = read("assets/site.css").replace(/\s+/g, "");
  const overlay = css.match(/@media\(min-width:960px\),\(min-width:721px\)and\(min-aspect-ratio:4\/5\)\{(.*?)\n?@media/s);
  assert.ok(overlay, "the overlay layout starts at 721 px for windows that are not tall portrait ones");
  assert.match(overlay[1], /\.home-page\.hero>:not\(\.hero-media\)\{grid-column:1/);
  assert.match(overlay[1], /\.hero-media__video,\.hero-media__videoimg\{[^}]*max-height:none/);
  assert.match(css, /@media\(min-width:600px\)\{\.hero-media__video,\.hero-media__videoimg\{max-height:max\(240px,calc\(100svh-595px\)\);object-fit:contain\}\}/);
});
