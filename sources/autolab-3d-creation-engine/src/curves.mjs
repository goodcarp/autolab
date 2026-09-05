// Reading the curve layer.
//
// vehicle.js declares its profiles as `const NAME = interp([[x, v], ...]);` at
// module scope. Those knot x values are not all numbers: many are `S.TAIL`,
// `S.NOSE` or `T(4.715)` — the last being "distance rearward from the front
// bumper, as the manufacturer dimensions it". They are semantic anchors, and a
// tool that replaces them with the floats they currently evaluate to has
// silently hard-coded something that was derived.
//
// So this module reads a curve as source text AND as numbers, and keeps both.

import { readFile } from "node:fs/promises";
import { round } from "./load.mjs";

/** Split a bracketed list at top level, respecting nesting and calls. */
function splitTopLevel(source) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (c === "[" || c === "(") depth += 1;
    else if (c === "]" || c === ")") depth -= 1;
    else if (c === "," && depth === 0) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(source.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Find the matching close bracket for the open bracket at `from`. */
function matchBracket(source, from) {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const c = source[i];
    if (c === "[" || c === "(") depth += 1;
    else if (c === "]" || c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Every `const NAME = interp([...])` whose argument is a literal array.
 *
 * Calls whose argument is computed — `interp(_edge.map(...))` — are listed but
 * flagged unwritable, because there is no knot list there to replace.
 */
export async function readCurves(path) {
  const source = await readFile(path, "utf8");
  const curves = [];
  const declaration = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*interp\(/gm;

  let match;
  while ((match = declaration.exec(source)) !== null) {
    const name = match[1];
    const argStart = match.index + match[0].length - 1; // the "(" of interp(
    const argEnd = matchBracket(source, argStart);
    if (argEnd < 0) continue;
    const argument = source.slice(argStart + 1, argEnd).trim();

    const literal = argument.startsWith("[");
    if (!literal) {
      curves.push({ name, writable: false, reason: "argument is computed, not a knot list" });
      continue;
    }

    const arrayEnd = matchBracket(argument, 0);
    const inner = argument.slice(1, arrayEnd);
    const knots = splitTopLevel(inner).map((element) => {
      const open = element.indexOf("[");
      const close = matchBracket(element, open);
      const pair = splitTopLevel(element.slice(open + 1, close));
      return { xSource: pair[0], vSource: pair[1] };
    });

    curves.push({
      name,
      writable: true,
      knotCount: knots.length,
      knots,
      // Byte range of the array literal, so a replacement touches only it.
      span: { start: argStart + 1, end: argStart + 1 + arrayEnd + 1 },
      line: source.slice(0, match.index).split("\n").length,
    });
  }

  return { path, source, curves };
}

/**
 * Evaluate a knot's x expression in the model's own frame.
 *
 * Only the vocabulary the curve layer actually uses is supported, on purpose:
 * a general evaluator would happily evaluate something this tool has no
 * business understanding, and would fail silently when the file grew a new
 * idiom. Anything unrecognised is returned as null and reported.
 */
export function evaluateX(expression, spec) {
  const text = expression.trim();
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number.parseFloat(text);
  if (text === "S.NOSE") return spec.NOSE;
  if (text === "S.TAIL") return spec.TAIL;
  if (text === "S.XF") return spec.XF;
  if (text === "S.XR") return spec.XR;
  // Skin datums can sit a fixed distance inside a published outer envelope.
  // Accept one literal offset from a known anchor, never arbitrary JavaScript.
  const offset = /^S\.(NOSE|TAIL|XF|XR)\s*([+-])\s*(\d+(?:\.\d+)?)$/.exec(text);
  if (offset) {
    const base = spec[offset[1]];
    const value = base + (offset[2] === "+" ? 1 : -1) * Number(offset[3]);
    return Number.isFinite(base) && Number.isFinite(value) ? value : null;
  }
  const call = /^T\(\s*(-?\d+(?:\.\d+)?)\s*\)$/.exec(text);
  if (call) return spec.NOSE - Number.parseFloat(call[1]);
  return null;
}

/**
 * How to write an x value that the file does not already have a spelling for.
 *
 * Deliberately unambitious. An earlier version preferred `T(4.61)` whenever a
 * value happened to land on a round number in the drawing's frame, and a
 * round-trip control caught it converting the author's own `-2.30` — a station
 * they chose in the model's frame — into a drawing station they never wrote.
 * Inferring intent from arithmetic is not reading intent.
 *
 * So: a named anchor only on an exact hit, and otherwise a plain number. The
 * author's existing spelling is preserved separately, by `renderKnots`, which
 * is the only thing that should ever decide how an existing knot is written.
 */
export function anchorFor(x, spec, { tolerance = 0.0005 } = {}) {
  const near = (a, b) => Math.abs(a - b) <= tolerance;
  if (near(x, spec.NOSE)) return { source: "S.NOSE", kind: "anchor" };
  if (near(x, spec.TAIL)) return { source: "S.TAIL", kind: "anchor" };
  if (near(x, spec.XF)) return { source: "S.XF", kind: "anchor" };
  if (near(x, spec.XR)) return { source: "S.XR", kind: "anchor" };
  return { source: String(round(x, 4)), kind: "literal" };
}

/**
 * Render a knot list back to source, preserving what has not changed.
 *
 * The rule that matters: a knot whose value is unchanged is written with the
 * author's own text, character for character. `T(2.60)` stays `T(2.60)` and does
 * not become `T(2.6)`. Anything else produces a diff full of churn, and a diff
 * full of churn is one nobody reads — which defeats the point of proposing a
 * change rather than making it.
 */
export function renderKnots(existing, fitted, spec, { tolerance = 0.0005, window = null } = {}) {
  const rendered = [];
  const changes = { kept: 0, revalued: 0, added: 0, removed: 0, preserved: 0 };

  const evaluated = existing.map((k) => ({ ...k, x: evaluateX(k.xSource, spec) }));
  const used = new Set();
  const inWindow = (x) => !window || (x >= window.from - tolerance && x <= window.to + tolerance);

  // Knots outside the fitting window are the author's and stay the author's.
  // A reference that covers part of a curve has no opinion about the rest, and
  // dropping those knots would delete measurements it never made.
  const outside = [];
  evaluated.forEach((k, i) => {
    if (k.x !== null && !inWindow(k.x)) {
      used.add(i);
      outside.push({ x: k.x, source: `[${k.xSource}, ${k.vSource}]` });
      changes.preserved += 1;
    }
  });

  for (const [x, v] of fitted) {
    if (!inWindow(x)) continue;
    // Reuse the author's spelling for a knot at this station, if there is one.
    let match = -1;
    let best = tolerance;
    for (let i = 0; i < evaluated.length; i += 1) {
      if (used.has(i) || evaluated[i].x === null) continue;
      const d = Math.abs(evaluated[i].x - x);
      if (d <= best) { best = d; match = i; }
    }

    if (match >= 0) {
      used.add(match);
      const original = evaluated[match];
      const currentValue = Number.parseFloat(original.vSource);
      const sameValue = Number.isFinite(currentValue) && Math.abs(currentValue - v) <= tolerance;
      if (sameValue) {
        rendered.push(`[${original.xSource}, ${original.vSource}]`);
        changes.kept += 1;
      } else {
        rendered.push(`[${original.xSource}, ${round(v, 4)}]`);
        changes.revalued += 1;
      }
      continue;
    }

    rendered.push(`[${anchorFor(x, spec).source}, ${round(v, 4)}]`);
    changes.added += 1;
  }

  changes.removed = evaluated.length - used.size;

  // Re-interleave the preserved knots in x order, so the list stays sorted.
  const fittedWithX = fitted.filter(([x]) => inWindow(x)).map(([x], i) => ({ x, source: rendered[i] }));
  const all = [...outside, ...fittedWithX].sort((a, b) => a.x - b.x);
  return { source: `[${all.map((k) => k.source).join(", ")}]`, changes };
}
