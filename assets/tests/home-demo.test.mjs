import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mountHomeDemo } from "../home-demo.mjs";
const require = createRequire(new URL("../../sources/universal-vehicle-configurator/package.json", import.meta.url));
const { JSDOM } = require("jsdom");

function setup(t) {
  const dom = new JSDOM('<figure id="demo"><button id="play"><span class="hero-demo__label">Play</span></button></figure>', {
    url: "https://autolab.test/", pretendToBeVisual: true,
  });
  const win = dom.window, doc = win.document;
  let intersect;
  win.IntersectionObserver = class {
    constructor(callback) { intersect = callback; }
    observe() {} disconnect() {}
  };
  const demo = doc.getElementById("demo"), play = doc.getElementById("play");
  const mounted = mountHomeDemo({ demo, play, src: "https://autolab.test/garage/?demo=1&tour=1" });
  t.after(() => { mounted.dispose(); win.close(); });
  return { win, doc, demo, play, intersect: visible => intersect([{ target: demo, isIntersecting: visible }]),
    message: (type, source, origin = "https://autolab.test") => win.dispatchEvent(new win.MessageEvent("message", { data: { type }, source, origin })) };
}

test("loads only on Play, stays inline on phones, and ignores duplicate starts", t => {
  const { win, demo, play, doc } = setup(t);
  Object.defineProperty(win, "innerWidth", { value: 390 });
  assert.equal(doc.querySelector("iframe"), null);
  play.click(); play.click();
  assert.equal(demo.querySelectorAll("iframe").length, 1);
  assert.equal(win.location.pathname, "/");
  assert.match(demo.querySelector("iframe").src, /demo=1/);
  assert.ok(demo.querySelector('[role="status"]'));
});

test("only the current same-origin frame can finish loading; visibility follows its parent", t => {
  const { win, doc, demo, play, intersect, message } = setup(t);
  play.click(); const frame = demo.querySelector("iframe");
  const post = t.mock.fn(); frame.contentWindow.postMessage = post;
  message("autolab-demo-ready", win);
  message("autolab-demo-ready", frame.contentWindow, "https://elsewhere.test");
  assert.ok(demo.querySelector('[role="status"]'));
  message("autolab-demo-ready", frame.contentWindow);
  assert.equal(demo.querySelector('[role="status"]'), null);
  intersect(false);
  assert.deepEqual(post.mock.calls.at(-1).arguments, [{ type: "autolab-demo-visibility", visible: false }, "https://autolab.test"]);
  intersect(true);
  assert.equal(post.mock.calls.at(-1).arguments[0].visible, true);
  Object.defineProperty(doc, "hidden", { value: true });
  doc.dispatchEvent(new win.Event("visibilitychange"));
  assert.equal(post.mock.calls.at(-1).arguments[0].visible, false);
});

test("a failed frame is removed and Retry starts a fresh one", t => {
  const { demo, play, message } = setup(t);
  play.click(); const first = demo.querySelector("iframe");
  message("autolab-demo-error", first.contentWindow);
  assert.equal(demo.querySelector("iframe"), null);
  assert.equal(play.getAttribute("aria-label"), "Retry the guided tour");
  play.click();
  assert.notEqual(demo.querySelector("iframe"), first);
  assert.ok(demo.querySelector('[role="status"]'));
});

test("a missing ready event recovers instead of leaving an empty frame", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { demo, play } = setup(t);
  play.click(); t.mock.timers.tick(20_000);
  assert.equal(demo.querySelector("iframe"), null);
  assert.equal(play.isConnected, true);
});


test("keyboard focus stays with loading and returns to Retry when the frame fails", t => {
  const { doc, demo, play, message } = setup(t);
  play.focus();
  play.click();
  const container = demo.querySelector(".hero-demo__frame");
  const frame = demo.querySelector("iframe");
  assert.equal(doc.activeElement, container);
  assert.equal(frame.tabIndex, -1);
  message("autolab-demo-error", frame.contentWindow);
  assert.equal(doc.activeElement, play);
  play.click();
  const retryFrame = demo.querySelector("iframe");
  message("autolab-demo-ready", retryFrame.contentWindow);
  assert.equal(doc.activeElement, retryFrame);
  assert.equal(retryFrame.tabIndex, 0);
});

