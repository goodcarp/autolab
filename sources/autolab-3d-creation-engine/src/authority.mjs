// Which stations does a curve actually control?
//
// The alternative was a hand-written map declaring "ZROOF corresponds to the
// silhouette top between here and here". That map is wrong the moment the model
// is refactored, and nothing tells you it has gone wrong — it just quietly
// fits the wrong curve to the wrong measurement.
//
// So derive it instead. Shift the curve by a millimetre in a scratch copy,
// rebuild, and see which stations move. Those are the stations that curve has
// authority over, measured from the model as it is now rather than as someone
// remembered it.
//
// This is also the positive control the fit needs: if a curve's knots change
// and nothing in the silhouette responds, the fitter has no business editing it
// — either the correspondence is wrong or the kernel has leaked a constant, and
// both are worth knowing before writing anything.

import { round } from "./load.mjs";
import { evaluateX, readCurves } from "./curves.mjs";
import { buildVariant, spliceCurve } from "./apply.mjs";
import { sideSilhouette } from "./silhouette.mjs";

const PROBE_M = 0.001;

/**
 * The stations a curve moves, and the parts it moves.
 *
 * `threshold_mm` is deliberately well below the probe: a 1 mm shift that
 * produces a 0.3 mm response is still a response. Anything at floating-point
 * noise is not.
 */
export async function authorityOf(modelPath, curveName, {
  probe_m = PROBE_M,
  threshold_mm = 0.15,
  bins = 300,
} = {}) {
  const { source, curves } = await readCurves(modelPath);
  const curve = curves.find((c) => c.name === curveName);
  if (!curve) throw new Error(`no curve named ${curveName}`);
  if (!curve.writable) throw new Error(`${curveName}: ${curve.reason}`);

  const base = await buildVariant(modelPath, source);
  const spec = base.model.spec;

  const shifted = `[${curve.knots.map((k) => {
    const v = Number.parseFloat(k.vSource);
    return `[${k.xSource}, ${Number.isFinite(v) ? round(v + probe_m, 6) : k.vSource}]`;
  }).join(", ")}]`;
  const probe = await buildVariant(modelPath, spliceCurve(source, curve, shifted));

  const a = sideSilhouette(base.model, { bins });
  const b = sideSilhouette(probe.model, { bins });

  const responded = [];
  for (let i = 0; i < Math.min(a.top.length, b.top.length); i += 1) {
    const dTop = Math.abs(a.top[i][1] - b.top[i][1]) * 1000;
    const dBottom = Math.abs(a.bottom[i][1] - b.bottom[i][1]) * 1000;
    if (Math.max(dTop, dBottom) >= threshold_mm) {
      responded.push({ x: a.top[i][0], top_mm: round(dTop, 3), bottom_mm: round(dBottom, 3) });
    }
  }

  // Which named parts moved. If a curve's knots change and a part that is
  // supposed to derive from it comes back identical, the derivation has leaked
  // a constant somewhere — a real defect, found by trying to write.
  const movedParts = [];
  for (const [name] of base.model.parts) {
    const before = base.model.partTriangles(name);
    const after = probe.model.partTriangles(name);
    if (!before?.length || !after?.length || before.length !== after.length) {
      movedParts.push({ part: name, note: "geometry count changed" });
      continue;
    }
    let worst = 0;
    for (let i = 0; i < before.length; i += 1) {
      for (let k = 0; k < 9; k += 1) {
        const d = Math.abs(before[i][k] - after[i][k]);
        if (d > worst) worst = d;
      }
    }
    if (worst * 1000 >= threshold_mm) movedParts.push({ part: name, moved_mm: round(worst * 1000, 3) });
  }

  const xs = responded.map((r) => r.x);
  const knotXs = curve.knots.map((k) => evaluateX(k.xSource, spec)).filter((v) => v !== null);

  return {
    curve: curveName,
    probe_mm: round(probe_m * 1000, 2),
    threshold_mm,
    respondingStations: responded.length,
    totalStations: a.top.length,
    // The window the model says this curve owns, which is the only window a fit
    // has any business touching.
    authority: xs.length ? { from: round(Math.min(...xs), 4), to: round(Math.max(...xs), 4) } : null,
    declaredDomain: knotXs.length
      ? { from: round(Math.min(...knotXs), 4), to: round(Math.max(...knotXs), 4) }
      : null,
    // Which surface it drives. A curve that only moves the lower outline should
    // never be fitted to the upper one.
    drives: {
      top: responded.some((r) => r.top_mm >= threshold_mm),
      bottom: responded.some((r) => r.bottom_mm >= threshold_mm),
    },
    movedParts,
    // The control: a curve nothing responds to cannot be verified, so it cannot
    // be written.
    verifiable: responded.length > 0,
  };
}
