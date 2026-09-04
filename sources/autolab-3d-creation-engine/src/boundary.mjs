// Where does the reference stop describing this curve?
//
// The notch that had to be reverted came from a fitting window whose edge fell
// somewhere the drawing was describing something else. At x = -2.379 the roof
// curve read 1.245 and the drawing's outline read 0.976, because by that
// station the drawing's outline has stopped being the roof and become the
// tailgate. Fitting across that edge splices two different features together.
//
// The tell is available before any fitting happens, and it is not the size of
// the disagreement — a curve being refitted is expected to disagree with the
// reference, that is the point. The tell is that the disagreement at the edge
// is an ORDER OF MAGNITUDE larger than the disagreement everywhere else.
// Five to seven millimetres across the roof, 269 at the tail.
//
// So: measure the disagreement across the declared window, take its median as
// what "this curve and this reference disagreeing normally" looks like, and
// walk inward from each end while the disagreement is a wild multiple of that.
// What is left is the window over which the two are talking about the same
// thing.

import { round } from "./load.mjs";

/**
 * Trim a fitting window to where the reference plausibly describes this curve.
 *
 * `outlierFactor` is what counts as wild. Six times the median disagreement is
 * far outside anything a refit legitimately produces and far inside the two
 * orders of magnitude the tail boundary showed.
 */
export function agreementWindow(curve, referenceAt, { from, to, samples = 300, outlierFactor = 6, floor_mm = 25 }) {
  const rows = [];
  for (let i = 0; i < samples; i += 1) {
    const x = from + ((to - from) * i) / (samples - 1);
    rows.push({ x, gap: Math.abs(curve(x) - referenceAt(x)) });
  }

  const sorted = rows.map((r) => r.gap).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  // A floor, so a curve that already matches the reference almost exactly does
  // not get a threshold of nearly zero and trim itself out of existence.
  const limit = Math.max(median * outlierFactor, floor_mm / 1000);

  let lo = 0;
  while (lo < rows.length && rows[lo].gap > limit) lo += 1;
  let hi = rows.length - 1;
  while (hi > lo && rows[hi].gap > limit) hi -= 1;

  const trimmedFront = lo > 0 ? round(rows[lo].x - from, 4) : 0;
  const trimmedBack = hi < rows.length - 1 ? round(to - rows[hi].x, 4) : 0;

  return {
    declared: { from: round(from, 4), to: round(to, 4) },
    window: lo <= hi ? { from: round(rows[lo].x, 4), to: round(rows[hi].x, 4) } : null,
    medianGap_mm: round(median * 1000, 2),
    limit_mm: round(limit * 1000, 2),
    trimmed_m: { front: trimmedFront, back: trimmedBack },
    // What was cut, and how badly it disagreed — the number that says the
    // reference had stopped describing this curve.
    worstTrimmed_mm: lo > 0 || hi < rows.length - 1
      ? round(Math.max(
        ...rows.slice(0, lo).map((r) => r.gap),
        ...rows.slice(hi + 1).map((r) => r.gap),
        0,
      ) * 1000, 1)
      : 0,
    usable: lo <= hi && rows[hi].x - rows[lo].x > (to - from) * 0.2,
  };
}

/**
 * Does the spliced curve join cleanly to the knots it did not touch?
 *
 * Even a correctly trimmed window has two seams. The last preserved knot and
 * the first fitted one are neighbours in the final list, and if the step
 * between them implies a slope the curve never had, the join is the defect —
 * regardless of how well the fitted part matches the reference.
 */
export function seamCheck(preserved, fitted, { maxSlope_mm_per_m, tolerance = 1.6 }) {
  const seams = [];
  const all = [...preserved.map((p) => ({ ...p, kind: "preserved" })),
    ...fitted.map((f) => ({ x: f[0], v: f[1], kind: "fitted" }))]
    .sort((a, b) => a.x - b.x);

  for (let i = 1; i < all.length; i += 1) {
    const a = all[i - 1];
    const b = all[i];
    if (a.kind === b.kind) continue;
    const run = b.x - a.x;
    if (run === 0) continue;
    const slope = Math.abs((b.v - a.v) / run) * 1000;
    if (slope > maxSlope_mm_per_m * tolerance) {
      seams.push({
        between: [round(a.x, 4), round(b.x, 4)],
        values: [round(a.v, 4), round(b.v, 4)],
        slope_mm_per_m: round(slope, 0),
        limit_mm_per_m: round(maxSlope_mm_per_m * tolerance, 0),
      });
    }
  }
  return { seams, clean: seams.length === 0 };
}