test("ready and failed events preserve focus when the person moves outside the demo", t => {
  const { doc, demo, play, message } = setup(t);
  const navigation = doc.createElement("button");
  navigation.textContent = "Navigation";
  doc.body.append(navigation);
  play.focus();
  play.click();
  navigation.focus();
  const frame = demo.querySelector("iframe");
  message("autolab-demo-ready", frame.contentWindow);
  assert.equal(doc.activeElement, navigation);
  message("autolab-demo-error", frame.contentWindow);
  assert.equal(doc.activeElement, navigation);
  assert.equal(play.isConnected, true);
});

// Run the actual static-page integration, replacing only its dynamic-import
// network boundary with a controllable promise.
function setupLauncher(t, loadModule) {
  const dom = new JSDOM('<body class="home-page"><header class="top"><a class="brand" href="/">AutoLab</a><nav id="site-navigation" class="nav"><a href="/configure/">Configure</a></nav><button id="chip"><span id="chip-label"></span></button><button class="nav-toggle" aria-expanded="false" aria-controls="site-navigation">Menu</button></header><aside id="already-inert" inert="keep">Existing inactive content</aside><div id="tools-sheet" hidden><button id="sheet-close">Close</button><div id="sheet-body"></div></div><figure id="hero-demo"><button id="hero-play"><span class="hero-demo__label">Play the guided tour</span></button></figure><button id="navigation">Navigation</button></body>', {
    url: "https://autolab.test/", pretendToBeVisual: true, runScripts: "outside-only",
  });
  const win = dom.window, doc = win.document;
  doc.modelContext = { registerTool: async () => {} };
  win.matchMedia = () => ({ matches: true, addEventListener() {} });
  win.__importHomeDemo = loadModule;
  const source = readFileSync(new URL("../site.js", import.meta.url), "utf8");
  const injected = source.replace("import(moduleUrl)", "window.__importHomeDemo(moduleUrl)");
  assert.notEqual(injected, source, "the dynamic-import boundary must be mocked");
  win.eval(injected);
  t.after(() => win.close());
  return { win, doc, play: doc.getElementById("hero-play"), demo: doc.getElementById("hero-demo") };
}
const flushAsync = () => new Promise(resolve => setImmediate(resolve));

test("the first click waits for its import, starts once, and preserves focus moved during download", async t => {
  let resolveImport;
  const waiting = new Promise(resolve => { resolveImport = resolve; });
  const loadModule = t.mock.fn(() => waiting);
  const { win, doc, play, demo } = setupLauncher(t, loadModule);
  assert.equal(loadModule.mock.callCount(), 0);
  play.focus();
  play.click();
  play.click();
  assert.equal(loadModule.mock.callCount(), 1);
  assert.equal(play.getAttribute("aria-busy"), "true");
  assert.match(play.textContent, /Preparing/);
  assert.equal(demo.querySelector("iframe"), null);
  const navigation = doc.getElementById("navigation");
  navigation.focus();
  resolveImport({ mountHomeDemo });
  await flushAsync();
  assert.equal(demo.querySelectorAll("iframe").length, 1);
  const frame = demo.querySelector("iframe");
  win.dispatchEvent(new win.MessageEvent("message", { source: frame.contentWindow, origin: "https://autolab.test", data: { type: "autolab-demo-ready" } }));
  assert.equal(doc.activeElement, navigation);
});

test("an import failure keeps a working Retry button and the next attempt starts the inline demo", async t => {
  let attempts = 0;
  const loadModule = t.mock.fn(async () => {
    if (++attempts === 1) throw new Error("Module download failed");
    return { mountHomeDemo };
  });
  const { doc, play, demo } = setupLauncher(t, loadModule);
  play.focus();
  play.click();
  await flushAsync();
  assert.equal(play.isConnected, true);
  assert.equal(doc.activeElement, play);
  assert.equal(play.getAttribute("aria-label"), "Retry the guided tour");
  assert.match(play.textContent, /Couldn’t load.*Retry/);
  assert.equal(play.hasAttribute("aria-busy"), false);
  assert.equal(play.hasAttribute("aria-disabled"), false);
  play.click();
  await flushAsync();
  assert.equal(loadModule.mock.callCount(), 2);
  assert.notEqual(loadModule.mock.calls[0].arguments[0], loadModule.mock.calls[1].arguments[0]);
  assert.equal(demo.querySelectorAll("iframe").length, 1);
  assert.equal(doc.activeElement, demo.querySelector(".hero-demo__frame"));
});


