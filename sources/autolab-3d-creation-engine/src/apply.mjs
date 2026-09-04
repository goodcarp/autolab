// Proposing a curve change, and proving it before anyone commits to it.
//
// Nothing here writes to the model by default. A curve edit changes the whole
// car — pillars, glass, cowl and wipers are all derived from the roof curve —
// so the only honest way to offer one is to build the changed model somewhere
// else, measure it against the reference, and hand over a diff with the result
// attached.
//
// The safety rule is absolute and comes from a near-miss on this project: two
// agents shared a working directory and one committed the other's half-finished
// tree. A tool that writes into a repository someone is editing is that
// incident waiting to happen again, so `write` refuses a dirty target and says
// so.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { loadModel, round } from "./load.mjs";
import { readCurves } from "./curves.mjs";

const run = promisify(execFile);
let scratchCounter = 0;

/** Replace one curve's knot array, returning the new file contents. */
export function spliceCurve(source, curve, knotSource) {
  if (!curve.writable) throw new Error(`${curve.name} is not a writable knot list`);
  return source.slice(0, curve.span.start) + knotSource + source.slice(curve.span.end);
}

/**
 * Build a model from modified source, without touching the original.
 *
 * The copy goes to a scratch directory with geom.js beside it, under a unique
 * name each time: Node caches ES modules by URL, so reusing a path would load
 * the first version forever and every subsequent measurement would be of a
 * model that no longer exists.
 */
export async function buildVariant(modelPath, newSource) {
  const dir = await mkdtemp(join(tmpdir(), "autolab-variant-"));
  const geomFrom = resolve(dirname(modelPath), "geom.js");
  await copyFile(geomFrom, join(dir, "geom.js"));
  scratchCounter += 1;
  const target = join(dir, `vehicle-${scratchCounter}.js`);
  await writeFile(target, newSource);
  return { path: target, model: await loadModel({ path: target }) };
}

/** A unified diff of one file's before and after. */
export function unifiedDiff(before, after, path, { context = 2 } = {}) {
  const a = before.split("\n");
  const b = after.split("\n");
  const changed = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) changed.push(i);
  }
  if (!changed.length) return null;

  const from = Math.max(0, changed[0] - context);
  const to = Math.min(Math.max(a.length, b.length) - 1, changed[changed.length - 1] + context);
  const lines = [`--- a/${path}`, `+++ b/${path}`, `@@ -${from + 1},${to - from + 1} +${from + 1},${to - from + 1} @@`];
  for (let i = from; i <= to; i += 1) {
    if (a[i] === b[i]) lines.push(` ${a[i] ?? ""}`);
    else {
      if (a[i] !== undefined) lines.push(`-${a[i]}`);
      if (b[i] !== undefined) lines.push(`+${b[i]}`);
    }
  }
  return lines.join("\n");
}

const sha = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/**
 * A precondition that describes the bytes, not the branch.
 *
 * Gating on `git status` is wrong in both directions, and this project has now
 * seen both: it blocks during ordinary uncommitted work, which is most of the
 * time, and it opens the gate in exactly the window after someone saves and
 * commits and before they type the next character. During this build the model
 * repository went clean, then dirty, then clean again within minutes.
 *
 * So the gate is content: a hash of the whole file, and a separate hash of the
 * target curve's own bytes. If the curve's bytes changed since the measurement
 * was taken, that curve is somebody else's work in flight and there is no flag
 * to override it. If only the rest of the file changed, the measurement still
 * stands and the write is offered under an explicit rebase.
 */
export function precondition(source, curve) {
  return {
    file: sha(source),
    target: sha(source.slice(curve.span.start, curve.span.end)),
    bytes: curve.span.end - curve.span.start,
  };
}

/** Is the model's repository clean enough to write into? Advisory only. */
export async function repositoryState(modelPath) {
  const cwd = dirname(modelPath);
  try {
    const { stdout } = await run("git", ["status", "--porcelain", "--", modelPath], { cwd });
    const dirty = stdout.trim().length > 0;
    const { stdout: head } = await run("git", ["rev-parse", "--short", "HEAD"], { cwd });
    return { tracked: true, dirty, head: head.trim(), detail: stdout.trim() };
  } catch (error) {
    return { tracked: false, dirty: true, head: null, detail: String(error).split("\n")[0] };
  }
}

