// A section, drawn to scale, on a millimetre grid.
//
// This is the other half of the 2D-to-3D loop. A reference orthographic drawing
// is a picture with a known scale; a section taken from the model is a curve
// with known coordinates. Printed on the same grid at the same scale, the two
// can be laid over each other and the difference read off in millimetres
// instead of argued about.
//
// Deliberately not a render. Nothing here goes through a camera, so nothing
// here can be wrong because of one.

import { round } from "./load.mjs";

const GRID_MINOR_MM = 50;
const GRID_MAJOR_MM = 250;

export function sectionSvg(cut, {
  scale = 1 / 10,          // 1:10 — 1 mm on the page is 10 mm on the vehicle
  margin_mm = 24,
  title = null,
  reference = null,        // an optional second outline, same coordinates
} = {}) {
  const runs = [...cut.loops.map((p) => ({ points: p, closed: true })),
    ...cut.openRuns.map((p) => ({ points: p, closed: false }))];
  if (!runs.length) return null;

  let minY = Infinity; let maxY = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const run of runs) {
    for (const [y, z] of run.points) {
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }

  // Page coordinates in millimetres: z to the right, y up.
  const toPage = ([y, z]) => [
    round((z - minZ) * 1000 * scale + margin_mm, 3),
    round((maxY - y) * 1000 * scale + margin_mm, 3),
  ];
  const width = (maxZ - minZ) * 1000 * scale + margin_mm * 2;
  const height = (maxY - minY) * 1000 * scale + margin_mm * 2;

  const path = (run) => {
    const d = run.points.map((p, i) => `${i ? "L" : "M"}${toPage(p).join(" ")}`).join(" ");
    return run.closed ? `${d} Z` : d;
  };

  const grid = [];
  for (let mmZ = Math.ceil(minZ * 1000 / GRID_MINOR_MM) * GRID_MINOR_MM; mmZ <= maxZ * 1000; mmZ += GRID_MINOR_MM) {
    const [x] = toPage([maxY, mmZ / 1000]);
    const major = Math.abs(mmZ % GRID_MAJOR_MM) < 1e-6;
    grid.push(`<line x1="${x}" y1="${margin_mm}" x2="${x}" y2="${height - margin_mm}" class="${major ? "major" : "minor"}"/>`);
  }
  for (let mmY = Math.ceil(minY * 1000 / GRID_MINOR_MM) * GRID_MINOR_MM; mmY <= maxY * 1000; mmY += GRID_MINOR_MM) {
    const [, y] = toPage([mmY / 1000, minZ]);
    const major = Math.abs(mmY % GRID_MAJOR_MM) < 1e-6;
    grid.push(`<line x1="${margin_mm}" y1="${y}" x2="${width - margin_mm}" y2="${y}" class="${major ? "major" : "minor"}"/>`);
  }

  // The centreline, which is the landmark you actually align on.
  const [centreX] = toPage([maxY, 0]);
  const [, groundY] = toPage([0, minZ]);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width, 2)}mm" height="${round(height, 2)}mm" viewBox="0 0 ${round(width, 3)} ${round(height, 3)}">
