// One command surface for the ruler.
//
//   node src/cli.mjs selftest
//   node src/cli.mjs dims [--spec specs/rivian-r2.json]
//   node src/cli.mjs parts [--category shell]
//   node src/cli.mjs extremes
//   node src/cli.mjs section <x> [--svg out/file.svg] [--scale 10]
//   node src/cli.mjs clearance <partA> <partB>
//   node src/cli.mjs overlaps
//   node src/cli.mjs fit [--spec specs/rivian-r2.json]
//
// MODEL_PATH selects the model; it defaults to the r2-blueprint source, which
// is read and never written.

import { writeFile } from "node:fs/promises";
import process from "node:process";
import { loadModel, round } from "./load.mjs";
import { extremes, keyDimensions, partTable } from "./ruler.mjs";
import { sectionSymmetry, sliceAt } from "./section.mjs";
import { sectionSvg } from "./svg.mjs";
import { clearance, overlapMatrix } from "./clearance.mjs";
import { apertures } from "./apertures.mjs";
import { alignToAxles, loadFrontProfile, loadSideProfile, resample } from "./reference.mjs";
import { asSource, fitKnots } from "./knots.mjs";
import { deviation, deviationByRegion, sideSilhouette, WHEELS } from "./silhouette.mjs";
import { evaluateX, readCurves, renderKnots } from "./curves.mjs";
import { propose, write } from "./apply.mjs";
import { authorityOf } from "./authority.mjs";
import { shapeCheck } from "./shape.mjs";
import { agreementWindow } from "./boundary.mjs";
import { monotoneInterp } from "./knots.mjs";
import { profileSvg } from "./svg.mjs";
import { fitReport, formatFit, loadSpec } from "./fit.mjs";

const argv = process.argv.slice(2);
const command = argv[0];
const positional = argv.slice(1).filter((a) => !a.startsWith("--"));
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

