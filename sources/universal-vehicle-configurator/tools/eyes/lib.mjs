// Eyes: shared instrument parts.
//
// See docs/measure-dont-look.html in the r2-blueprint repository, findings 12
// and 14. Two rules from there shape everything in this directory:
//
//   - An instrument reads the artefact, not a proxy for it. `frameChanged`
//     differences rendered pixels rather than asking a CSS variable whether it
//     thinks something moved, because a proxy is a second model of the system
//     and can be wrong on its own.
//   - Every instrument carries a positive control. A check that has never been
//     seen to fail for the right reason has not been calibrated, and a null
//     result from it is not evidence. `pnpm eyes:selftest` drives each one.

import { chromium, devices } from "@playwright/test";
import process from "node:process";

export const APP_URL = process.env.EYES_URL ?? "http://127.0.0.1:4176/";
export const GARAGE_URL = new URL("garage/", APP_URL).href;

/** Refuse a WebGL context, the way a machine without one does. */
export function blockWebGL() {
  const real = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function patched(type, ...rest) {
    if (typeof type === "string" && type.toLowerCase().includes("webgl")) return null;
    return real.call(this, type, ...rest);
  };
}

export async function open({ url = APP_URL, device, viewport, reducedMotion, webgl = true } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...(device ? devices[device] : {}),
    ...(viewport ? { viewport } : {}),
    ...(reducedMotion ? { reducedMotion } : {}),
  });
  if (!webgl) await context.addInitScript(blockWebGL);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(url, { waitUntil: "networkidle" });
  return {
    browser,
    context,
    page,
    errors,
    async close() {
      await browser.close();
    },
  };
}

/** Wait for the live renderer, or report that it never arrived. */
export async function liveReady(page, timeout = 90_000) {
  try {
    await page.locator('[data-live-status="ready"]').waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Sampled byte difference between two PNG buffers, 0..1.
 *
 * Sampling every 997th byte is enough to answer "did this change at all",
 * which is the question, and keeps the instrument fast enough to run in a loop.
 * A prime stride avoids aligning with row or chunk boundaries.
 */
export function frameChanged(a, b, threshold = 0.02) {
  if (!a || !b) return { changed: false, fraction: 0 };
  const length = Math.min(a.length, b.length);
  if (a.length !== b.length) return { changed: true, fraction: 1 };
  let differing = 0;
  let sampled = 0;
  for (let i = 0; i < length; i += 997) {
    sampled += 1;
    if (a[i] !== b[i]) differing += 1;
  }
  const fraction = sampled ? differing / sampled : 0;
  return { changed: fraction > threshold, fraction };
}

/**
 * A point inside `selector` that is not on top of a control.
 *
 * The canvas deliberately ignores a drag that starts on a button, so a harness
 * that picks its origin geometrically can land on one and read "nothing moved"
 * — a true statement about a gesture the app is right to ignore. Finding 12
 * again, one level out: the instrument was correct and the stimulus missed.
 * Search for a clear point, and refuse to proceed if there is not one.
 */
export async function clearPoint(page, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const candidates = [0.42, 0.34, 0.5, 0.26, 0.58].flatMap(
    (fy) => [0.5, 0.38, 0.62].map((fx) => ({
      x: Math.round(box.x + box.width * fx),
      y: Math.round(box.y + box.height * fy),
    })),
  );
  for (const point of candidates) {
    const onControl = await page.evaluate(
      ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest("button, a, input, select")),
      point,
    );
    if (!onControl) return { ...point, box };
  }
  throw new Error(`every sampled point inside ${selector} is on a control`);
}

/** A one-finger drag, as real touch input rather than a synthetic event. */
export async function touchDrag(context, page, { from, to, steps = 12 }) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: Math.round(from.x + (to.x - from.x) * t), y: Math.round(from.y + (to.y - from.y) * t) }],
    });
    await page.waitForTimeout(28);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(900);
}

/** A two-finger pinch, spreading or closing about a centre. */
export async function touchPinch(context, page, { centre, from = 60, to = 150, steps = 8 }) {
  const cdp = await context.newCDPSession(page);
  const points = (half) => [
    { x: Math.round(centre.x - half), y: centre.y },
    { x: Math.round(centre.x + half), y: centre.y },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(from) });
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(from + ((to - from) * i) / steps),
    });
    await page.waitForTimeout(30);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(1200);
}

export async function shoot(page, selector, path) {
  return page.locator(selector).screenshot({
    ...(path ? { path } : {}),
    animations: "disabled",
    timeout: 60_000,
  });
}

/** A tiny result recorder, so every instrument reports the same way. */
export function report(title) {
  const rows = [];
  return {
    /**
     * Run a block of checks, and turn a thrown error into a reported failure.
     *
     * An instrument that aborts on the first problem reports nothing about
     * everything after it, which is the opposite of what it is for: the run
     * that found this was killed by one slow click and lost sixteen answers
     * that had already been earned.
     */
    async guard(name, fn) {
      try {
        await fn();
      } catch (error) {
        this.ok(name, false, String(error).split("\n")[0]);
      }
    },
    ok(name, passed, note = "") {
      rows.push({ name, passed, note });
      process.stdout.write(`${passed ? "PASS" : "FAIL"}  ${name}${note ? ` — ${note}` : ""}\n`);
      return passed;
    },
    finish() {
      const failed = rows.filter((row) => !row.passed);
      process.stdout.write(`\n${title}: ${rows.length - failed.length}/${rows.length} passed\n`);
      for (const row of failed) process.stdout.write(`  FAILED ${row.name}: ${row.note}\n`);
      if (failed.length) process.exitCode = 1;
      return { total: rows.length, failed: failed.length };
    },
  };
}
