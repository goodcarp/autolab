// Did the fit keep the shape, or only the average?
//
// A refit that lowers mean deviation can still be a regression. Writing ZROOF
// from the axle-aligned drawing improved the mean from 7.10 mm to 5.46 mm and
// cut a 263 mm notch into the rear roofline — 1.245 down to 0.982 and back to
// 1.250 across forty millimetres. The mean cannot see that, because a notch
// forty millimetres wide barely moves an average taken over four metres.
//
// The cause was a boundary: a knot preserved just outside the fitting window
// described the roof, and the first fitted knot just inside it described the
// drawing's tail extremity, where the outline drops to the bumper. Two knots
// eleven millimetres apart, describing different features, with 269 mm between
// their values.
//
// So the acceptance rule needs a shape term as well as a distance term. A fit
// may move the curve; it may not add wiggles the curve did not have, and it may
// not introduce a slope the curve never had.

import { round } from "./load.mjs";

function sample(curve, from, to, count = 600) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const x = from + ((to - from) * i) / (count - 1);
    out.push([x, curve(x)]);
  }
  return out;
}

/**
 * Count direction changes worth caring about, by how DEEP the reversal is.
 *
 * Counting every reversal above a fixed deadband measures noise: this roof is
 * flat to within a millimetre over two metres, so a 0.3 mm ripple registers as
 * a direction change while a 263 mm notch registers as exactly one more. The
 * question is not whether the curve turned but how far it came back — the same
 * idea as topographic prominence. A reversal of a quarter of a millimetre is
 * not a feature of the shape; one of a quarter of a metre is.
 */
function turningPoints(points, minProminence) {
  // Local extrema first, ignoring flat runs.
  const extrema = [];
  let direction = 0;
  for (let i = 1; i < points.length; i += 1) {
    const delta = points[i][1] - points[i - 1][1];
    if (delta === 0) continue;
    const next = Math.sign(delta);
    if (direction !== 0 && next !== direction) {
      extrema.push({ x: points[i - 1][0], v: points[i - 1][1] });
    }
    direction = next;
  }

  // Then keep only the ones the curve actually comes back from, by at least
  // minProminence on both sides.
  const marks = [];
  for (const point of extrema) {
    const index = points.findIndex((p) => p[0] === point.x);
    let leftSwing = 0;
    for (let i = index; i >= 0; i -= 1) {
      const swing = Math.abs(points[i][1] - point.v);
      if (swing > leftSwing) leftSwing = swing;
      if (leftSwing >= minProminence) break;
    }
    let rightSwing = 0;
    for (let i = index; i < points.length; i += 1) {
      const swing = Math.abs(points[i][1] - point.v);
      if (swing > rightSwing) rightSwing = swing;
      if (rightSwing >= minProminence) break;
    }
    if (Math.min(leftSwing, rightSwing) >= minProminence) marks.push(round(point.x, 4));
  }
  return { count: marks.length, marks };
}

/** The steepest the curve gets, in millimetres of rise per metre of run. */
function maxSlope(points) {
  let worst = 0;
  let at = null;
  for (let i = 1; i < points.length; i += 1) {
    const run = points[i][0] - points[i - 1][0];
    if (run === 0) continue;
    const slope = Math.abs((points[i][1] - points[i - 1][1]) / run);
    if (slope > worst) { worst = slope; at = points[i][0]; }
  }
  return { slope: worst, at: at === null ? null : round(at, 4) };
}

/**
 * Compare the shape of two versions of the same curve.
 *
 * `slopeTolerance` allows a fit to be a little steeper than the original —
 * refitting a curve to a drawing legitimately sharpens features the hand-placed
 * knots had rounded off. It does not allow a cliff.
 */
export function shapeCheck(before, after, {
  from,
  to,
  // How far a reversal must come back to count as a feature rather than a
  // ripple. Two millimetres is well under anything visible on a body panel and
  // well over the sub-millimetre wobble a fitter leaves on a flat roof.
  minProminence_mm = 2,
  slopeTolerance = 1.6,
} = {}) {
  const a = sample(before, from, to);
  const b = sample(after, from, to);

  const prominence = minProminence_mm / 1000;
  const turnsBefore = turningPoints(a, prominence);
  const turnsAfter = turningPoints(b, prominence);
  const slopeBefore = maxSlope(a);
  const slopeAfter = maxSlope(b);

  const addedTurns = turnsAfter.count - turnsBefore.count;
  const slopeRatio = slopeBefore.slope > 0 ? slopeAfter.slope / slopeBefore.slope : Infinity;

  const problems = [];
  if (addedTurns > 0) {
    problems.push(
      `adds ${addedTurns} direction change${addedTurns === 1 ? "" : "s"} the curve did not have`
      + `${turnsAfter.marks.length ? ` (near x = ${turnsAfter.marks.slice(0, 4).join(", ")})` : ""}`,
    );
  }
  if (slopeRatio > slopeTolerance) {
    problems.push(
      `is ${round(slopeRatio, 2)}x steeper than the original at its worst `
      + `(${round(slopeAfter.slope * 1000, 0)} mm/m at x = ${slopeAfter.at}, was `
      + `${round(slopeBefore.slope * 1000, 0)} mm/m)`,
    );
  }

  return {
    turningPoints: {
      before: turnsBefore.count,
      after: turnsAfter.count,
      added: addedTurns,
      minProminence_mm,
    },
    maxSlope_mm_per_m: {
      before: round(slopeBefore.slope * 1000, 0),
      after: round(slopeAfter.slope * 1000, 0),
      ratio: round(slopeRatio, 2),
      at: slopeAfter.at,
    },
    problems,
    // A distance term and a shape term. Both have to pass.
    preservesShape: problems.length === 0,
  };
}
