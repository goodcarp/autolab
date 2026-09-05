// Calibration.
//
// Measure, Don't Look, finding 03: "Every measurement harness needs a
// self-test." A measurement tool with no self-test produced a confident,
// precise, wrong answer, and it was believed.
//
// Finding 12 adds the other half: a positive control. An instrument that has
// never been seen to respond has not been calibrated, and a null result from it
// is silence, not evidence. So each instrument here is driven against a
// synthetic fixture whose answer is known by construction, in both directions:
// once where it must report a value, once where it must report a different one.
//
// The gate at the end is finding 03's rule taken literally — refuse to measure
// a real model until the axle-to-axle distance comes back as the published
// wheelbase.

import process from "node:process";
import { Box3, Vector3 } from "three";
import { boundsOf, loadModel, round } from "./load.mjs";
import { extremes, keyDimensions } from "./ruler.mjs";
import { sectionSymmetry, sliceAt, widthAt } from "./section.mjs";
import { clearance } from "./clearance.mjs";
import { fitReport, loadSpec } from "./fit.mjs";
import { fitKnots } from "./knots.mjs";
import { deviation, sideSilhouette } from "./silhouette.mjs";
import { alignToAxles, loadSideProfile, resample } from "./reference.mjs";
import { anchorFor, evaluateX, readCurves, renderKnots } from "./curves.mjs";
import { buildVariant, precondition, spliceCurve, unifiedDiff } from "./apply.mjs";
import { shapeCheck } from "./shape.mjs";

/** A box, as triangles, in world coordinates. */
function boxTriangles(cx, cy, cz, sx, sy, sz) {
  const hx = sx / 2; const hy = sy / 2; const hz = sz / 2;
  const v = [
    [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz],
    [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz],
    [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz],
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1], [3, 2, 6], [3, 6, 7],
    [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2],
  ];
  return faces.map(([a, b, c]) => [...v[a], ...v[b], ...v[c]]);
}

/** A fixture whose every dimension is known by construction. */
function fixture() {
  const parts = new Map();
  const triangles = [];
  const add = (name, label, category, tris) => {
    parts.set(name, {
      name, label, category, description: label,
      triangleStart: triangles.length, triangleCount: tris.length, meshCount: 1,
    });
    triangles.push(...tris);
  };

  // A 4.000 x 1.800 x 1.500 box sitting on the ground, wheels at +/-1.200 and
  // +/-0.700, so wheelbase is exactly 2.400 and track exactly 1.400.
  add("body", "Body", "shell", boxTriangles(0, 0.75, 0, 4.0, 1.5, 1.8));
  for (const [name, x, z] of [
    ["wheelFL", 1.2, -0.7], ["wheelFR", 1.2, 0.7],
    ["wheelRL", -1.2, -0.7], ["wheelRR", -1.2, 0.7],
  ]) {
    add(name, `Wheel ${name.slice(5)}`, "running", boxTriangles(x, 0.35, z, 0.7, 0.7, 0.25));
  }
  // Two 400 mm blocks whose facing surfaces are exactly 100 mm apart: centres
  // at z = -0.25 and +0.25, so they span [-0.45, -0.05] and [+0.05, +0.45].
  //
  // The first version of this put the centres at +/-0.3 and called the gap
  // 100 mm. The instrument dutifully answered 200 mm and the self-test failed —
  // correctly, against a wrong expectation. That is what a self-test is for,
  // and it is worth leaving the story here: the number under suspicion was the
  // right one twice in a row on this project.
  add("blockA", "Block A", "chassis", boxTriangles(0, 2.5, -0.25, 0.4, 0.4, 0.4));
  add("blockB", "Block B", "chassis", boxTriangles(0, 2.5, 0.25, 0.4, 0.4, 0.4));

  const bounds = boundsOf(triangles);
  return {
    path: "<fixture>", spec: null, vehicle: null, parts, triangles, bounds,
    partTriangles(name) {
      const e = parts.get(name);
      return e ? triangles.slice(e.triangleStart, e.triangleStart + e.triangleCount) : null;
    },
  };
}

