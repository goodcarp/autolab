// Knots.
//
// A drawing gives thousands of samples. The curve layer wants a handful of
// control points, because a knot is what a measurement produces and a knot list
// is what a human edits. Fitting one is the step that turns a reference into
// something the model can be built from — finding 09: a measurement correction
// should only ever edit the curve layer.
//
// The interpolator is imported from the model's own geom.js rather than
// reimplemented. A knot list fitted against a different curve than the model
// evaluates would reproduce approximately, and "approximately" is what this
// whole engine exists to replace.

import { createRequire } from "node:module";
import { homedir } from "node:os";
import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { round } from "./load.mjs";

const require = createRequire(import.meta.url);

export const DEFAULT_GEOM = resolve(homedir(), "Desktop", "r2-blueprint", "src", "geom.js");

let interpCache = null;
export async function monotoneInterp({ path = process.env.GEOM_PATH ?? DEFAULT_GEOM } = {}) {
  if (interpCache) return interpCache;
  const module = await import(pathToFileURL(path).href);
  if (typeof module.interp !== "function") throw new Error(`${path} does not export interp()`);
  interpCache = module.interp;
  return interpCache;
}

/**
 * Fit the fewest knots that reproduce a profile within a millimetre budget.
 *
 * Greedy insertion: start with the endpoints, evaluate the curve those two
 * imply, insert a knot exactly where the error is worst, repeat. It converges
 * on the features — a knot lands on the windscreen base because that is where
 * a two-knot line is most wrong, not because anyone pointed at it.
 *
 * Reports the error it achieved, always. A knot list without its residual is a
 * claim, not a measurement.
 */
export async function fitKnots(samples, {
  tolerance_mm = 3,
  maxKnots = 40,
  geomPath,
  // x positions that must survive the fit. The author's anchored knots —
  // S.NOSE, T(4.715) — are the frame they chose to think in, and a refit that
  // discards them replaces a hand-authored curve with a machine-authored one
  // that happens to pass through similar points. Seeding them and never
  // removing them keeps the fit inside that frame.
  pinned = [],
} = {}) {
  const interp = await monotoneInterp({ path: geomPath });
  const points = [...samples].sort((a, b) => a[0] - b[0]);
  if (points.length < 2) throw new Error("need at least two samples to fit");

  const nearestIndex = (x) => {
    let best = 0;
    for (let i = 1; i < points.length; i += 1) {
      if (Math.abs(points[i][0] - x) < Math.abs(points[best][0] - x)) best = i;
    }
    return best;
  };

  const chosen = [0, points.length - 1];
  for (const x of pinned) {
    const i = nearestIndex(x);
    if (!chosen.includes(i)) chosen.push(i);
  }
  chosen.sort((a, b) => a - b);
  const pinnedIndices = new Set(chosen);
  const budget = tolerance_mm / 1000;
  let history = [];

  for (let step = 0; step < maxKnots; step += 1) {
    const knots = chosen.map((i) => points[i]);
    const curve = interp(knots);
    let worst = { index: -1, error: 0 };
    for (let i = 0; i < points.length; i += 1) {
      const error = Math.abs(curve(points[i][0]) - points[i][1]);
      if (error > worst.error) worst = { index: i, error };
    }
    history.push({ knots: knots.length, worst_mm: round(worst.error * 1000, 2) });
    if (worst.error <= budget || worst.index < 0) break;
    if (chosen.includes(worst.index)) break;
    chosen.push(worst.index);
    chosen.sort((a, b) => a - b);
  }

  const knots = chosen.map((i) => [round(points[i][0], 4), round(points[i][1], 4)]);
  const curve = interp(knots);
  const errors = points.map((p) => Math.abs(curve(p[0]) - p[1]));
  const max = Math.max(...errors);
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;

  return {
    knots,
    count: knots.length,
    pinnedKept: [...pinnedIndices].filter((i) => chosen.includes(i)).length,
    maxError_mm: round(max * 1000, 2),
    meanError_mm: round(mean * 1000, 2),
    tolerance_mm,
    withinTolerance: max <= budget,
    convergence: history,
  };
}

/** The knot list as source, in the form the model already uses. */
export function asSource(name, fit, { indent = "  " } = {}) {
  const rows = fit.knots.map(([x, v]) => `[${x}, ${v}]`);
  const body = rows.join(", ");
  const wrapped = body.length <= 96
    ? `const ${name} = interp([${body}]);`
    : `const ${name} = interp([\n${indent}${rows.join(`,\n${indent}`)},\n]);`;
  return `// Fitted to the reference drawing: ${fit.count} knots, max error `
    + `${fit.maxError_mm} mm, mean ${fit.meanError_mm} mm.\n${wrapped}`;
}