for (const moveFocus of [false, true]) {
  test(`a module download that never settles offers Retry and preserves ${moveFocus ? "external" : "Play"} focus`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { doc, play, demo } = setupLauncher(t, () => new Promise(() => {}));
    play.focus();
    play.click();
    const focused = moveFocus ? doc.getElementById("navigation") : play;
    focused.focus();
    t.mock.timers.tick(19_999);
    await flushAsync();
    assert.equal(play.getAttribute("aria-busy"), "true");
    t.mock.timers.tick(1);
    await flushAsync();
    assert.equal(play.getAttribute("aria-label"), "Retry the guided tour");
    assert.equal(play.hasAttribute("aria-busy"), false);
    assert.equal(play.hasAttribute("aria-disabled"), false);
    assert.equal(doc.activeElement, focused);
    assert.equal(demo.querySelector("iframe"), null);
  });
}

for (const lateDuringRetry of [true, false]) {
  test(`an expired import resolving ${lateDuringRetry ? "during" : "after"} a retry cannot mount or alter the current attempt`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let resolveExpired, resolveRetry;
    const expired = new Promise(resolve => { resolveExpired = resolve; });
    const retry = new Promise(resolve => { resolveRetry = resolve; });
    let attempts = 0;
    const loadModule = t.mock.fn(() => ++attempts === 1 ? expired : retry);
    const expiredMount = t.mock.fn(mountHomeDemo);
    const { doc, play, demo } = setupLauncher(t, loadModule);
    play.focus();
    play.click();
    t.mock.timers.tick(20_000);
    await flushAsync();
    assert.equal(play.getAttribute("aria-label"), "Retry the guided tour");
    play.click();
    if (lateDuringRetry) {
      resolveExpired({ mountHomeDemo: expiredMount });
      await flushAsync();
      assert.equal(expiredMount.mock.callCount(), 0);
      assert.equal(demo.querySelector("iframe"), null);
      assert.equal(play.getAttribute("aria-busy"), "true");
    }
    resolveRetry({ mountHomeDemo });
    await flushAsync();
    const currentFrame = demo.querySelector("iframe");
    assert.ok(currentFrame);
    if (!lateDuringRetry) {
      resolveExpired({ mountHomeDemo: expiredMount });
      await flushAsync();
    }
    assert.equal(expiredMount.mock.callCount(), 0);
    assert.equal(demo.querySelectorAll("iframe").length, 1);
    assert.equal(demo.querySelector("iframe"), currentFrame);
    assert.equal(loadModule.mock.callCount(), 2);
    assert.equal(doc.activeElement, demo.querySelector(".hero-demo__frame"));
  });
}


test("the tools dialog inerts a live iframe and header links while preserving its trigger and prior inert state", async t => {
  const { win, doc, play, demo } = setupLauncher(t, async () => ({ mountHomeDemo }));
  play.focus();
  play.click();
  await flushAsync();
  const frame = demo.querySelector("iframe");
  const chip = doc.getElementById("chip"), sheet = doc.getElementById("tools-sheet");
  const close = doc.getElementById("sheet-close"), existing = doc.getElementById("already-inert");
  chip.click();
  assert.equal(sheet.hidden, false);
  assert.equal(chip.getAttribute("aria-expanded"), "true");
  assert.equal(doc.activeElement, close);
  assert.equal(frame.closest("[inert]"), demo);
  assert.equal(doc.querySelector(".brand").hasAttribute("inert"), true);
  assert.equal(doc.querySelector(".nav").hasAttribute("inert"), true);
  assert.equal(doc.querySelector(".nav-toggle").hasAttribute("inert"), true);
  assert.equal(sheet.closest("[inert]"), null);
  assert.equal(chip.closest("[inert]"), null);
  win.dispatchEvent(new win.MessageEvent("message", { source: frame.contentWindow, origin: "https://autolab.test", data: { type: "autolab-demo-ready" } }));
  assert.equal(doc.activeElement, close);
  close.click();
  assert.equal(sheet.hidden, true);
  assert.equal(frame.closest("[inert]"), null);
  assert.equal(doc.querySelector(".brand").hasAttribute("inert"), false);
  assert.equal(doc.querySelector(".nav").hasAttribute("inert"), false);
  assert.equal(doc.querySelector(".nav-toggle").hasAttribute("inert"), false);
  assert.equal(existing.getAttribute("inert"), "keep");
  assert.equal(doc.activeElement, chip);
  chip.click();
  assert.equal(frame.closest("[inert]"), demo);
  doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(sheet.hidden, true);
  assert.equal(frame.closest("[inert]"), null);
  assert.equal(existing.getAttribute("inert"), "keep");
  assert.equal(doc.activeElement, chip);
});