const rows = [];
const check = (name, passed, note = "") => {
  rows.push({ name, passed, note });
  process.stdout.write(`${passed ? "PASS" : "FAIL"}  ${name}${note ? ` — ${note}` : ""}\n`);
  return passed;
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const f = fixture();

// --- the ruler ---------------------------------------------------------------
{
  const d = keyDimensions(f);
  check("ruler: wheelbase of a known fixture", near(d.wheelbase_m, 2.4), `${d.wheelbase_m} m, expected 2.4`);
  check("ruler: track of a known fixture", near(d.frontTrack_m, 1.4), `${d.frontTrack_m} m, expected 1.4`);
  check("ruler: length of a known fixture", near(d.length_m, 4.0), `${d.length_m} m, expected 4.0`);
  check("ruler: ground plane is the lowest point", near(d.landmarks.groundPlane_y_m, 0), `${d.landmarks.groundPlane_y_m}`);
  // Negative control: a fixture with no wheels must not invent a wheelbase.
  const noWheels = fixture();
  for (const w of ["wheelFL", "wheelFR", "wheelRL", "wheelRR"]) noWheels.parts.delete(w);
  check("ruler: reports null rather than guessing a wheelbase",
    keyDimensions(noWheels).wheelbase_m === null);
}

// --- extremes ----------------------------------------------------------------
{
  const e = extremes(f);
  check("extremes: names the part that owns the top", e.y.max.part === "blockA" || e.y.max.part === "blockB",
    `${e.y.max.part} at ${e.y.max.value_m} m`);
  check("extremes: names the part that owns the nose", e.x.max.part === "body", e.x.max.part);
}

// --- the slicer --------------------------------------------------------------
{
  // Through the body only: a 1.800 x 1.500 rectangle.
  const w = widthAt(f, 0, { yMin: 0.1, yMax: 1.4 });
  check("slicer: width of a known section", near(w.width_m, 1.8, 1e-6), `${w.width_m} m, expected 1.8`);

  const cut = sliceAt(f, 0);
  check("slicer: a closed box yields closed loops", cut.closed >= 1 && cut.openCount === 0,
    `${cut.closed} closed, ${cut.openCount} open`);

  // Positive control: a station beyond the model must produce nothing.
  check("slicer: no geometry outside the model", sliceAt(f, 99).segments.length === 0);
}

// --- symmetry ----------------------------------------------------------------
{
  const symmetric = sectionSymmetry(f, { stations: 9, heights: 9 });
  check("symmetry: a symmetric fixture reads symmetric", symmetric.symmetric_fraction > 0.99,
    `${symmetric.symmetric_fraction}`);

  // Negative control: nudge one side and it must notice.
  const skewed = fixture();
  const lump = boxTriangles(0, 1.0, 1.4, 0.5, 0.5, 0.5);
  const start = skewed.triangles.length;
  skewed.triangles.push(...lump);
  skewed.parts.set("lump", {
    name: "lump", label: "Lump", category: "shell", description: "",
    triangleStart: start, triangleCount: lump.length, meshCount: 1,
  });
  skewed.bounds = boundsOf(skewed.triangles);
  const asym = sectionSymmetry(skewed, { stations: 9, heights: 9 });
  check("symmetry: a lump on one side is detected", asym.symmetric_fraction < 0.99,
    `${asym.symmetric_fraction}`);
}

// --- clearance ---------------------------------------------------------------
{
  const c = clearance(f, "blockA", "blockB");
  check("clearance: a known 100 mm gap measures 100 mm", near(c.nearestSurfaces_mm, 100, 0.1),
    `${c.nearestSurfaces_mm} mm`);
  check("clearance: the exact axis gap agrees", near(c.boundingBoxGap_mm.z, 100, 0.1),
    `${c.boundingBoxGap_mm.z} mm`);
  // The distinction the digital twin's own measure tool does not draw.
  check("clearance: centre-to-centre is reported separately and differs",
    c.centreToCentre_mm > c.nearestSurfaces_mm,
    `centre ${c.centreToCentre_mm} mm vs surfaces ${c.nearestSurfaces_mm} mm`);
}

// --- fit ---------------------------------------------------------------------
{
  const spec = {
    id: "fixture", units: "m", tolerances_mm: { default: 1 },
    dimensions: { wheelbase_m: 2.4, frontTrack_m: 1.4, length_m: 4.0 },
  };
  const report = fitReport(f, spec);
  check("fit: a matching spec reports zero deviation",
    report.summary.out === 0 && report.summary.meanDeviation_mm === 0,
    `${report.summary.within}/${report.summary.compared} within, mean ${report.summary.meanDeviation_mm} mm`);

  const wrong = { ...spec, dimensions: { ...spec.dimensions, wheelbase_m: 2.5 } };
  check("fit: a 100 mm error is reported as out of tolerance",
    fitReport(f, wrong).summary.out === 1);
}

// --- the silhouette ----------------------------------------------------------
{
  const sil = sideSilhouette(f, { bins: 80 });
  const tops = sil.top.map(([, y]) => y);
  const bottoms = sil.bottom.map(([, y]) => y);
  // The fixture's tallest thing is a block whose top is at 2.7 m.
  check("silhouette: top of a known fixture", near(Math.max(...tops), 2.7, 1e-6), `${Math.max(...tops)} m`);
  check("silhouette: ground is the lowest point", near(Math.min(...bottoms), 0, 1e-6), `${Math.min(...bottoms)} m`);
}

// --- deviation ---------------------------------------------------------------
{
  const profile = [];
  for (let i = 0; i <= 100; i += 1) {
    const x = -2 + (4 * i) / 100;
    profile.push([x, 1 + 0.2 * Math.sin(x * 2)]);
  }
  // Negative control: a profile against itself is zero everywhere.
  const same = deviation(profile, profile, { trim: 0 });
  check("deviation: a profile against itself is zero", same.maxAbs_mm < 1e-6, `${same.maxAbs_mm} mm`);

  // Positive control: a known 25 mm lift must read as 25 mm.
  const lifted = profile.map(([x, y]) => [x, y + 0.025]);
  const shifted = deviation(lifted, profile, { trim: 0 });
  check("deviation: a known 25 mm offset reads as 25 mm",
    near(shifted.medianAbs_mm, 25, 0.01), `${shifted.medianAbs_mm} mm`);
}

// --- knot fitting ------------------------------------------------------------
{
  // A straight line needs two knots and nothing more.
  const line = [];
  for (let i = 0; i <= 200; i += 1) line.push([i / 100, 0.5 + i / 400]);
  const straight = await fitKnots(line, { tolerance_mm: 1 });
  check("knots: a straight line needs two knots", straight.count === 2, `${straight.count} knots`);

  // A curve needs more, and the residual it reports must be the residual it
  // achieved — the fit re-evaluates rather than trusting its own loop.
  const curve = [];
  for (let i = 0; i <= 400; i += 1) {
    const x = -2 + (4 * i) / 400;
    curve.push([x, 1.2 + 0.35 * Math.sin(x * 1.7) - 0.08 * x * x]);
  }
  const fitted = await fitKnots(curve, { tolerance_mm: 2, maxKnots: 60 });
  check("knots: a curve is fitted within its budget",
    fitted.withinTolerance && fitted.maxError_mm <= 2, `${fitted.count} knots, max ${fitted.maxError_mm} mm`);
  check("knots: a tighter budget never needs fewer knots",
    (await fitKnots(curve, { tolerance_mm: 8, maxKnots: 60 })).count <= fitted.count);
}

// --- the reference gate ------------------------------------------------------
{
  // Negative control: a reference whose landmarks disagree with the
  // specification must be refused, not fitted to. This is finding 02 as code.
  const bogus = "/tmp/autolab-bogus-reference.json";
  const { writeFile } = await import("node:fs/promises");
  await writeFile(bogus, JSON.stringify({
    top: [[-1, 1], [1, 1]], bottom: [[-1, 0], [1, 0]],
    drawn_height: 3.4, drawn_length: 9.9,
  }));
  let refused = false;
  try {
    await loadSideProfile(bogus, { height: 1.699, length: 4.722 });
  } catch {
    refused = true;
  }
  check("reference: a drawing that agrees with nothing is refused", refused);

  // Positive control: the real reference loads, and reports which landmark it
  // is trusting rather than implying both.
  try {
    const side = await loadSideProfile("reference/ortho_side.json", { height: 1.699, length: 4.722 });
    check("reference: the real drawing loads and names its trusted landmark",
      side.calibration.trustedLandmarks.length >= 1,
      side.calibration.trustedLandmarks.join(", "));
    check("reference: it reports the length as NOT trusted",
      !side.calibration.trustedLandmarks.includes("length"),
      "the side drawing is ~4.4% short, which must not be silently trusted");
  } catch (error) {
    check("reference: the real drawing loads", false, String(error).split("\n")[0]);
  }
}

// --- axle alignment ----------------------------------------------------------
{
  // A synthetic drawing whose contact patches sit at a known, deliberately
  // wrong place: 100 mm forward of centre and a 50 mm short wheelbase.
  const build = (offset, wheelbase) => {
    const bottom = [];
    const top = [];
    for (let i = 0; i <= 400; i += 1) {
      const x = -2.4 + (4.8 * i) / 400;
      const nearFront = Math.abs(x - (offset + wheelbase / 2)) < 0.08;
      const nearRear = Math.abs(x - (offset - wheelbase / 2)) < 0.08;
      bottom.push([x, nearFront || nearRear ? 0 : 0.3]);
      top.push([x, 1.6]);
    }
    return { top, bottom, domain: { min: -2.4, max: 2.4 } };
  };

  const aligned = alignToAxles(build(0.1, 2.886), { modelAxleX: 1.468, publishedWheelbase: 2.936 });
  check("alignment: recovers a known 100 mm offset",
    Math.abs(aligned.alignment.shift_mm + 100) < 2, `${aligned.alignment.shift_mm} mm, expected about -100`);
  check("alignment: recovers a known 50 mm wheelbase error",
    Math.abs(aligned.alignment.wheelbaseCorrection_mm - 50) < 2,
    `${aligned.alignment.wheelbaseCorrection_mm} mm, expected about 50`);

  // After alignment the patches must land on the model's axles.
  const patches = [];
  for (const [x, y] of aligned.bottom) {
    if (y > 0.002) continue;
    const g = patches.find((p) => Math.abs(p[p.length - 1] - x) < 0.15);
    if (g) g.push(x); else patches.push([x]);
  }
  const centres = patches.map((g) => g.reduce((a, b) => a + b, 0) / g.length).sort((a, b) => a - b);
  check("alignment: the patches land on the model's axles",
    centres.length === 2 && Math.abs(centres[1] - 1.468) < 0.01 && Math.abs(centres[0] + 1.468) < 0.01,
    centres.map((c) => c.toFixed(4)).join(" / "));

  // Negative control: a profile with no ground contact cannot be aligned, and
  // must say so rather than inventing a transform.
  let refused = false;
  try {
    alignToAxles({ top: [[0, 1]], bottom: [[0, 0.5]], domain: { min: 0, max: 0 } },
      { modelAxleX: 1.468, publishedWheelbase: 2.936 });
  } catch { refused = true; }
  check("alignment: a profile with no contact patches is refused", refused);
}

// --- reading and writing the curve layer -------------------------------------
{
  const modelPath = process.env.MODEL_PATH
    ?? `${process.env.HOME}/Desktop/r2-blueprint/src/vehicle.js`;
  try {
    const { source, curves } = await readCurves(modelPath);
    const writable = curves.filter((c) => c.writable);
    check("curves: the curve layer is found", writable.length > 0, `${writable.length} writable`);
    check("curves: a computed interp() is refused rather than parsed",
      curves.some((c) => !c.writable), "at least one non-literal call is flagged");

    // The control that matters most for a tool that proposes diffs: rendering a
    // curve from its own values must produce the file back, byte for byte.
    // Anything else fills the diff with churn nobody will read.
    const spec = { NOSE: 2.31, TAIL: -2.412, XF: 1.468, XR: -1.468 };
    const real = await loadModel({ path: modelPath }).then((m) => m.spec).catch(() => spec);
    let identical = 0;
    for (const curve of writable) {
      const own = curve.knots.map((k) => [evaluateX(k.xSource, real), Number.parseFloat(k.vSource)]);
      const out = renderKnots(curve.knots, own, real);
      const original = `[${curve.knots.map((k) => `[${k.xSource}, ${k.vSource}]`).join(", ")}]`;
      if (out.source === original) identical += 1;
    }
    check("curves: re-rendering a curve from its own values is byte-identical",
      identical === writable.length, `${identical}/${writable.length}`);

    // And splicing that identical render back must leave the file untouched.
    const first = writable[0];
    const own = first.knots.map((k) => [evaluateX(k.xSource, real), Number.parseFloat(k.vSource)]);
    const spliced = spliceCurve(source, first, renderKnots(first.knots, own, real).source);
    check("curves: splicing an unchanged curve leaves the file untouched", spliced === source);
    check("curves: a no-op splice produces no diff", unifiedDiff(source, spliced, "x") === null);

    // Positive control: a real change must produce a diff naming that curve.
    const bumped = spliceCurve(source, first, "[[0, 1], [1, 2]]");
    const diff = unifiedDiff(source, bumped, "x");
    check("curves: a real change produces a diff", diff !== null && diff.includes(first.name));

    // Knots outside the fitting window belong to the author and must survive.
    const xs = first.knots.map((k) => evaluateX(k.xSource, real)).filter((v) => v !== null);
    const window = { from: Math.min(...xs) + 0.2, to: Math.max(...xs) - 0.2 };
    const outside = xs.filter((x) => x < window.from || x > window.to).length;
    const windowed = renderKnots(first.knots, own.filter(([x]) => x >= window.from && x <= window.to), real, { window });
    check("curves: knots outside the fitting window are preserved",
      windowed.changes.preserved === outside, `${windowed.changes.preserved} preserved, ${outside} outside`);
  } catch (error) {
    check("curves: the curve layer is readable", false, String(error).split("\n")[0]);
  }
}

// --- anchors and extrapolation -----------------------------------------------
{
  const spec = { NOSE: 2.31, TAIL: -2.412, XF: 1.468, XR: -1.468 };
  check("anchors: skin datums retain their offset when the outer envelope moves",
    Math.abs(evaluateX("S.NOSE - 0.034", spec) - 2.276) < 1e-9
      && Math.abs(evaluateX("S.TAIL + 0.020", spec) + 2.392) < 1e-9
      && Math.abs(evaluateX("S.TAIL + 0.020", { ...spec, TAIL: -2.5 }) + 2.48) < 1e-9);
  check("anchors: offset syntax refuses expressions and missing datums",
    ["S.NOSE - other", "S.NOSE - 0.034 + 1", "S.UNKNOWN + 0.020", "S.NOSE - 0.034; sideEffect()"]
      .every((src) => evaluateX(src, spec) === null)
      && evaluateX("S.NOSE - 0.034", {}) === null);
  check("anchors: an exact nose hit is written as S.NOSE", anchorFor(2.31, spec).source === "S.NOSE");
  check("anchors: an exact tail hit is written as S.TAIL", anchorFor(-2.412, spec).source === "S.TAIL");
  // Negative control: near is not the same as on. An anchor asserts identity.
  check("anchors: 8 mm from the nose is not the nose",
    anchorFor(2.302, spec).kind === "literal", anchorFor(2.302, spec).source);
  // And the over-eager version that a round-trip control caught: a plain
  // station must not be reinvented as a drawing station.
  check("anchors: a model-frame station stays a literal",
    anchorFor(-2.3, spec).source === "-2.3", anchorFor(-2.3, spec).source);

  const profile = [[-1, 0], [1, 1]];
  let refused = false;
  try { resample(profile, { from: -2, to: 2, count: 10 }); } catch { refused = true; }
  check("resample: refuses to extrapolate beyond the reference", refused);
  check("resample: works inside the reference", resample(profile, { from: -1, to: 1, count: 5 }).length === 5);
}

// --- anchors are load-bearing, demonstrated rather than asserted -------------
{
  // The claim that S.NOSE and T(4.715) must be preserved rests on their being
  // DERIVED: change the front overhang and they should move, while a hard-coded
  // 2.361 would not. That is an experiment, so run it instead of asserting it
  // in a comment — this is the check that shows what flattening them would cost.
  const modelPath = process.env.MODEL_PATH
    ?? `${process.env.HOME}/Desktop/r2-blueprint/src/vehicle.js`;
  try {
    const real = (await loadModel({ path: modelPath })).spec;
    const { curves } = await readCurves(modelPath);

    // Each anchor depends on ONE thing, so perturb that thing and require that
    // anchor to move. An earlier version moved NOSE and expected every anchored
    // knot to follow — including the ones anchored to the TAIL and the axles,
    // which have no reason to. The control caught the expectation, not the code.
    const dependents = [
      { field: "NOSE", matches: (src) => /^S\.NOSE(?:$|\s*[+-])/.test(src) || /^T\(/.test(src) },
      { field: "TAIL", matches: (src) => /^S\.TAIL(?:$|\s*[+-])/.test(src) },
      { field: "XF", matches: (src) => /^S\.XF(?:$|\s*[+-])/.test(src) },
      { field: "XR", matches: (src) => /^S\.XR(?:$|\s*[+-])/.test(src) },
    ];

    let moved = 0;
    let expected = 0;
    let bled = 0;
    for (const { field, matches } of dependents) {
      const perturbed = { ...real, [field]: real[field] + 0.05 };
      for (const curve of curves.filter((c) => c.writable)) {
        for (const knot of curve.knots) {
          const src = knot.xSource.trim();
          const before = evaluateX(src, real);
          const after = evaluateX(src, perturbed);
          if (before === null || after === null) continue;
          const shifted = Math.abs(after - before) > 1e-9;
          if (matches(src)) {
            expected += 1;
            if (shifted) moved += 1;
          } else if (shifted) {
            // A knot that moves when something it does not reference moves.
            bled += 1;
          }
        }
      }
    }
    check("anchors: every anchor moves when the thing it references moves",
      expected > 0 && moved === expected, `${moved}/${expected}`);
    check("anchors: nothing moves when an unrelated constant moves",
      bled === 0, `${bled} knots bled`);
  } catch (error) {
    check("anchors: the derivation experiment runs", false, String(error).split("\n")[0]);
  }
}

// --- the null-edit control ---------------------------------------------------
{
  // Build the model twice from identical source and require identical numbers.
  // If a null edit shows movement, the rebuild is non-deterministic and every
  // before/after comparison this engine makes is worthless — so this is
  // believed before any real comparison is.
  const modelPath = process.env.MODEL_PATH
    ?? `${process.env.HOME}/Desktop/r2-blueprint/src/vehicle.js`;
  try {
    const { source } = await readCurves(modelPath);
    const a = await buildVariant(modelPath, source);
    const b = await buildVariant(modelPath, source);
    const sa = sideSilhouette(a.model, { bins: 200 });
    const sb = sideSilhouette(b.model, { bins: 200 });
    let worst = 0;
    for (let i = 0; i < sa.top.length; i += 1) {
      worst = Math.max(worst, Math.abs(sa.top[i][1] - sb.top[i][1]), Math.abs(sa.bottom[i][1] - sb.bottom[i][1]));
    }
    check("null edit: two identical builds measure identically", worst === 0, `worst difference ${worst}`);
    check("null edit: the same source yields the same triangle count",
      a.model.triangles.length === b.model.triangles.length,
      `${a.model.triangles.length} vs ${b.model.triangles.length}`);
  } catch (error) {
    check("null edit: the control runs", false, String(error).split("\n")[0]);
  }
}

// --- the write precondition --------------------------------------------------
{
  const modelPath = process.env.MODEL_PATH
    ?? `${process.env.HOME}/Desktop/r2-blueprint/src/vehicle.js`;
  try {
    const { source, curves } = await readCurves(modelPath);
    const curve = curves.filter((c) => c.writable)[0];
    const base = precondition(source, curve);
    check("precondition: the same bytes give the same hashes",
      precondition(source, curve).target === base.target);
    // An edit elsewhere must move the file hash and leave the target's alone —
    // that is the whole point of having two.
    const elsewhere = `${source}\n// a comment appended far from any curve\n`;
    const other = precondition(elsewhere, curve);
    check("precondition: an edit elsewhere moves only the file hash",
      other.file !== base.file && other.target === base.target);
    const inside = spliceCurve(source, curve, "[[0, 1], [1, 2]]");
    const moved = precondition(inside, { span: { start: curve.span.start, end: curve.span.start + 16 } });
    check("precondition: an edit to the curve moves the target hash",
      moved.target !== base.target);
  } catch (error) {
    check("precondition: the control runs", false, String(error).split("\n")[0]);
  }
}

// --- the shape term ----------------------------------------------------------
{
  // Distance alone accepted a fit that cut a 263 mm notch into a roofline, so
  // the acceptance rule needs a shape term — and that term needs both controls,
  // because one that refuses everything is as useless as one that refuses
  // nothing.
  const smooth = (x) => 1.7 - 0.05 * x * x;

  // Negative control: a curve against itself must pass.
  const same = shapeCheck(smooth, smooth, { from: -2, to: 1 });
  check("shape: a curve against itself preserves its shape", same.preservesShape);

  // Positive control: the exact pathology, a narrow notch. A mean taken over
  // the whole span barely moves; the shape term must still catch it.
  const notched = (x) => (x > -1.95 && x < -1.9 ? smooth(x) - 0.26 : smooth(x));
  const caught = shapeCheck(smooth, notched, { from: -2, to: 1 });
  check("shape: a 260 mm notch is refused", !caught.preservesShape,
    caught.problems[0] ?? "no problem reported");
  check("shape: the notch is reported as added turning points",
    caught.turningPoints.added > 0, `${caught.turningPoints.added} added`);

  // And the fit must still be allowed to move the curve. A rule that refuses a
  // genuine 20 mm correction is a rule nobody will keep switched on.
  const lifted = (x) => smooth(x) + 0.02;
  check("shape: a uniform 20 mm lift is allowed", shapeCheck(smooth, lifted, { from: -2, to: 1 }).preservesShape);

  // A gentler version of the same curve must also pass — refitting legitimately
  // smooths hand-placed knots.
  const gentler = (x) => 1.7 - 0.045 * x * x;
  check("shape: a slightly gentler curve is allowed", shapeCheck(smooth, gentler, { from: -2, to: 1 }).preservesShape);
}

// --- the gate ----------------------------------------------------------------
// Finding 03, taken literally: do not measure a real model until the landmark
// that cannot move comes back correct.
let gate = "skipped";
try {
  const model = await loadModel();
  if (model.spec?.wheelbase) {
    const measured = keyDimensions(model).wheelbase_m;
    const ok = near(measured, model.spec.wheelbase, 0.003);
    gate = ok ? "passed" : "FAILED";
    check("gate: the model's axle-to-axle distance is its published wheelbase", ok,
      `measured ${measured} m against ${model.spec.wheelbase} m`);
  }
} catch (error) {
  check("gate: a model is reachable", false, String(error).split("\n")[0]);
}

const failed = rows.filter((r) => !r.passed);
process.stdout.write(`\nselftest: ${rows.length - failed.length}/${rows.length} passed · gate ${gate}\n`);
for (const r of failed) process.stdout.write(`  FAILED ${r.name}: ${r.note}\n`);
if (failed.length) process.exitCode = 1;
