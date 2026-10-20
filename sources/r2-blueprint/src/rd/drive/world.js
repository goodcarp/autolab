// Synced from roadster-lab 3360319 (src/drive/world.js) by tools/sync-garage.mjs.
// Edit it in the lab and re-sync; a hand edit here makes the next sync refuse.
// The world the drivable car lives in: an endless flat ground at y = 0 and the
// wall-ride ramp deck.
//
// The deck is the measured curl from src/sim/ramp.js (measuredProfile, built with
// makeRamp exactly as the page and the scene build it: run-in 60 m, 0.05 m steps,
// no smoothing). Its profile lies in the world x-y plane: the car comes along +x,
// reaches the foot at x = 0 and climbs the curl. Like the scene's deck
// (src/scene/ramp.js) it starts at the foot; the run-in is the ground. Across the
// run it is extruded over z in [-1.6, 1.6] (3.2 m wide), and only its riding
// surface collides: rays from behind pass through, and nothing stops a car going
// over a side edge.
//
// Queries are exact against the profile polyline. Normals are blended between the
// polyline's vertices so a wheel rolling over the 0.05 m facets feels a smooth
// curve; the hit point itself is on the polyline.

import { measuredProfile, makeRamp, MEASURED_RAMP } from '../sim/ramp.js';

const GROUND_N = [0, 1, 0];

/**
 * Options: runIn (60 m), step (0.05 m), width (3.2 m), thickness (0.45 m, the
 * scene's slab), contactDepth (0.3 m: a point deeper than this behind the riding
 * surface is treated as being behind the deck, not in it).
 */
