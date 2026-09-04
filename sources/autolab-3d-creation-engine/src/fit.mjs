// Does the model match what it claims to be built to?
//
// One table, one tolerance per row, one number per row, and a refusal to round
// a failure into a pass. This is the report that replaces "it looks about
// right" — and it is cheap enough to run after every edit, which is the whole
// argument of Measure, Don't Look, finding 01.

import { readFile } from "node:fs/promises";
import { round } from "./load.mjs";
import { keyDimensions } from "./ruler.mjs";

export async function loadSpec(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function fitReport(model, spec) {
  const measured = keyDimensions(model);
  const rows = [];

  for (const [key, expected] of Object.entries(spec.dimensions)) {
    const actual = measured[key];
    const tolerance = (spec.tolerances_mm?.[key] ?? spec.tolerances_mm?.default ?? 10) / 1000;
    if (actual === null || actual === undefined) {
      rows.push({ dimension: key, expected_m: expected, measured_m: null, status: "not measured" });
      continue;
    }
    const deviation = actual - expected;
    rows.push({
      dimension: key,
      expected_m: expected,
      measured_m: actual,
      deviation_mm: round(deviation * 1000, 1),
      tolerance_mm: round(tolerance * 1000, 1),
      status: Math.abs(deviation) <= tolerance ? "within" : "out",
      measuredFrom: measured.measuredFrom?.[key.replace(/_m$/u, "")] ?? undefined,
    });
  }

  const compared = rows.filter((r) => r.measured_m !== null && r.measured_m !== undefined);
  const out = compared.filter((r) => r.status === "out");
  const absolute = compared.map((r) => Math.abs(r.deviation_mm));

  return {
    spec: spec.id,
    model: model.path,
    rows,
    summary: {
      compared: compared.length,
      within: compared.length - out.length,
      out: out.length,
      meanDeviation_mm: absolute.length
        ? round(absolute.reduce((a, b) => a + b, 0) / absolute.length, 2)
        : 0,
      worstDeviation_mm: absolute.length ? round(Math.max(...absolute), 1) : 0,
      worst: out.length
        ? out.slice().sort((a, b) => Math.abs(b.deviation_mm) - Math.abs(a.deviation_mm))[0].dimension
        : null,
    },
  };
}

export function formatFit(report) {
  const lines = [];
  const pad = (s, n) => String(s).padEnd(n);
  lines.push(`${pad("dimension", 22)}${pad("expected", 11)}${pad("measured", 11)}${pad("dev", 10)}tol`);
  lines.push("-".repeat(62));
  for (const r of report.rows) {
    if (r.measured_m === null || r.measured_m === undefined) {
      lines.push(`${pad(r.dimension, 22)}${pad(r.expected_m, 11)}${pad("—", 11)}not measured`);
      continue;
    }
    const flag = r.status === "within" ? " " : "!";
    lines.push(
      `${flag}${pad(r.dimension, 21)}${pad(r.expected_m, 11)}${pad(r.measured_m, 11)}`
      + `${pad(`${r.deviation_mm > 0 ? "+" : ""}${r.deviation_mm}mm`, 10)}±${r.tolerance_mm}mm`,
    );
  }
  const s = report.summary;
  lines.push("-".repeat(62));
  lines.push(`${s.within}/${s.compared} within tolerance · mean ${s.meanDeviation_mm}mm · worst ${s.worstDeviation_mm}mm${s.worst ? ` (${s.worst})` : ""}`);
  return lines.join("\n");
}