if (command === "selftest") {
  await import("./selftest.mjs");
} else if (!command || command === "help") {
  process.stdout.write(`autolab 3d creation engine — a ruler for the model itself

  selftest                       calibrate the instruments, then gate on the wheelbase
  dims                           the measurements a specification names
  parts [--category shell]       every part with its envelope
  extremes                       which part owns each extreme of the envelope
  section <x> [--svg path]       a cross-section, optionally drawn to scale
  reference                      the drawing's calibration, checked against the spec
  knots <top|bottom> [--tol 3]   fit a knot list to the reference, as pasteable source
  deviate [--svg path]           the model's outline against the drawing, by region
  curves                         the curve layer: what is writable, and how anchored
  propose <CURVE> [--tol 4]      fit that curve to the drawing, build it, measure it, diff it
  propose <CURVE> --write        apply it — refuses if the curve moved since measuring
  clearance <partA> <partB>      nearest surface-to-surface distance
  overlaps                       which parts' envelopes intersect
  apertures [--band 50] [--edge 65]  fixed geometry inside a panel's opening (mm behind the skin, mm inside the outline)
  fit [--spec path]              measured against published dimensions
  symmetry                       shape symmetry about the centreline

MODEL_PATH=<file exporting buildVehicle()>   defaults to ~/Desktop/r2-blueprint/src/vehicle.js
`);
} else {
  const model = await loadModel();
  try {

  if (command === "dims") {
    print(keyDimensions(model));
  } else if (command === "parts") {
    const category = flag("category");
    const rows = partTable(model).filter((r) => !category || r.category === category);
    print({ count: rows.length, parts: rows });
  } else if (command === "extremes") {
    print(extremes(model));
  } else if (command === "symmetry") {
    print(sectionSymmetry(model));
  } else if (command === "section") {
    const x = Number.parseFloat(positional[0]);
    if (Number.isNaN(x)) throw new Error("section needs a station, e.g. `section 0`");
    const cut = sliceAt(model, x);
    const svgPath = flag("svg");
    if (svgPath) {
      const scale = 1 / Number.parseFloat(flag("scale", "10"));
      const svg = sectionSvg(cut, { scale });
      if (!svg) throw new Error(`no geometry at x = ${x}`);
      await writeFile(svgPath, svg);
      process.stdout.write(`${svgPath}\n`);
    }
    print({
      station: cut.station,
      closedLoops: cut.closed,
      openRuns: cut.openCount,
      segments: cut.segments.length,
    });
  } else if (command === "clearance") {
    const [a, b] = positional;
    if (!a || !b) throw new Error("clearance needs two part ids");
    print(clearance(model, a, b, { stride: Number.parseInt(flag("stride", "1"), 10) }));
  } else if (command === "overlaps") {
    print(overlapMatrix(model));
  } else if (command === "apertures") {
    const report = apertures(model, { depth: Number.parseFloat(flag("band", "50")) / 1000, edge: Number.parseFloat(flag("edge", "65")) / 1000 });
    print(report);
    if (report.status === "FAIL") process.exitCode = 1;
  } else if (command === "reference") {
    const spec = model.spec;
    const side = await loadSideProfile(flag("side", "reference/ortho_side.json"), spec);
    const front = await loadFrontProfile(flag("front", "reference/ortho_front.json"), spec);
    print({
      side: { samples: side.samples, domain: side.domain, calibration: side.calibration },
      front: { samples: front.samples, calibration: front.calibration },
    });
  } else if (command === "knots") {
    const which = positional[0] ?? "top";
    if (which !== "top" && which !== "bottom") throw new Error("knots takes `top` or `bottom`");
    const side = await loadSideProfile(flag("side", "reference/ortho_side.json"), model.spec);
    const samples = resample(side[which], {
      from: side.domain.min,
      to: side.domain.max,
      count: Number.parseInt(flag("samples", "400"), 10),
    });
    const fit = await fitKnots(samples, {
      tolerance_mm: Number.parseFloat(flag("tol", "3")),
      maxKnots: Number.parseInt(flag("max", "60"), 10),
    });
    process.stdout.write(`${asSource(which === "top" ? "ROOFLINE" : "UNDERBODY", fit)}\n\n`);
    process.stdout.write(
      `${fit.count} knots · max ${fit.maxError_mm} mm · mean ${fit.meanError_mm} mm · `
      + `${fit.withinTolerance ? "within" : "OVER"} the ${fit.tolerance_mm} mm budget\n`,
    );
    if (!fit.withinTolerance) process.exitCode = 1;
  } else if (command === "deviate") {
    const raw = await loadSideProfile(flag("side", "reference/ortho_side.json"), model.spec);
    const aligned = alignToAxles(raw, {
      modelAxleX: model.spec.XF,
      publishedWheelbase: model.spec.wheelbase,
    });
    const silhouette = sideSilhouette(model, { bins: Number.parseInt(flag("bins", "400"), 10) });

    // Both frames, always, because they answer different questions and the
    // engine has no business picking one silently. AS DRAWN compares against
    // the extractor's own output in the frame it produced. ON AXLES first maps
    // the drawing onto the physical landmarks, which is the right comparison
    // if the model was fitted to something else.
    const a = aligned.alignment;
    process.stdout.write(
      `The drawing's frame is not the model's. Its wheelbase centre sits `
      + `${round(-a.shift_mm, 1)} mm forward of the model's and its wheelbase is `
      + `${a.wheelbaseCorrection_mm} mm short, so the two disagree by tens of millimetres at the\n`
      + `ends while agreeing at the axles. Both comparisons are shown.\n\n`,
    );

    for (const [frameName, reference] of [["AS DRAWN", raw], ["ON AXLES", aligned]]) {
      process.stdout.write(`${frameName}\n`);
      for (const [label, mp, rp] of [["  top", silhouette.top, reference.top], ["  bottom", silhouette.bottom, reference.bottom]]) {
        const d = deviationByRegion(mp, rp);
        process.stdout.write(`${label.padEnd(9)}median ${String(d.overall.medianAbs_mm).padStart(7)} mm   p95 ${String(d.overall.p95Abs_mm).padStart(7)} mm\n`);
        for (const r of d.regions) {
          process.stdout.write(
            `      ${r.region.padEnd(15)}${String(r.medianAbs_mm).padStart(7)} mm   `
            + `max ${String(r.maxAbs_mm).padStart(7)} mm at x=${r.worstAt_x}\n`,
          );
        }
      }
      process.stdout.write("\n");
    }

    const svgPath = flag("svg");
    if (svgPath) {
      const { writeFile: write } = await import("node:fs/promises");
      await write(svgPath, profileSvg({ model: silhouette, reference: aligned }));
      process.stdout.write(`${svgPath}  (drawn on axles)\n\n`);
    }
    process.stdout.write(
      "Read the regions, not the overall. The lower outline is the tyre contact patch at\n"
      + "the axles and whatever hangs lowest between them, which are different features.\n"
      + "Aligning on the axles improves the wheels and overhangs and makes the roof\n"
      + "mid-section worse — which is evidence that the model was fitted to this\n"
      + "extractor's output in its own frame rather than to the physical landmarks.\n",
    );
  } else if (command === "curves") {
    const { curves } = await readCurves(process.env.MODEL_PATH ?? model.path);
    print(curves.map((c) => c.writable
      ? {
        name: c.name,
        line: c.line,
        knots: c.knotCount,
        anchored: c.knots.filter((k) => !/^-?\d/.test(k.xSource.trim())).length,
        writable: true,
      }
      : { name: c.name, writable: false, reason: c.reason }));
  } else if (command === "propose") {
    // `drawn` compares against the extractor's output in the frame it produced;
    // `axles` maps the drawing onto the physical landmarks first.
    const name = positional[0];
    if (!name) throw new Error("propose needs a curve name — try `curves`");
    const modelPath = process.env.MODEL_PATH ?? model.path;
    const drawn = await loadSideProfile(flag("side", "reference/ortho_side.json"), model.spec);
    const frame = flag("frame", "drawn");
    if (frame !== "drawn" && frame !== "axles") {
      throw new Error("--frame must be `drawn` or `axles`");
    }
    // The two frames disagree by tens of millimetres at the ends. Which one a
    // curve should be fitted in depends on how the model was built, which is
    // not something this tool can know — so it is stated, never assumed.
    const raw = frame === "axles"
      ? alignToAxles(drawn, { modelAxleX: model.spec.XF, publishedWheelbase: model.spec.wheelbase })
      : drawn;
    const { curves } = await readCurves(modelPath);
    const curve = curves.find((c) => c.name === name);
    if (!curve) throw new Error(`no curve named ${name}`);
    if (!curve.writable) throw new Error(`${name}: ${curve.reason}`);

    // What does this curve actually control? Measured, not declared: shift it a
    // millimetre in a scratch copy and see which stations respond. A curve that
    // moves nothing in this view cannot be verified against this view, and a
    // curve that drives the lower outline has no business being fitted to the
    // upper one.
    const authority = await authorityOf(modelPath, name);
    if (!authority.verifiable) {
      throw new Error(
        `${name} moves nothing in the side silhouette, so a side drawing cannot verify it. `
        + `It moved ${authority.movedParts.length} parts, so it is doing something — `
        + "probably width, which needs the front or plan view.",
      );
    }
    if (!authority.drives.top) {
      throw new Error(
        `${name} drives the lower outline, not the upper one. Fitting it to the drawing's `
        + "top profile would be fitting a curve to a measurement of something else.",
      );
    }

    const xs = curve.knots.map((k) => evaluateX(k.xSource, model.spec)).filter((v) => v !== null);
    // Three domains intersected: what the curve declares, what the model says it
    // controls, and what the drawing covers. Fitting outside any of them
    // produces knots from data that does not exist.
    const from = Math.max(Math.min(...xs), authority.authority.from, raw.domain.min);
    const to = Math.min(Math.max(...xs), authority.authority.to, raw.domain.max);
    // Before fitting: does the reference actually describe this curve across
    // the whole window? A refit is expected to disagree with the reference —
    // that is the point — but a disagreement at the edge two orders of
    // magnitude larger than the disagreement everywhere else means the
    // reference has stopped describing the same feature. Trim to where they are
    // talking about the same thing.
    const currentCurve = (await monotoneInterp())(
      curve.knots.map((k) => [evaluateX(k.xSource, model.spec), Number.parseFloat(k.vSource)]),
    );
    const ordered = [...raw.top].sort((p, q) => p[0] - q[0]);
    const referenceAt = (x) => {
      if (x <= ordered[0][0]) return ordered[0][1];
      if (x >= ordered[ordered.length - 1][0]) return ordered[ordered.length - 1][1];
      let lo = 0;
      let hi = ordered.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (ordered[mid][0] <= x) lo = mid; else hi = mid;
      }
      const [x0, y0] = ordered[lo];
      const [x1, y1] = ordered[hi];
      return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    };
    const agreement = agreementWindow(currentCurve, referenceAt, { from, to });
    if (!agreement.usable) {
      throw new Error(
        `${name}: the drawing and this curve disagree wildly across most of the window, `
        + "so there is no region where they are describing the same feature. "
        + `Median gap ${agreement.medianGap_mm} mm; nothing survives the trim.`,
      );
    }
    // Snap the window outward to the author's own knots. Left where the
    // agreement ends, the boundary lands in the middle of one of their spans,
    // and the fit has to bridge the dead zone between the last preserved knot
    // and the first valid reference sample — 45 mm here, across which nothing
    // describes the curve, and the fit dips 6 mm easing through it. Replacing
    // whole spans instead means every join is at a knot somebody placed.
    const knotXs = curve.knots
      .map((k) => evaluateX(k.xSource, model.spec))
      .filter((v) => v !== null)
      .sort((a, b) => a - b);
    const snapUp = knotXs.find((x) => x >= agreement.window.from);
    const snapDown = [...knotXs].reverse().find((x) => x <= agreement.window.to);
    const fitFrom = snapUp ?? agreement.window.from;
    const fitTo = snapDown ?? agreement.window.to;
    if (!(fitTo > fitFrom)) {
      throw new Error(
        `${name}: no whole span of this curve lies inside the region where the drawing `
        + "describes it. Fitting would have to replace part of a span.",
      );
    }
    const samples = resample(raw.top, { from: fitFrom, to: fitTo, count: 300 });

    // Pin the author's anchored knots: the ones written as S.NOSE, S.TAIL or
    // T(d) rather than as bare numbers.
    const pinned = curve.knots
      .filter((k) => !/^-?\d/.test(k.xSource.trim()))
      .map((k) => evaluateX(k.xSource, model.spec))
      .filter((v) => v !== null && v >= fitFrom && v <= fitTo);
    // The fit has to join what it did not touch. Without the neighbouring
    // preserved knots as endpoints, the fitted section starts wherever the
    // reference happens to be and the seam bends — which is the last of the
    // boundary artifact after the window is trimmed.
    const neighbours = curve.knots
      .map((k) => ({ x: evaluateX(k.xSource, model.spec), v: Number.parseFloat(k.vSource) }))
      .filter((k) => k.x !== null && (k.x < fitFrom || k.x > fitTo));
    const before = neighbours.filter((k) => k.x < fitFrom).sort((a, b) => b.x - a.x)[0];
    const after = neighbours.filter((k) => k.x > fitTo).sort((a, b) => a.x - b.x)[0];
    const joined = [
      ...(before ? [[before.x, before.v]] : []),
      ...samples,
      ...(after ? [[after.x, after.v]] : []),
    ];
    const fitted = await fitKnots(joined, {
      tolerance_mm: Number.parseFloat(flag("tol", "4")),
      maxKnots: Number.parseInt(flag("max", "40"), 10),
      pinned: [...pinned, ...(before ? [before.x] : []), ...(after ? [after.x] : [])],
    });
    const rendered = renderKnots(
      curve.knots,
      // Drop the join points back out: they were constraints on the fit, not
      // knots the fit is entitled to rewrite.
      fitted.knots.filter(([x]) => x >= fitFrom && x <= fitTo),
      model.spec,
      { window: { from: fitFrom, to: fitTo } },
    );

    // Distance is not the whole acceptance rule. A fit can lower mean deviation
    // and still be a regression: writing this curve from the axle-aligned
    // drawing improved the mean by 1.64 mm and cut a 263 mm notch into the rear
    // roofline, where a knot preserved outside the window described the roof and
    // the first fitted knot inside it described the drawing's tail extremity.
    // A mean taken over four metres cannot see a notch forty millimetres wide.
    const interp = await monotoneInterp();
    const evalKnots = (knots) => interp(knots.map((k) => [evaluateX(k.xSource, model.spec), Number.parseFloat(k.vSource)]));
    const parsed = rendered.source.slice(1, -1).split("], [")
      .map((pair) => pair.replace(/[[\]]/gu, "").split(","))
      .map(([x, v]) => ({ xSource: x.trim(), vSource: v.trim() }));
    const shape = shapeCheck(evalKnots(curve.knots), evalKnots(parsed), {
      from: Math.min(...xs),
      to: Math.max(...xs),
    });

    const result = await propose({
      modelPath,
      curveName: name,
      knotSource: rendered.source,
      measure: async (mdl) => deviation(
        sideSilhouette(mdl, { bins: 300 }).top, raw.top,
        { from: fitFrom, to: fitTo, stations: 150, trim: 0 },
      ).meanAbs_mm,
    });

    if (!result.changed) {
      process.stdout.write(`${name}: ${result.note}\n`);
    } else {
      const measurement = result.measurement;
      process.stdout.write(
        `${name}  window ${round(fitFrom, 3)} .. ${round(fitTo, 3)}  ·  frame: ${frame}\n`
        + `  boundary   trimmed ${round(agreement.trimmed_m.front * 1000, 0)} mm off the front, `
        + `${round(agreement.trimmed_m.back * 1000, 0)} mm off the back`
        + `${agreement.worstTrimmed_mm ? ` (the drawing disagreed by up to ${agreement.worstTrimmed_mm} mm there; median across the rest is ${agreement.medianGap_mm} mm)` : ""}\n`
        + `  authority  ${authority.authority.from} .. ${authority.authority.to} `
        + `(measured; drives ${authority.drives.top ? "top" : ""}${authority.drives.bottom ? (authority.drives.top ? "+bottom" : "bottom") : ""}, `
        + `${authority.movedParts.length} parts respond)\n`
        + `  anchors    ${pinned.length} pinned\n`
        + `  fit        ${fitted.count} knots, max ${fitted.maxError_mm} mm against the drawing\n`
        + `  knots      ${rendered.changes.kept} kept, ${rendered.changes.revalued} revalued, `
        + `${rendered.changes.added} added, ${rendered.changes.removed} removed, `
        + `${rendered.changes.preserved} preserved outside the window\n`
        + `  model      ${measurement.before_mm} mm -> ${measurement.after_mm} mm  `
        + `(${measurement.improvement_mm > 0 ? "-" : "+"}${Math.abs(measurement.improvement_mm)} mm)\n`
        + `  shape      ${shape.turningPoints.before} -> ${shape.turningPoints.after} turning points, `
        + `steepest ${shape.maxSlope_mm_per_m.before} -> ${shape.maxSlope_mm_per_m.after} mm/m `
        + `(${shape.maxSlope_mm_per_m.ratio}x)\n`
        + `  verdict    ${shape.preservesShape ? measurement.verdict : "REFUSED — the fit does not preserve the curve's shape."}\n`
        + shape.problems.map((p) => `             it ${p}\n`).join("")
        + `\n${result.diff}\n\n`,
      );
      if (argv.includes("--write")) {
        if (!shape.preservesShape) {
          process.stdout.write(
            "Refusing to write. The mean improved and the shape did not survive —\n"
            + "that combination is how a notch gets into a roofline.\n",
          );
          process.exitCode = 1;
        } else if (!measurement.material) {
          process.stdout.write("Refusing to write a change smaller than the reference's own uncertainty.\n");
          process.exitCode = 1;
        } else {
          const written = await write({
            modelPath,
            curveName: name,
            knotSource: rendered.source,
            expect: result.precondition,
            rebase: argv.includes("--rebase"),
          });
          process.stdout.write(written.written ? `written to ${modelPath}\n` : `${written.note}\n`);
        }
      } else {
        process.stdout.write("Nothing was written. Add --write to apply.\n");
      }
    }
  } else if (command === "fit") {
    const spec = await loadSpec(flag("spec", "specs/rivian-r2.json"));
    const report = fitReport(model, spec);
    process.stdout.write(`${formatFit(report)}\n\n`);
    const owners = extremes(model);
    process.stdout.write("extremes, so an out-of-tolerance row names a part:\n");
    for (const [axis, v] of Object.entries(owners)) {
      process.stdout.write(`  ${axis}  min ${v.min.value_m} m  ${v.min.part}`.padEnd(46)
        + `max ${v.max.value_m} m  ${v.max.part}\n`);
    }
    if (report.summary.out) process.exitCode = 1;
  } else {
    throw new Error(`unknown command "${command}" — try \`help\``);
  }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