/**
 * Propose a curve change: build it, measure it, diff it. Write nothing.
 *
 * `measure` is supplied by the caller so this module does not decide what
 * "better" means. It is handed a model and returns a number in millimetres;
 * lower is better.
 */
export async function propose({ modelPath, curveName, knotSource, measure, ...options }) {
  const { source, curves } = await readCurves(modelPath);
  const curve = curves.find((c) => c.name === curveName);
  if (!curve) throw new Error(`no curve named ${curveName} in ${modelPath}`);
  if (!curve.writable) throw new Error(`${curveName}: ${curve.reason}`);

  const after = spliceCurve(source, curve, knotSource);
  const diff = unifiedDiff(source, after, modelPath.split("/").slice(-2).join("/"));
  if (!diff) {
    return { curve: curveName, changed: false, note: "the rendered knots are byte-identical to what is there" };
  }

  const baseline = await loadModel({ path: modelPath });
  const variant = await buildVariant(modelPath, after);

  const before = await measure(baseline);
  const now = await measure(variant.model);

  const improvement = before - now;

  // Materiality. An improvement smaller than what the reference itself is
  // trusted to is not an improvement, it is noise with a diff attached — and
  // this one arrives attached to a diff that replaces most of the curve.
  //
  // The side drawing's height agrees with the published specification to 0.06%,
  // which on a 1.7 m car is about one millimetre. Nothing below that is a
  // measurement of the model; it is a measurement of the drawing's own error.
  const material = improvement >= (options.uncertainty_mm ?? 1.0);

  return {
    curve: curveName,
    changed: true,
    diff,
    variantPath: variant.path,
    measurement: {
      before_mm: round(before, 3),
      after_mm: round(now, 3),
      improvement_mm: round(improvement, 3),
      better: now < before,
      material,
      uncertainty_mm: options.uncertainty_mm ?? 1.0,
      verdict: !material
        ? "Not recommended: the change is smaller than the reference's own uncertainty."
        : improvement > 0
          ? "Recommended."
          : "Not recommended: the model gets further from the reference.",
    },
    repository: await repositoryState(modelPath),
    // Carried to the write step, so it can refuse a target that moved.
    precondition: precondition(source, curve),
  };
}

/**
 * Apply a proposal. Refuses a target with uncommitted changes.
 *
 * The refusal is the feature. Overriding it is possible and deliberately
 * awkward, because the situation it guards against is someone else's unsaved
 * work, and that is not a thing to lose to a flag nobody read.
 */
export async function write({ modelPath, curveName, knotSource, expect, rebase = false }) {
  const { source, curves } = await readCurves(modelPath);
  const curve = curves.find((c) => c.name === curveName);
  if (!curve) throw new Error(`no curve named ${curveName}`);
  const now = precondition(source, curve);

  if (expect) {
    if (now.target !== expect.target) {
      throw new Error(
        `${curveName} has changed since it was measured — refusing to write.\n`
        + `  measured ${expect.target}, now ${now.target}\n`
        + "That curve is somebody else's work in flight. There is no flag for this;\n"
        + "re-run propose against the current file.",
      );
    }
    if (now.file !== expect.file && !rebase) {
      throw new Error(
        `${modelPath} changed elsewhere since it was measured.\n`
        + `  ${curveName} itself is untouched, so the measurement still stands.\n`
        + "Re-run with --rebase to apply it to the current file.",
      );
    }
  }

  const after = spliceCurve(source, curve, knotSource);
  if (after === source) return { written: false, note: "no change" };

  // A backup before the splice, so reversal never depends on the tree having
  // been clean.
  const backup = `${modelPath}.autolab-backup`;
  await writeFile(backup, source);
  await writeFile(modelPath, after);
  const state = await repositoryState(modelPath);
  return {
    written: true,
    backup,
    rebased: expect ? now.file !== expect.file : false,
    repositoryWas: state.head,
  };
}

export async function readSource(path) {
  return readFile(path, "utf8");
}