<style>
  .minor{stroke:#c9d3e2;stroke-width:.12}
  .major{stroke:#93a4bd;stroke-width:.22}
  .datum{stroke:#c0392b;stroke-width:.3;stroke-dasharray:3 1.5}
  .outline{fill:none;stroke:#1c2c4a;stroke-width:.45;stroke-linejoin:round}
  .open{fill:none;stroke:#1c2c4a;stroke-width:.45;stroke-dasharray:2 1.2}
  .ref{fill:none;stroke:#e08a00;stroke-width:.45;opacity:.85}
  text{font:2.6px ui-monospace,monospace;fill:#5b6b85}
</style>
<rect width="100%" height="100%" fill="#fbfaf7"/>
${grid.join("\n")}
<line x1="${centreX}" y1="${margin_mm}" x2="${centreX}" y2="${height - margin_mm}" class="datum"/>
<line x1="${margin_mm}" y1="${groundY}" x2="${width - margin_mm}" y2="${groundY}" class="datum"/>
${reference ? `<path class="ref" d="${reference.map((p, i) => `${i ? "L" : "M"}${toPage(p).join(" ")}`).join(" ")}"/>` : ""}
${runs.map((run) => `<path class="${run.closed ? "outline" : "open"}" d="${path(run)}"/>`).join("\n")}
<text x="${margin_mm}" y="${round(height - 8, 2)}">${title ?? `SECTION x = ${cut.station} m`}  ·  scale 1:${Math.round(1 / scale)}  ·  grid ${GRID_MINOR_MM}/${GRID_MAJOR_MM} mm  ·  centreline and ground shown dashed</text>
<text x="${margin_mm}" y="${round(height - 4, 2)}">${cut.closed} closed loop${cut.closed === 1 ? "" : "s"}, ${cut.openCount} open run${cut.openCount === 1 ? "" : "s"}  ·  width ${round((maxZ - minZ) * 1000, 1)} mm  ·  height ${round((maxY - minY) * 1000, 1)} mm</text>
</svg>
`;
}

/**
 * A side profile, model against reference, on the same millimetre grid.
 *
 * This is an acceptance check, not the instrument. The numbers come from
 * `deviationByRegion`; this is for answering "does that 100 mm live where I
 * think it does" once the number has already been read — finding 01, where
 * screenshots are the last step and never the working tool.
 */
export function profileSvg({ model, reference, knots = null }, {
  scale = 1 / 20,
  margin_mm = 22,
  title = "SIDE PROFILE",
} = {}) {
  const all = [...model.top, ...model.bottom, ...reference.top, ...reference.bottom];
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const [x, y] of all) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }

  const toPage = ([x, y]) => [
    round((x - minX) * 1000 * scale + margin_mm, 3),
    round((maxY - y) * 1000 * scale + margin_mm, 3),
  ];
  const width = (maxX - minX) * 1000 * scale + margin_mm * 2;
  const height = (maxY - minY) * 1000 * scale + margin_mm * 2;
  const line = (points) => points.map((p, i) => `${i ? "L" : "M"}${toPage(p).join(" ")}`).join(" ");

  const grid = [];
  for (let mmX = Math.ceil(minX * 1000 / 250) * 250; mmX <= maxX * 1000; mmX += 250) {
    const [x] = toPage([mmX / 1000, maxY]);
    grid.push(`<line x1="${x}" y1="${margin_mm}" x2="${x}" y2="${height - margin_mm}" class="minor"/>`);
  }
  for (let mmY = Math.ceil(minY * 1000 / 250) * 250; mmY <= maxY * 1000; mmY += 250) {
    const [, y] = toPage([minX, mmY / 1000]);
    grid.push(`<line x1="${margin_mm}" y1="${y}" x2="${width - margin_mm}" y2="${y}" class="minor"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width, 2)}mm" height="${round(height, 2)}mm" viewBox="0 0 ${round(width, 3)} ${round(height, 3)}">
<style>
  .minor{stroke:#c9d3e2;stroke-width:.14}
  .model{fill:none;stroke:#1c2c4a;stroke-width:.5;stroke-linejoin:round}
  .ref{fill:none;stroke:#e08a00;stroke-width:.5;stroke-dasharray:2.5 1.5}
  .knot{fill:#c0392b}
  text{font:2.4px ui-monospace,monospace;fill:#5b6b85}
</style>
<rect width="100%" height="100%" fill="#fbfaf7"/>
${grid.join("\n")}
<path class="ref" d="${line(reference.top)}"/>
<path class="ref" d="${line(reference.bottom)}"/>
<path class="model" d="${line(model.top)}"/>
<path class="model" d="${line(model.bottom)}"/>
${knots ? knots.map(([x, y]) => { const [px, py] = toPage([x, y]); return `<circle class="knot" cx="${px}" cy="${py}" r=".7"/>`; }).join("\n") : ""}
<text x="${margin_mm}" y="${round(height - 8, 2)}">${title}  ·  scale 1:${Math.round(1 / scale)}  ·  grid 250 mm  ·  solid = model, dashed = reference drawing${knots ? ", dots = fitted knots" : ""}</text>
</svg>
`;
}
