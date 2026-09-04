// The model's own outline, taken from geometry.
//
// A drawing shows an outline, so comparing like with like means an outline, not
// a section: the widest point of the body at a station may be at any z, and a
// section through the centreline would miss it. Projecting every triangle onto
// the x-y plane and keeping the extremes per column is exactly what an
// orthographic drawing is, computed instead of photographed.

import { round } from "./load.mjs";

export function sideSilhouette(model, { bins = 400, exclude = [] } = {}) {
  const skip = new Set(exclude);
  const { min, max } = model.bounds;
  const x0 = min.x;
  const x1 = max.x;
  const top = new Float64Array(bins).fill(Number.NEGATIVE_INFINITY);
  const bottom = new Float64Array(bins).fill(Number.POSITIVE_INFINITY);

  const binOf = (x) => Math.min(bins - 1, Math.max(0, Math.floor(((x - x0) / (x1 - x0)) * bins)));

  for (const [name, entry] of model.parts) {
    if (skip.has(name)) continue;
    for (let i = entry.triangleStart; i < entry.triangleStart + entry.triangleCount; i += 1) {
      const t = model.triangles[i];
      // Rasterise the triangle across the columns it spans, so a long thin
      // triangle cannot slip between bins and leave a notch in the outline.
      const xs = [t[0], t[3], t[6]];
      const ys = [t[1], t[4], t[7]];
      const lo = binOf(Math.min(xs[0], xs[1], xs[2]));
      const hi = binOf(Math.max(xs[0], xs[1], xs[2]));
      for (let b = lo; b <= hi; b += 1) {
        const cx = x0 + ((x1 - x0) * (b + 0.5)) / bins;
        // Interpolate the triangle's y range at this column.
        let yMin = Number.POSITIVE_INFINITY;
        let yMax = Number.NEGATIVE_INFINITY;
        let hit = false;
        for (let e = 0; e < 3; e += 1) {
          const a = e;
          const c = (e + 1) % 3;
          const xa = xs[a];
          const xc = xs[c];
          if ((xa < cx && xc < cx) || (xa > cx && xc > cx) || xa === xc) continue;
          const k = (cx - xa) / (xc - xa);
          const y = ys[a] + (ys[c] - ys[a]) * k;
          if (y < yMin) yMin = y;
          if (y > yMax) yMax = y;
          hit = true;
        }
        if (!hit) {
          // The column falls inside a triangle with no crossing edge only when
          // the triangle is degenerate in x; use its own extent.
          yMin = Math.min(ys[0], ys[1], ys[2]);
          yMax = Math.max(ys[0], ys[1], ys[2]);
        }
        if (yMax > top[b]) top[b] = yMax;
        if (yMin < bottom[b]) bottom[b] = yMin;
      }
    }
  }

  const topOut = [];
  const bottomOut = [];
  for (let b = 0; b < bins; b += 1) {
    if (top[b] === Number.NEGATIVE_INFINITY) continue;
    const x = x0 + ((x1 - x0) * (b + 0.5)) / bins;
    topOut.push([round(x, 5), round(top[b], 5)]);
    bottomOut.push([round(x, 5), round(bottom[b], 5)]);
  }
  return { bins, top: topOut, bottom: bottomOut };
}

/**
 * Model against reference, station by station, in millimetres.
 *
 * Both are sampled onto the same ladder before comparison, because the two
 * sources have different native spacing and comparing them where they happen
 * to have points is a measurement of the sampling.
 */
export const WHEELS = ["wheelFL", "wheelFR", "wheelRL", "wheelRR"];

/**
 * Deviation broken down by region, because one number cannot judge the whole
 * underside.
 *
 * A side elevation's lower outline is not one feature. At the axles it is the
 * tyre contact patch and reads 0.000 on both the drawing and the model. Between
 * them it is whatever hangs lowest — and there the drawing shows 343 mm where
 * this model's lowest element sits at 244 mm, which is exactly the published
 * ground clearance. Those may both be right: a clearance figure is the minimum
 * anywhere, and the visible line at mid-wheelbase may be the rocker. Averaged
 * together they produce a number that is wrong about both.
 */