export function createWorld(opts = {}) {
  const runIn = opts.runIn ?? 60, step = opts.step ?? 0.05;
  const width = opts.width ?? MEASURED_RAMP.width_m;
  const halfWidth = width / 2;
  const contactDepth = opts.contactDepth ?? 0.3;
  const ramp = opts.ramp ?? makeRamp(measuredProfile({ runIn, step }), { smooth: false });
  const pts = ramp.points;

  // Arc length at every profile point (makeRamp keeps its own copy private).
  const sAll = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) sAll[i] = sAll[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let foot = 0;
  while (foot < pts.length - 1 && pts[foot][0] < -1e-9) foot++;

  // Deck segments from the foot to the lip: start A, unit tangent T, inward normal
  // N = (-Ty, Tx) (toward the centre of curvature, as ramp.normal), length, s at A.
  const nSeg = pts.length - 1 - foot;
  const Ax = new Float64Array(nSeg), Ay = new Float64Array(nSeg), Tx = new Float64Array(nSeg), Ty = new Float64Array(nSeg);
  const Len = new Float64Array(nSeg), S0 = new Float64Array(nSeg);
  for (let k = 0; k < nSeg; k++) {
    const a = pts[foot + k], b = pts[foot + k + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1e-12;
    Ax[k] = a[0]; Ay[k] = a[1]; Tx[k] = dx / l; Ty[k] = dy / l; Len[k] = l; S0[k] = sAll[foot + k];
  }
  // Vertex normals: the average of the two faces meeting there.
  const VNx = new Float64Array(nSeg + 1), VNy = new Float64Array(nSeg + 1);
  for (let v = 0; v <= nSeg; v++) {
    const a = Math.max(0, v - 1), b = Math.min(nSeg - 1, v);
    let nx = -Ty[a] - Ty[b], ny = Tx[a] + Tx[b];
    const l = Math.hypot(nx, ny) || 1;
    VNx[v] = nx / l; VNy[v] = ny / l;
  }
  const smoothNormal = (k, u) => {
    const f = Math.min(1, Math.max(0, u / Len[k]));
    let nx = VNx[k] + (VNx[k + 1] - VNx[k]) * f, ny = VNy[k] + (VNy[k + 1] - VNy[k]) * f;
    const l = Math.hypot(nx, ny) || 1;
    return [nx / l, ny / l, 0];
  };

  // A coarse grid over the profile plane: every cell lists the segments within
  // reach of a contact query (contactDepth plus a margin) so a query looks at a
  // handful of segments instead of all of them.
  const CELL = opts.cell ?? 1;
  const reach = contactDepth + 0.1;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let k = 0; k < nSeg; k++) {
    for (const [x, y] of [[Ax[k], Ay[k]], [Ax[k] + Tx[k] * Len[k], Ay[k] + Ty[k] * Len[k]]]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  minX -= reach + CELL; minY -= reach + CELL; maxX += reach + CELL; maxY += reach + CELL;
  const NX = Math.ceil((maxX - minX) / CELL), NY = Math.ceil((maxY - minY) / CELL);
  const cells = Array.from({ length: NX * NY }, () => []);
  const cellOf = (x, y) => {
    const i = Math.floor((x - minX) / CELL), j = Math.floor((y - minY) / CELL);
    return i < 0 || j < 0 || i >= NX || j >= NY ? -1 : j * NX + i;
  };
  for (let k = 0; k < nSeg; k++) {
    const x0 = Math.min(Ax[k], Ax[k] + Tx[k] * Len[k]) - reach, x1 = Math.max(Ax[k], Ax[k] + Tx[k] * Len[k]) + reach;
    const y0 = Math.min(Ay[k], Ay[k] + Ty[k] * Len[k]) - reach, y1 = Math.max(Ay[k], Ay[k] + Ty[k] * Len[k]) + reach;
    for (let j = Math.floor((y0 - minY) / CELL); j <= Math.floor((y1 - minY) / CELL); j++) {
      for (let i = Math.floor((x0 - minX) / CELL); i <= Math.floor((x1 - minX) / CELL); i++) cells[j * NX + i].push(k);
    }
  }
  const stamp = new Int32Array(nSeg);
  let query = 0;
  const all = Array.from({ length: nSeg }, (_, k) => k);

  /** Segments a ray from o along d for up to maxDist could hit. */
  function raySegments(o, d, maxDist) {
    const x0 = o[0], y0 = o[1], x1 = o[0] + d[0] * maxDist, y1 = o[1] + d[1] * maxDist;
    const i0 = Math.floor((Math.min(x0, x1) - minX) / CELL), i1 = Math.floor((Math.max(x0, x1) - minX) / CELL);
    const j0 = Math.floor((Math.min(y0, y1) - minY) / CELL), j1 = Math.floor((Math.max(y0, y1) - minY) / CELL);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 24) return all; // long rays: just test them all
    query++;
    const out = [];
    for (let j = Math.max(0, j0); j <= Math.min(NY - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(NX - 1, i1); i++) {
        for (const k of cells[j * NX + i]) if (stamp[k] !== query) { stamp[k] = query; out.push(k); }
      }
    }
    return out;
  }

  /**
   * First hit of the ray o + t·d (d a unit vector), 0 ≤ t ≤ maxDist, on the ground
   * or the deck's riding surface. Both are one-sided: a ray only hits a surface it
   * travels into. → { t, point, normal, surface: 'ground' | 'deck', s? } or null;
   * s is the ramp arc length of a deck hit (ramp.at(s) is the same point).
   */
  function raycast(o, d, maxDist = Infinity) {
    let best = null, bestT = maxDist;
    if (d[1] < -1e-12 && o[1] >= -1e-9) {
      const t = Math.max(0, o[1]) / -d[1];
      if (t <= bestT) { bestT = t; best = { t, point: [o[0] + d[0] * t, 0, o[2] + d[2] * t], normal: [...GROUND_N], surface: 'ground' }; }
    }
    const segs = Number.isFinite(maxDist) ? raySegments(o, d, maxDist) : all;
    for (const k of segs) {
      const nx = -Ty[k], ny = Tx[k];
      const den = d[0] * nx + d[1] * ny;
      if (den >= -1e-12) continue; // moving away from (or along) the riding surface
      const t = ((Ax[k] - o[0]) * nx + (Ay[k] - o[1]) * ny) / den;
      if (t < 0 || t > bestT) continue;
      const hx = o[0] + d[0] * t, hy = o[1] + d[1] * t, hz = o[2] + d[2] * t;
      if (hz < -halfWidth || hz > halfWidth) continue;
      const u = (hx - Ax[k]) * Tx[k] + (hy - Ay[k]) * Ty[k];
      if (u < -1e-9 || u > Len[k] + 1e-9) continue;
      bestT = t;
      best = { t, point: [hx, hy, hz], normal: smoothNormal(k, u), surface: 'deck', s: S0[k] + Math.min(Len[k], Math.max(0, u)) };
    }
    return best;
  }

  /**
   * Is the point p inside the ground or the deck? → { depth, normal, surface, s? }
   * for the deeper of the two, or null. The deck counts only points less than
   * contactDepth behind its riding surface and within its width.
   */
  function contact(p) {
    let best = p[1] < 0 ? { depth: -p[1], normal: [...GROUND_N], surface: 'ground' } : null;
    if (p[2] < -halfWidth || p[2] > halfWidth) return best;
    const c = cellOf(p[0], p[1]);
    if (c < 0) return best;
    let kBest = -1, dBest = Infinity, uBest = 0, sdBest = 0, offEnd = false;
    for (const k of cells[c]) {
      const dx = p[0] - Ax[k], dy = p[1] - Ay[k];
      const uRaw = dx * Tx[k] + dy * Ty[k];
      const u = Math.min(Len[k], Math.max(0, uRaw));
      const ex = dx - Tx[k] * u, ey = dy - Ty[k] * u;
      const dist = Math.hypot(ex, ey);
      if (dist < dBest) {
        dBest = dist; kBest = k; uBest = u; sdBest = ex * -Ty[k] + ey * Tx[k];
        // nearest to the deck's first or last point from beyond it: before the foot or past the lip
        offEnd = (k === 0 && uRaw < 0) || (k === nSeg - 1 && uRaw > Len[k]);
      }
    }
    // A real contact has its nearest deck point straight along the normal (not off to
    // one side, which is what a point past the lip finds).
    if (kBest >= 0 && !offEnd && sdBest < 0 && -sdBest <= contactDepth && -sdBest >= 0.95 * dBest && (!best || -sdBest > best.depth)) {
      best = { depth: -sdBest, normal: smoothNormal(kBest, uBest), surface: 'deck', s: S0[kBest] + uBest };
    }
    return best;
  }

  /**
   * A pose on the deck: the car-frame origin on the riding surface at arc length s
   * and lateral z, pitched with the deck. → { pos, quat } for createCar/createRun.
   */
  function poseAt(s, z = 0) {
    const [x, y] = ramp.at(s), th = ramp.pitch(s);
    return { pos: [x, y, z], quat: [0, 0, Math.sin(th / 2), Math.cos(th / 2)] };
  }

  return {
    ramp, raycast, contact, poseAt,
    sFoot: ramp.sFoot, sLip: ramp.length, halfWidth, width, contactDepth,
    thickness: opts.thickness ?? 0.45,
    segments: nSeg,
  };
}
