// The reference side of the loop.
//
// A calibrated orthographic drawing, reduced to profiles in the model's own
// frame. The image work is r2-blueprint/tools/measure_ortho.py, which anchors y
// on the ground and roof, anchors x on the two axles, and warps the overhangs
// so the nose and tail land on the published length. This module consumes that
// output — and re-checks it, because finding 02 says a reference is not trusted
// until two known dimensions from it agree.

import { readFile } from "node:fs/promises";
import { round } from "./load.mjs";

/**
 * Load a side profile, and refuse one whose calibration does not hold up.
 *
 * The check is the point. The official side drawing is self-consistent in
 * wheelbase and height and about 5% short overall — a fact that is invisible
 * until you measure two things from it and find they disagree. A reference that
 * passes silently here has earned the trust the fit is about to place in it.
 */
export async function loadSideProfile(path, spec, { tolerance = 0.02 } = {}) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  for (const key of ["top", "bottom", "drawn_height", "drawn_length"]) {
    if (!(key in raw)) throw new Error(`${path} is not a side profile: missing "${key}"`);
  }

  const heightError = Math.abs(raw.drawn_height - spec.height) / spec.height;
  const lengthError = Math.abs(raw.drawn_length - spec.length) / spec.length;

  const checks = [
    { landmark: "height", drawn: round(raw.drawn_height), published: spec.height, error: round(heightError, 4) },
    { landmark: "length", drawn: round(raw.drawn_length), published: spec.length, error: round(lengthError, 4) },
  ];
  const agreeing = checks.filter((c) => c.error <= tolerance);

  // At least one landmark must hold, or the drawing is not calibrated at all.
  // Both holding is ideal; one holding is the documented situation here, and it
  // is reported rather than hidden, because the fit inherits it.
  if (!agreeing.length) {
    throw new Error(
      `${path}: no landmark agrees with the specification within ${tolerance * 100}% — `
      + checks.map((c) => `${c.landmark} drawn ${c.drawn} vs ${c.published}`).join(", "),
    );
  }

  const xs = raw.top.map((p) => p[0]);
  return {
    kind: "side",
    path,
    samples: raw.top.length,
    domain: { min: round(Math.min(...xs)), max: round(Math.max(...xs)) },
    calibration: {
      checks,
      trustedLandmarks: agreeing.map((c) => c.landmark),
      // Named plainly so a knot list fitted to this cannot be mistaken for one
      // fitted to a drawing that was right in every dimension.
      note: agreeing.length === checks.length
        ? "Both landmarks agree; the drawing is calibrated in x and y."
        : `Only ${agreeing.map((c) => c.landmark).join(" and ")} agrees. The extractor warps the`
          + " overhangs to the published length, so shape is preserved and the known dimensions"
          + " are met, but absolute x away from the axles inherits that warp.",
    },
    top: raw.top.map(([x, y]) => [round(x, 5), round(y, 5)]),
    bottom: raw.bottom.map(([x, y]) => [round(x, 5), round(y, 5)]),
  };
}

/** Load the front drawing's half-width-by-height curve. */
export async function loadFrontProfile(path, spec, { tolerance = 0.02 } = {}) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  if (!raw.half_width_by_height) throw new Error(`${path} is not a front profile`);
  const error = Math.abs(raw.drawn_width - spec.widthMirrors) / spec.widthMirrors;
  if (error > tolerance) {
    throw new Error(
      `${path}: drawn width ${round(raw.drawn_width)} disagrees with ${spec.widthMirrors} by `
      + `${round(error * 100, 2)}%`,
    );
  }
  return {
    kind: "front",
    path,
    samples: raw.half_width_by_height.length,
    calibration: {
      checks: [{ landmark: "widthOverMirrors", drawn: round(raw.drawn_width), published: spec.widthMirrors, error: round(error, 4) }],
      trustedLandmarks: ["widthOverMirrors"],
      note: "Front drawings calibrate on width alone; height comes from the side drawing.",
    },
    halfWidthByHeight: raw.half_width_by_height.map(([y, h]) => [round(y, 5), round(h, 5)]),
  };
}