export function deviationByRegion(modelProfile, referenceProfile, { axleX = 1.468, ...options } = {}) {
  const regions = [
    { name: "rear overhang", to: -axleX - 0.35 },
    { name: "rear wheel", from: -axleX - 0.35, to: -axleX + 0.35 },
    { name: "between axles", from: -axleX + 0.35, to: axleX - 0.35 },
    { name: "front wheel", from: axleX - 0.35, to: axleX + 0.35 },
    { name: "front overhang", from: axleX + 0.35 },
  ];
  const full = deviation(modelProfile, referenceProfile, options);
  return {
    overall: {
      medianAbs_mm: full.medianAbs_mm,
      p95Abs_mm: full.p95Abs_mm,
      maxAbs_mm: full.maxAbs_mm,
    },
    regions: regions.map((region) => {
      const rows = full.rows.filter(
        (r) => (region.from === undefined || r.x >= region.from)
          && (region.to === undefined || r.x <= region.to),
      );
      if (!rows.length) return { region: region.name, stations: 0 };
      const abs = rows.map((r) => Math.abs(r.deviation_mm)).sort((a, b) => a - b);
      const worst = rows.reduce((a, b) => (Math.abs(b.deviation_mm) > Math.abs(a.deviation_mm) ? b : a));
      return {
        region: region.name,
        stations: rows.length,
        medianAbs_mm: round(abs[Math.floor(abs.length / 2)], 2),
        maxAbs_mm: round(abs[abs.length - 1], 2),
        worstAt_x: worst.x,
        model_m: worst.model_m,
        reference_m: worst.reference_m,
      };
    }),
  };
}

export function deviation(modelProfile, referenceProfile, {
  stations = 120,
  from,
  to,
  // Trim the extreme ends by default. Where the outline turns vertical — the
  // last few centimetres of the nose and tail — the two curves are comparing a
  // height against a near-vertical face, so a millimetre of disagreement in x
  // reads as half a metre in y. That number is real and says nothing about the
  // shape. Trimming is stated in the result rather than done silently.
  trim = 0.03,
} = {}) {
  const at = (points, x) => {
    let lo = 0;
    let hi = points.length - 1;
    if (x <= points[0][0]) return points[0][1];
    if (x >= points[hi][0]) return points[hi][1];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid][0] <= x) lo = mid; else hi = mid;
    }
    const [x0, y0] = points[lo];
    const [x1, y1] = points[hi];
    return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  };

  const rawStart = Math.max(modelProfile[0][0], referenceProfile[0][0]);
  const rawEnd = Math.min(
    modelProfile[modelProfile.length - 1][0],
    referenceProfile[referenceProfile.length - 1][0],
  );
  const span = rawEnd - rawStart;
  const start = from ?? rawStart + span * trim;
  const end = to ?? rawEnd - span * trim;

  const rows = [];
  for (let i = 0; i < stations; i += 1) {
    const x = start + ((end - start) * i) / (stations - 1);
    const model = at(modelProfile, x);
    const reference = at(referenceProfile, x);
    rows.push({ x: round(x, 4), model_m: round(model, 5), reference_m: round(reference, 5), deviation_mm: round((model - reference) * 1000, 2) });
  }

  const abs = rows.map((r) => Math.abs(r.deviation_mm)).sort((a, b) => a - b);
  const worst = rows.reduce((a, b) => (Math.abs(b.deviation_mm) > Math.abs(a.deviation_mm) ? b : a));
  const percentile = (q) => abs[Math.min(abs.length - 1, Math.floor(q * abs.length))];
  return {
    domain: { from: round(start, 4), to: round(end, 4), trimmedFraction: trim },
    stations: rows.length,
    meanAbs_mm: round(abs.reduce((a, b) => a + b, 0) / abs.length, 2),
    // The median and p95 matter more than the mean here: one genuinely
    // disagreeing feature drags a mean and leaves the rest of the curve
    // looking worse than it is.
    medianAbs_mm: round(percentile(0.5), 2),
    p95Abs_mm: round(percentile(0.95), 2),
    maxAbs_mm: round(abs[abs.length - 1], 2),
    worst,
    rows,
  };
}