/**
 * Put a reference profile into the model's frame, using the axles.
 *
 * The two frames are not the same, and the difference is invisible until it is
 * measured. The extractor's own docstring places the nose at +2.361 — the
 * vehicle centred on its LENGTH — while the model is centred on its WHEELBASE,
 * putting the nose at +2.310 and the tail at -2.412 because the overhangs
 * differ by 102 mm. The frames agree to about 10 mm at the axles and disagree
 * by about 51 mm at each end.
 *
 * Comparing them unaligned measures that offset and calls it shape error. So
 * align on the landmarks that cannot move — the tyre contact patches — and
 * report the transform, because a corrected comparison that hides its
 * correction is worse than an uncorrected one.
 */
export function alignToAxles(profile, { groundTolerance = 0.002, modelAxleX, publishedWheelbase }) {
  const contacts = [];
  for (const [x, y] of profile.bottom) {
    if (y > groundTolerance) continue;
    const group = contacts.find((g) => Math.abs(g[g.length - 1] - x) < 0.15);
    if (group) group.push(x); else contacts.push([x]);
  }
  if (contacts.length !== 2) {
    throw new Error(
      `expected two ground contact patches in the reference, found ${contacts.length}`,
    );
  }
  const centres = contacts.map((g) => g.reduce((a, b) => a + b, 0) / g.length).sort((a, b) => a - b);
  const [rear, front] = centres;
  const drawnWheelbase = front - rear;
  const drawnCentre = (front + rear) / 2;

  // Scale so the drawn wheelbase becomes the published one, then shift so its
  // centre lands on the model's wheelbase centre. Rigid in y: the extractor
  // already anchored that on the ground and the roof, and it agreed to 0.06%.
  const scale = publishedWheelbase / drawnWheelbase;
  const shift = -drawnCentre * scale;
  const map = ([x, y]) => [round(x * scale + shift, 5), round(y, 5)];

  return {
    ...profile,
    top: profile.top.map(map),
    bottom: profile.bottom.map(map),
    domain: {
      min: round(profile.domain.min * scale + shift, 5),
      max: round(profile.domain.max * scale + shift, 5),
    },
    alignment: {
      drawnContactPatches_x: centres.map((c) => round(c, 4)),
      drawnWheelbase_m: round(drawnWheelbase, 4),
      publishedWheelbase_m: publishedWheelbase,
      scale: round(scale, 6),
      shift_mm: round(shift * 1000, 2),
      wheelbaseCorrection_mm: round((publishedWheelbase - drawnWheelbase) * 1000, 2),
      note: `Aligned on the tyre contact patches. Before alignment the drawing's `
        + `wheelbase centre sat ${round(drawnCentre * 1000, 1)} mm forward of the model's, and its `
        + `wheelbase was ${round((publishedWheelbase - drawnWheelbase) * 1000, 1)} mm short. `
        + `Unaligned, that offset is measured as shape error at the overhangs.`,
      modelAxleX,
    },
  };
}

/**
 * Resample a profile onto evenly spaced stations.
 *
 * The extractor emits one sample per pixel column, which is denser than any
 * curve needs and unevenly weighted once the overhangs are warped. Everything
 * downstream — knot fitting, deviation — wants a regular ladder.
 */
export function resample(points, { from, to, count = 200, allowExtrapolation = false }) {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  // Refuse to invent data outside the source. Asked for a range wider than the
  // reference covers, the old version clamped to the endpoint and handed back
  // a flat run of the last value — which a knot fitter turns into real-looking
  // knots. That produced a roofline at the tail of 0.976 m from a drawing that
  // says nothing about that station at all.
  if (!allowExtrapolation) {
    const lo = sorted[0][0];
    const hi = sorted[sorted.length - 1][0];
    if (from < lo - 1e-9 || to > hi + 1e-9) {
      throw new RangeError(
        `requested ${round(from, 4)}..${round(to, 4)} but the profile only covers `
        + `${round(lo, 4)}..${round(hi, 4)} — intersect the domains, or pass allowExtrapolation`,
      );
    }
  }
  const out = [];
  let cursor = 0;
  for (let i = 0; i < count; i += 1) {
    const x = from + ((to - from) * i) / (count - 1);
    while (cursor < sorted.length - 2 && sorted[cursor + 1][0] < x) cursor += 1;
    const [x0, y0] = sorted[cursor];
    const [x1, y1] = sorted[Math.min(cursor + 1, sorted.length - 1)];
    const k = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
    out.push([round(x, 5), round(y0 + (y1 - y0) * Math.max(0, Math.min(1, k)), 5)]);
  }
  return out;
}
