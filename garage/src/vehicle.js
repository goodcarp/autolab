// Procedural Rivian R2 — every surface is generated in code (no model files).
// Coordinates: x forward (+x = nose), y up (ground = 0), z lateral (+z = passenger/right side, -z = driver/left).
// Numbers follow the merged research spec (rivian.com/r2 dimensions; photo-derived estimates for surfacing).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { interp, roundedLoop, J, loft, capFromLoop, patchX, patchSection, linspace, bar, helix, clamp, loopPoint, loopNormal, cutGLSL } from './geom.js';

export const SPEC = {
  length: 4.722, width: 1.905, widthMirrors: 2.151, height: 1.699, wheelbase: 2.936, track: 1.640,
  frontOverhang: 0.842, rearOverhang: 0.944, groundClearance: 0.244,
  tireR: 0.4065, tireW: 0.255, rimR: 0.254, // 20 in Bicolor Carbon, 255/60 R20
};
const S = SPEC;
S.XF = S.wheelbase / 2; S.XR = -S.wheelbase / 2;
S.NOSE = S.XF + S.frontOverhang; S.TAIL = S.XR - S.rearOverhang;
const T = (xt) => S.NOSE - xt; // spec x (0 at bumper, rearward) → our x
// Published overhangs end at the outer trim, not at the skin behind it.
// The lamp lens adds 28 + 6 mm; the rear plate adds 14 + 6 mm.
const BODY_NOSE = S.NOSE - 0.034, BODY_TAIL = S.TAIL + 0.020;

// ---------- profile curves (metres) ----------
// End knots below are inset with the skin, preserving their height/width values
// and order. Roof, cabin, axle datums, and the broad corner-radius curve stay in
// their original frame; only the nose/tail profile ends need room for the trim.
const ZB = interp([[S.TAIL + 0.020, 0.55], [T(4.651273), 0.45], [T(4.56), 0.39], [T(4.43), 0.33], [T(4.22), 0.30], [T(3.34), 0.285], [T(2.60), 0.27], [T(1.30), 0.27], [T(0.40), 0.29], [T(0.22), 0.30], [T(0.11275), 0.36], [T(0.0655), 0.42], [S.NOSE - 0.034, 0.50]]);
const ZT = interp([[S.TAIL + 0.020, 1.19], [-2.30, 1.215], [-2.00, 1.225], [-1.35, 1.225], [-1.10, 1.20], [0.60, 1.20], [1.00, 1.196], [1.10, 1.193], [1.20, 1.189], [1.30, 1.185], [1.45, 1.178], [1.60, 1.170], [1.75, 1.161], [1.90, 1.149], [2.00, 1.136], [2.10, 1.112], [2.189375, 1.083], [2.2445, 1.050], [S.NOSE - 0.034, 1.000]]);
const HWB = interp([[S.TAIL + 0.020, 0.78], [T(4.696273), 0.85], [T(4.675818), 0.895], [T(4.634909), 0.915], [T(4.40), 0.92], [T(1.45), 0.92], [T(0.25), 0.915], [T(0.136375), 0.905], [T(0.073375), 0.87], [T(0.04975), 0.82], [S.NOSE - 0.034, 0.74]]);
const HWT = interp([[S.TAIL + 0.020, 0.79], [T(4.696273), 0.86], [T(4.675818), 0.90], [T(4.634909), 0.92], [-2.00, 0.92], [-1.00, 0.92], [0.60, 0.92], [1.00, 0.90], [1.30, 0.875], [2.00, 0.87], [2.15, 0.87], [2.205125, 0.86], [2.2445, 0.83], [S.NOSE - 0.034, 0.75]]);
const RT = interp([[S.TAIL, 0.06], [T(3.5), 0.09], [T(1.7), 0.09], [T(1.2), 0.12], [S.NOSE, 0.07]]);
// greenhouse top: long raked windscreen (≈38°) flattening into the roof, flat roof, spoiler lip, rear glass 27° from vertical
// The last knot is 1.245, not the belt: at 1.20 the greenhouse ring collapses to 6 mm at x = -2.339
// and the liftgate's rear-glass loft terminates in a knife point, which pokes out past the quarter
// panel as a curl at the D-pillar base. 1.245 leaves a 48 mm rim for the loft to end on and for its
// cap to close -- the same reason COWL_X0 sits where the ring is still 60 mm at the front.
const ZROOF = interp([[T(4.70), 1.245], [-2.30, 1.286], [-2.20, 1.541], [-2.10, 1.670], [-2.00, 1.682], [-1.90, 1.686], [-1.80, 1.688], [-1.60, 1.693], [-1.40, 1.696], [-1.20, 1.699], [-0.60, 1.700], [-0.40, 1.699], [-0.20, 1.696], [0.00, 1.691], [0.10, 1.684], [0.20, 1.668], [0.30, 1.634], [0.40, 1.580], [0.50, 1.524], [0.60, 1.464], [0.70, 1.403], [0.80, 1.339], [0.90, 1.271], [1.00, 1.201], [1.06, 1.150]]);
// The last three knots used to run 0.64 / 0.70 / 0.74, i.e. the greenhouse kept narrowing to the
// REAR GLASS's own width right up to the tail. But by then ZROOF has come down to the tailgate top,
// so the section had to lose 270 mm of width across 42 mm of height: a shelf, whose silhouette folds
// over and draws as a curl clipping through the quarter panel at the D-pillar base. At the tail the
// ring is the top edge of the tailgate, not the glass, so it should sit near the body's own width.
const HWG = interp([[T(4.70), 0.84], [T(4.60), 0.78], [T(4.45), 0.755], [T(4.20), 0.76], [-0.30, 0.76], [0.05, 0.71], [0.18, 0.69], [0.30, 0.69], [0.45, 0.71], [0.65, 0.73], [0.77, 0.75], [0.90, 0.80], [1.00, 0.84]]);

const WELL = 0.665;          // wheel-well inner wall (lateral)
const RA = 0.505;            // arch opening half-size (squircle)
const ARCH_N = 2.7;
function archZ(x) {
  let z = -1;
  for (const xa of [S.XF, S.XR]) {
    const u = Math.abs(x - xa) / RA;
    if (u < 1) z = Math.max(z, S.tireR + RA * Math.pow(1 - Math.pow(u, ARCH_N), 1 / ARCH_N));
  }
  return z;
}
const ROLL_N = 0.11, ROLL_T = 0.10;
function rollOff(x) {
  if (x > BODY_NOSE - ROLL_N) { const f = clamp((x - (BODY_NOSE - ROLL_N)) / ROLL_N, 0, 1); return [1 - Math.sqrt(Math.max(0, 1 - f * f)), ROLL_N]; }
  if (x < BODY_TAIL + ROLL_T) { const f = clamp(((BODY_TAIL + ROLL_T) - x) / ROLL_T, 0, 1); return [1 - Math.sqrt(Math.max(0, 1 - f * f)), ROLL_T]; }
  return [0, 0];
}
export function lowerSec(x, notch = true) {
  let hwB = HWB(x), hwT = HWT(x), zb = ZB(x), zt = ZT(x), rt = RT(x), rb = 0.07;
  const [s, R] = rollOff(x);
  if (s > 0) { hwB -= s * R * 0.30; hwT -= s * R * 0.35; zt -= s * R * 0.12; zb += s * R * 0.10; }
  const pts = roundedLoop({ hwB, hwT, zb, zt, rb, rt, bulge: 0.010 });
  if (notch) { const za = archZ(x); if (za > 0) for (const p of pts) if (Math.abs(p[0]) > 0.5 && p[1] < za) p[0] = Math.sign(p[0]) * Math.min(Math.abs(p[0]), WELL); }
  return pts;
}
// plan-view wrap of the glazing: the centre of the windscreen/roof sits ahead of (i.e. higher at a station than) the pillars
// --- windscreen / A-pillar construction -------------------------------------------------------
// The glass side edge follows the roof silhouette offset down by a small constant plan-view wrap
// (WS_CROWN): the real pane is curved in side view, so a straight edge would force a 55 mm wrap
// mid-span and read as a fat pillar. The door-glass front edge is that same curve offset
// perpendicular by PILLAR_W, so the black band has constant width all the way up.
const WS_CROWN = 0.020;      // how far the glass centre leads the pillars
const PILLAR_DX = 0.095;     // visible A-pillar width, measured horizontally (matches the photo: 60-120 mm)
const SAIL_Y = 1.335;        // below this the edge runs down to the belt as the mirror sail
const DLO_TOP = 1.565;       // top of the side glass
const CROWN = interp([[S.TAIL, 0.018], [-0.40, 0.020], [-0.10, 0.024], [0.90, 0.024]]);
const crownAt = (x) => CROWN(x);
const glassEdgeY = (x) => ZROOF(x) - WS_CROWN;
const _edge = (() => { const out = []; for (let x = 0.10; x <= 0.90; x += 0.01) out.push([x, glassEdgeY(x)]); return out; })();
const glassEdgeXatY = interp(_edge.map(p => [p[1], p[0]]).sort((a, b) => a[0] - b[0]));
const doorEdgeXatY = (y) => glassEdgeXatY(y) - PILLAR_DX;   // band of constant horizontal width
const doorEdgeYatX = (x) => glassEdgeY(x + PILLAR_DX);
const SAIL_X = doorEdgeXatY(SAIL_Y), BELT_X = 0.60, BELT_Y = 1.20;
// front edge of the door glass at height y
const doorGlassX = (y) => y >= SAIL_Y ? doorEdgeXatY(y) : SAIL_X + (SAIL_Y - y) * (BELT_X - SAIL_X) / (SAIL_Y - BELT_Y);
// height at which that edge crosses station x
const ySailAt = (x) => x <= SAIL_X ? Math.min(DLO_TOP, doorEdgeYatX(x)) : Math.max(BELT_Y, SAIL_Y - (x - SAIL_X) * (SAIL_Y - BELT_Y) / (BELT_X - SAIL_X));
// quadratic fit of doorGlassX over the glass band, so the shader cut matches the frame exactly
const DOOR_Q = (() => {
  const P = []; for (let i = 0; i <= 40; i++) { const y = SAIL_Y + (DLO_TOP - SAIL_Y) * i / 40; P.push([y, doorEdgeXatY(y)]); }
  let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
  for (const [y, x] of P) { const y2 = y * y; S0++; S1 += y; S2 += y2; S3 += y2 * y; S4 += y2 * y2; T0 += x; T1 += x * y; T2 += x * y2; }
  const M = [[S0, S1, S2], [S1, S2, S3], [S2, S3, S4]], V = [T0, T1, T2];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const sub = (k) => M.map((r, i) => r.map((v, j) => j === k ? V[i] : v));
  const D = det(M);
  return [det(sub(0)) / D, det(sub(1)) / D, det(sub(2)) / D];
})();

export function upperSec(x) {
  const zb = ZT(x) - 0.012, zt = ZROOF(x);
  const rtMax = x > 0.05 ? 0.014 : (x > -0.20 ? 0.014 + (0.05 - x) * 0.244 : 0.075); // crisp windscreen side edges, rounder roof aft of the header
  const hwT = HWG(x), rt = Math.min(rtMax, (zt - zb) * 0.45);
  let hwB = Math.min(HWT(x) - 0.006, 0.915);
  // Forward of the doors the body's top corner is far rounder than the greenhouse's foot, so the ring
  // would stand ~30 mm proud of the fender and show as a dart at the pillar base. Tuck the foot onto
  // the skin it actually sits on, blended in over the last 80 mm before the cowl.
  if (x > 0.70) {
    const w = clamp((x - 0.70) / 0.08, 0, 1), lp = lowerSec(x, false);
    const zSkin = loopPoint(lp, jExact(lp, J.cTR, J.top, zb))[0] - 0.004;
    if (zSkin < hwB) hwB += (zSkin - hwB) * w * w * (3 - 2 * w);
  }
  const pts = roundedLoop({ hwB, hwT, zb, zt, rb: 0.012, rt, bulge: 0.012 });
  // crown: full on the top surface, fading out over the corner and the first 0.12 m of the side, so no step
  const k = crownAt(x), yFull = zt - rt, yZero = zt - rt - 0.12;
  for (const p of pts) { const w = Math.max(0, Math.min(1, (p[1] - yZero) / (yFull - yZero))); if (w > 0) { const u = Math.min(1, Math.abs(p[0]) / hwT); p[1] -= k * u * u * w; } }
  return pts;
}
const stations = (x0, x1, step) => linspace(x0, x1, step);
const rollStations = (end, R, sign) => [0.12, 0.30, 0.48, 0.64, 0.78, 0.88, 0.95, 0.985].map(f => end - sign * R * (1 - f));
function jAtHeight(pts, jFrom, jTo, z) {
  let best = jFrom, bd = 1e9;
  for (let j = jFrom; j <= jTo; j += 0.25) { const p = loopPoint(pts, j); const d = Math.abs(p[1] - z); if (d < bd) { bd = d; best = j; } }
  return best;
}
// exact fractional loop index at height y within [jFrom, jTo] (linear interpolation between loop points)
function jExact(pts, jFrom, jTo, y) {
  let best = jFrom, bd = 1e9;
  for (let j = jFrom; j < jTo; j++) {
    const a = loopPoint(pts, j)[1], b = loopPoint(pts, j + 1)[1];
    if ((a - y) * (b - y) <= 0 && a !== b) return j + (y - a) / (b - a);
    const d = Math.abs(a - y); if (d < bd) { bd = d; best = j; }
  }
  return best;
}
// grid over a loft: columns are stations xs, rows run from jTop(x, pts) to jBot(x, pts) (fractional indices)
function colGrid(secFn, xs, jTop, jBot, M, off) {
  const N = xs.length, pos = new Float32Array(N * M * 3), idx = [];
  for (let i = 0; i < N; i++) {
    const x = xs[i], pts = secFn(x), t = jTop(x, pts), b = jBot(x, pts);
    for (let r = 0; r < M; r++) { const j = t + (b - t) * r / (M - 1); const p = loopPoint(pts, j), n = loopNormal(pts, j); const k = (i * M + r) * 3; pos[k] = x; pos[k + 1] = p[1] + n[1] * off; pos[k + 2] = p[0] + n[0] * off; }
  }
  for (let i = 0; i < N - 1; i++) for (let r = 0; r < M - 1; r++) { const a = i * M + r, b = a + 1, c = a + M + 1, d = a + M; idx.push(a, b, c, a, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
// grid over a loft: rows are heights ys, columns run from xa(y) to xb(y); the loop index comes from the exact height on the side segment
// A panel whose rows are LOOP INDICES (so it can wrap the shoulder, which a height-indexed grid
// cannot) but whose x limits vary per row (which patchX, one x range for every index, cannot).
// The rear door needs both: it wraps from the rocker over the shoulder, and its trailing edge rakes.
// The row's height is read once off a reference section at the panel's mid span -- the section's
// height at a given index moves only a few mm across one door's worth of x.
function rakedPatch(secFn, jList, xaOf, xb, N, off) {
  const M = jList.length, pos = new Float32Array(N * M * 3), idx = [];
  const ref = secFn((xb + xaOf(1.15)) / 2);
  for (let r = 0; r < M; r++) {
    const j = jList[r], x0 = xaOf(loopPoint(ref, j)[1]);
    for (let i = 0; i < N; i++) {
      const x = x0 + (xb - x0) * i / (N - 1);
      const pts = secFn(x), p = loopPoint(pts, j), n = loopNormal(pts, j), k = (r * N + i) * 3;
      pos[k] = x; pos[k + 1] = p[1] + n[1] * off; pos[k + 2] = p[0] + n[0] * off;
    }
  }
  for (let r = 0; r < M - 1; r++) for (let i = 0; i < N - 1; i++) { const q = r * N + i; idx.push(q, q + 1, q + N + 1, q, q + N + 1, q + N); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function rowGrid(secFn, ys, xa, xb, jRange, N, off) {
  const M = ys.length, pos = new Float32Array(N * M * 3), idx = [];
  for (let r = 0; r < M; r++) {
    const y = ys[r], x0 = xa(y), x1 = xb(y);
    for (let i = 0; i < N; i++) { const x = x0 + (x1 - x0) * i / (N - 1); const pts = secFn(x); const j = jExact(pts, jRange[0], jRange[1], y); const p = loopPoint(pts, j), n = loopNormal(pts, j); const k = (r * N + i) * 3; pos[k] = x; pos[k + 1] = p[1] + n[1] * off; pos[k + 2] = p[0] + n[0] * off; }
  }
  for (let r = 0; r < M - 1; r++) for (let i = 0; i < N - 1; i++) { const a = r * N + i, b = a + 1, c = a + N + 1, d = a + N; idx.push(a, b, c, a, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

// A band that follows the body's OWN skin at height y: down the +z quarter from xA to the cap, across
// the cap face, and back up the -z quarter. The real R2's rear light bar and bumper are each ONE
// wrap-around part rather than a flat panel with two corner pieces stuck on the quarters.
function wrapBand(xA, xCap, y, h, off, jHi, part = 'all') {
  // Build the RAW plan-view outline first -- down the +z quarter, across the tail, back up the -z
  // quarter -- then offset every point along that outline's own outward normal.
  //
  // `off` is an outward offset, and outward is a DIRECTION: +z on the flanks, -x across the tail,
  // and something in between round the corner. Adding it to one axis at a time cannot express that.
  // Adding it to z on the flanks and to x at the cap (either sign) leaves a step of `off` exactly at
  // the corner, which renders as a square flap jutting out of the bumper -- and adding it with the
  // wrong sign at the cap buried the whole tail crossing inside the body.
  const raw = [];
  for (const x of linspace(xA, xCap, 0.012)) {
    const sec = lowerSec(x, false), j = jAtHeight(sec, J.sideR, jHi, y);
    raw.push([x, loopPoint(sec, j)[0]]);
  }
  const nF = raw.length, w = raw[nF - 1][1];
  for (let i = 1; i < 12; i++) raw.push([xCap, w - 2 * w * i / 12]);
  const outline = [...raw, ...raw.slice(0, nF).reverse().map(q => [q[0], -q[1]])];
  // outward normal of the plan curve: n = (tz, -tx) for a tangent t, which gives +z down the near
  // flank, -x across the tail and -z back up the far flank, with a mitre through each corner
  const full = outline.map((p, i) => {
    const a = outline[Math.max(0, i - 1)], b = outline[Math.min(outline.length - 1, i + 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1], L = Math.hypot(tx, tz) || 1;
    return [p[0] + (tz / L) * off, p[1] - (tx / L) * off];
  });
  // The real R2 carries the lamp bar on the LIFTGATE: closed it reads as one piece across the tail,
  // and it swings up with the gate, leaving only the wrapped corner stubs behind on the quarters.
  // So the band splits at the two corners -- 'cross' is the run over the tail cap (goes on the gate),
  // 'ends' is the two quarter wraps (stay on the body), 'all' is the whole thing (the bumper, which
  // really is one body part). Both halves are cut from the SAME offset outline and share their
  // boundary vertices, so they cannot mis-register at the shut line however the gate is posed.
  const a0 = nF - 1, b0 = nF + 11;
  const runs = part === 'cross' ? [[a0, b0]]
    : part === 'ends' ? [[0, a0], [b0, full.length - 1]]
      : [[0, full.length - 1]];
  const pos = [], idx = [];
  for (const [i0, i1] of runs) {
    const base = pos.length / 3;
    for (let i = i0; i <= i1; i++) for (let r = 0; r < 2; r++) pos.push(full[i][0], y + (r ? h / 2 : -h / 2), full[i][1]);
    for (let i = 0; i < i1 - i0; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function onSkin(x, z, sgn, off) { const pts = lowerSec(x, false); const j0 = sgn > 0 ? J.sideR : J.sideL; const j = jAtHeight(pts, j0, j0 + 17, z); const p = loopPoint(pts, j), n = loopNormal(pts, j); return [x, p[1] + n[1] * off, p[0] + n[0] * off]; }

// --- front-end junctions: hood shut line, cowl tray -------------------------------------------
// Height of a section's upper surface at lateral z (walks up the right flank and across the top).
function topYatZ(secFn, x, z) {
  const pts = secFn(x), az = Math.abs(z);
  for (let j = J.sideR; j < J.cTL; j++) {
    const a = pts[j], b = pts[j + 1], da = Math.abs(a[0]) - az, db = Math.abs(b[0]) - az;
    if (da * db <= 0 && da !== db) return a[1] + (b[1] - a[1]) * (da / (da - db));
  }
  return pts[J.top][1];
}
const DECK_Z = 0.84;               // lateral edge of the open deck / cowl well (CUT.deckZ)
const HOOD_J = J.cTR + 2;          // loop index of the hood's outer edge over most of its length
const HOOD_OFF = 0.006;            // how far the hood floats off the body skin
// fractional loop index at lateral z along the top run (z falls as j climbs over the corner)
function jAtZ(pts, jFrom, jTo, z) {
  for (let j = jFrom; j < jTo; j++) {
    const a = pts[j][0], b = pts[j + 1][0];
    if ((a - z) * (b - z) <= 0 && a !== b) return j + (z - a) / (b - a);
  }
  return jFrom;
}
// The hood's outer edge. At the rear it starts on the cowl tray's own outboard corner and wraps
// down over the fender shoulder through the first 300 mm, so the shut line grows out of the cowl
// instead of beginning as a 70 mm vertical step at x = 1.00.
export function hoodJ(x, pts) {
  const t = clamp((x - 1.11) / 0.30, 0, 1), s = t * t * (3 - 2 * t), j0 = jAtZ(pts, J.cTR, J.top, DECK_Z);
  return j0 + (HOOD_J - j0) * s;
}
// That same edge in side elevation, sampled straight off the section curves. The frunk aperture is
// cut to this curve (less a 4 mm lip) so the shut line sits on the fender shoulder along its whole
// length — the straight cut it replaces drifted up to 39 mm away from it around the strut tower.
const HOOD_EDGE = [1.09, 1.11, 1.14, 1.08, 1.12, 1.17, 1.22, 1.28, 1.35, 1.45, 1.60, 1.75, 1.90, 2.02, 2.12, 2.20, 2.26, 2.30].map(x => {
  const pts = lowerSec(x, false), j = hoodJ(x, pts), p = loopPoint(pts, j), n = loopNormal(pts, j);
  return [x, p[1] + n[1] * HOOD_OFF - 0.004];
});

// ---------- apertures (doors / frunk) cut out of the shell lofts by the shaders ----------
// The rear door's raked trailing edge, evaluated from the same table the shader is given, so the
// geometry and the cut can never drift apart. Anything that has to STOP at that edge -- the door
// skin, its crease, the body's own rear-quarter crease -- reads it from here.
export const rakeX = (y) => {
  const t = CUT.rearShut;
  if (y <= t[0][0]) return t[0][1];
  for (let i = 0; i < t.length - 1; i++) if (y <= t[i + 1][0]) return t[i][1] + (t[i + 1][1] - t[i][1]) * (y - t[i][0]) / (t[i + 1][0] - t[i][0]);
  return t[t.length - 1][1];
};
export const CUT = {
  doorZ: 0.55, doorY0: 0.50, doorY1: DLO_TOP, beltY: BELT_Y,
  // Bottom of the quarter aperture. BELT_Y is a single number but ZT is not: it rises to 1.225 behind
  // the doors, so back here the greenhouse ring's floor (ZT - 12 mm) is 13 mm ABOVE the belt and a
  // constant cut ran straight past the bottom of the glass. Follow the section instead.
  quarterY0: linspace(-1.80, -1.05, 0.05).map(x => [x, ZT(x) - 0.006]),
  // Door shut lines, measured off the panel outlines drawn on Rivian's official orthographic side
  // drawing. The two doors meet on ONE line at about x -0.245: the 100 mm of body this model used to
  // keep between the two apertures is not on the car, where you see only a shut line.
  rearX1: -0.251, frontX0: -0.240, frontX1: 0.71, frontGlassX1: 0.60, aSlope: 1.4,
  rearGlassX0: -0.919, rearGlassX1: -0.402, frontGlassX0: -0.299,
  // Rear door APERTURE above the belt. It is not the same thing as the glass: on the car the rear
  // door is framed, its trailing edge runs unbroken from rocker to roof rail, and the C pillar sits
  // BEHIND it. Cutting the body only as far as the glass left 324 mm of shell where the door's own
  // frame belongs, hanging over the opening whenever the door swung. The frame between here and
  // rearGlassX0 is carried on the door, and the drawing's C pillar is what is left: 157 mm.
  rearFrameX0: -1.243,
  // The rear door's TRAILING edge is not vertical -- it rakes forward as it comes down, following the
  // wheel arch, from -1.243 at the belt to -0.885 at the rocker. A single rearX0 was the same mistake
  // as BELT_Y and tailY: a constant standing in for a curve. Measured every 27 mm off the drawing.
  rearShut: [[0.50, -0.885], [0.605, -0.922], [0.738, -0.972], [0.844, -1.020], [0.923, -1.084],
             [0.976, -1.172], [1.020, -1.238], [1.30, -1.243]],
  // Quarter light, measured off Rivian's official orthographic side drawing (the DLO is drawn on it):
  // its frame runs x -2.17 .. -1.38, so the glass reaches almost to the liftgate and the D-pillar is
  // narrow. Ours used to stop at -1.72 and start at -1.13, which put 410 mm of body where the drawing
  // has glass and left a 460 mm C-pillar looking like a 170 mm one. -2.12 is just ahead of the
  // greenhouse loft's own rear end at T(4.49) = -2.129, where the liftgate takes over.
  quarterX0: -2.12, quarterX1: -1.40,   // fixed quarter window behind the rear door
  qa: DOOR_Q[0], qb: DOOR_Q[1], qc: DOOR_Q[2], sailY: SAIL_Y, sailSlope: (BELT_X - SAIL_X) / (SAIL_Y - BELT_Y),
  hoodX0: 1.11, hoodX1: BODY_NOSE - 0.08, hoodEdge: HOOD_EDGE, hoodZ: 0.93, // shut line on the fender shoulder
  // deckX0 reaches PAST the body's own tail (BODY_TAIL = -2.392). It used to stop at -2.36, which left a
  // 52 mm band of top deck uncut across the very back -- invisible with the liftgate shut, and a bar
  // straight across the cargo opening the moment it was raised. Same class as the door rail: a cut
  // boundary set as a constant that stops short of the surface it is cutting.
  deckX0: BODY_TAIL - 0.01, deckX1: 0.985, deckZ: DECK_Z, deckY0: 1.13, deckY1: 1.26,
  // Ceiling of the deck cut. A flat 1.26 was fine down the cabin but forward of x ~ 0.92 the whole
  // greenhouse ring sits below it, so the cut ate the FOOT of the windscreen: the glass surface
  // stopped ~70 mm above its own bottom rim and that rim was left sticking forward over the cowl as
  // a bare blade. The ceiling now follows the roofline (ZROOF - 35 mm) wherever that is lower, so the
  // cut removes the ring's floor and never the glass, and it closes itself off once the ceiling falls
  // under deckY0. It tracks the section's own height at the cut's outboard edge (z = DECK_Z) rather
  // than the centreline roof, so the removed band always ends exactly where the surviving shoulder
  // begins -- a centreline ceiling overshoots the shoulder up front and opens a slot along the cowl.
  // Sampled here and emitted as a ramp sum, same as the hood's shut line.
  deckCeil: linspace(0.58, 1.02, 0.02).map(x => [x, topYatZ(upperSec, x, DECK_Z) - 0.002]),
};

// ---------- cowl tray (scuttle) ----------
// One panel from the windscreen's lower lip forward to the hood's rear edge. Its front edge is
// literally the hood's rear ring (same skin, same 6 mm float) so the two share one seam, and its
// outboard edges land on the deck-cut line, so the body-colour shoulder reads as a single break.
const COWL_X0 = 0.94, COWL_X1 = 1.11;   // glass base / hood rear edge. Ending the glass at 1.00 left a
// 17 mm ring that rendered as a knife edge overhanging the cowl; at 0.94 the ring is 60 mm and the
// tray carries the surface forward from there to the hood.
const lowerTop = (x) => lowerSec(x, false);
const cowlBaseY = (x, z) => topYatZ(lowerTop, x, z) + HOOD_OFF;    // the body skin the tray rides on
const cowlFade = (t) => { const s = clamp((Math.abs(t) - 0.62) / 0.38, 0, 1); return 1 - s * s * (3 - 2 * s); };
// Tray surface = the body's own top shape, lifted at the back to the greenhouse's front ring (so the
// glass lip and the tray share one edge) and dropped into a drain trough in the middle. Both terms
// vanish at x = COWL_X1, so the tray's front edge IS the hood's rear ring — one seam, no step.
export function cowlYat(x, z) {
  const u = clamp((x - COWL_X0) / (COWL_X1 - COWL_X0), 0, 1);
  const lip = (topYatZ(upperSec, COWL_X0, z) - cowlBaseY(COWL_X0, z)) * Math.pow(1 - u, 6);
  const dip = 0.013 * Math.pow(Math.sin(Math.PI * u), 1.6) * cowlFade(z / DECK_Z);
  return cowlBaseY(x, z) + lip - dip;
}
function grid(NX, NZ, fn) {
  const pos = new Float32Array(NX * NZ * 3), idx = [];
  for (let i = 0; i < NX; i++) for (let r = 0; r < NZ; r++) { const p = fn(i / (NX - 1), r / (NZ - 1)), k = (i * NZ + r) * 3; pos[k] = p[0]; pos[k + 1] = p[1]; pos[k + 2] = p[2]; }
  for (let i = 0; i < NX - 1; i++) for (let r = 0; r < NZ - 1; r++) { const a = i * NZ + r, b = a + 1, c = a + NZ + 1, d = a + NZ; idx.push(a, b, c, a, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const cowlX = (u) => COWL_X0 + (COWL_X1 - COWL_X0) * u;
const cowlTray = () => grid(26, 45, (u, v) => { const x = cowlX(u), z = DECK_Z * (2 * v - 1); return [x, cowlYat(x, z), z]; });
// outer flange: closes the few mm between the tray's edge and the fender shoulder, and gives the
// cowl-to-fender break a single crisp line instead of two near-parallel ones
const cowlSkirt = (sgn) => grid(26, 2, (u, v) => {
  const x = cowlX(u), z = sgn * DECK_Z;
  return [x, v < 0.5 ? cowlYat(x, z) : topYatZ(lowerTop, x, z) - 0.004, z];
});

// ---------- materials ----------
const white = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
const dissolve = { value: 1 };
function makeShellMat(cut) {
  const m = white.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDissolve = dissolve;
    sh.vertexShader = 'varying vec3 vObjPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vObjPos = position;');
    sh.fragmentShader = 'uniform float uDissolve; varying vec3 vObjPos;\n' + cutGLSL(CUT) + '\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\n' + (cut ? ' if (inAperture(vObjPos)) discard;\n' : '') + ' if (uDissolve < 1.0) { float dn = fract(sin(dot(floor(gl_FragCoord.xy * 0.5), vec2(12.9898, 78.233))) * 43758.5453); if (dn > uDissolve) discard; }');
  };
  m.customProgramCacheKey = () => 'shell' + (cut ? 'cut' : '');
  return m;
}
const shellMat = makeShellMat(false), shellCutMat = makeShellMat(true);

// ---------- part registry ----------
let nextId = 1;
class Part {
  constructor(name, label, desc, category) {
    this.name = name; this.label = label; this.desc = desc; this.category = category;
    this.id = nextId++; this.group = new THREE.Group(); this.group.name = name; this.meshes = [];
    this.rest = new THREE.Vector3(); this.explode = new THREE.Vector3(); this.anchor = null; this.anchorN = null;
  }
  add(geo, opts = {}) {
    const m = new THREE.Mesh(geo, opts.cut ? shellCutMat : (this.category === 'shell' ? shellMat : white));
    if (opts.pos) m.position.set(...opts.pos);
    if (opts.rot) m.rotation.set(...opts.rot);
    if (opts.scale) m.scale.set(...opts.scale);
    m.castShadow = true; m.receiveShadow = false;
    m.userData.part = this; m.userData.subId = opts.sub ?? 0; m.userData.cut = !!opts.cut;
    this.meshes.push(m); (opts.parent || this.group).add(m);
    return m;
  }
  addMesh(m, parent) { if (this.category === 'shell') m.material = shellMat; m.castShadow = true; m.userData.part = this; m.userData.subId = 0; this.meshes.push(m); (parent || this.group).add(m); return m; }
}
// translate a geometry so that `hinge` becomes the local origin
const rebase = (g, h) => { g.translate(-h.x, -h.y, -h.z); return g; };

export function buildVehicle() {
  nextId = 1;
  const root = new THREE.Group(); root.name = 'R2';
  const body = new THREE.Group(); body.name = 'body'; root.add(body); // bobs with the suspension
  const parts = {}; const order = [];
  const hidden = new Set();   // ?hide= / ?only= diagnostic isolation
  const P = (name, label, desc, category, parent = body) => { const p = new Part(name, label, desc, category); parts[name] = p; order.push(p); parent.add(p.group); return p; };
  const rbox = (w, h, d, r, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, r);
  const midLower = lowerSec(0.0, false);
  const jCrease = jAtHeight(midLower, J.sideR, J.sideR + 17, 0.97), jCreaseL = jAtHeight(midLower, J.sideL, J.sideL + 17, 0.97);
  const jRockTop = jAtHeight(midLower, J.cBR, J.sideR + 6, 0.50), jRockTopL = jAtHeight(midLower, J.sideL + 10, J.cBL + 7, 0.50);
  const midUpper = upperSec(-0.5);
  const jDLO = jAtHeight(midUpper, J.sideR, J.cTR + 2, 1.535), jDLOL = jAtHeight(midUpper, J.cTL + 6, J.sideL + 17, 1.535); // top of the door glass

  // ===== lower body shell (door and frunk apertures are cut in the shader) =====
  const bodyP = P('body', 'BODY SHELL', 'Slab-sided unibody, belt line at 1 220 mm, flat shoulder', 'shell');
  {
    const xs = [...rollStations(BODY_TAIL, ROLL_T, -1), ...stations(BODY_TAIL + ROLL_T, BODY_NOSE - ROLL_N, 0.035), ...rollStations(BODY_NOSE, ROLL_N, +1).reverse()].sort((a, b) => a - b);
    bodyP.add(loft(xs.map(x => ({ x, pts: lowerSec(x) }))), { cut: true });
    bodyP.add(capFromLoop(lowerSec(BODY_NOSE - 0.002), BODY_NOSE - 0.002, +1), { sub: 1 });
    // crease on the rear quarters (the front crease is the clamshell hood edge, the door creases ride the doors)
    // this ribbon is NOT cut by the apertures, so it has to end ON the rear door's shut line: any of
    // it left inside the opening is a bar across the doorway once the door swings (the v0.12.0 bug).
    const creaseEnd = rakeX(loopPoint(lowerSec(-1.6), jCrease)[1]);
    bodyP.add(patchX(lowerSec, [jCrease - 0.04, jCrease + 0.04], stations(T(4.40), creaseEnd, 0.04), 0.004), { sub: 2 });
    bodyP.add(patchX(lowerSec, [jCreaseL - 0.04, jCreaseL + 0.04], stations(T(4.40), creaseEnd, 0.04), 0.004), { sub: 2 });
    bodyP.add(patchX(lowerSec, [jCrease - 0.04, jCrease + 0.04], stations(1.15, 2.18, 0.04), 0.004), { sub: 2 });   // front fender crease
    bodyP.add(patchX(lowerSec, [jCreaseL - 0.04, jCreaseL + 0.04], stations(1.15, 2.18, 0.04), 0.004), { sub: 2 });
  }
  // clamshell hood (frunk lid): wraps 0.09 down over the fender tops; hinged at the cowl
  const hoodP = P('hood', 'FRONT TRUNK LID', 'Power clamshell hood over a 147 L frunk, hinged at the cowl', 'shell');
  {
    const xs = [...stations(1.11, BODY_NOSE - ROLL_N, 0.035), ...rollStations(BODY_NOSE, ROLL_N, +1).slice(0, 7).reverse()].sort((a, b) => a - b);
    hoodP.hinge = new THREE.Vector3(1.11, ZT(1.11) + HOOD_OFF, 0);
    hoodP.group.position.copy(hoodP.hinge);
    // edges follow hoodJ, so the rear corner starts on the cowl tray and wraps down into the shut line
    hoodP.add(rebase(colGrid(x => lowerSec(x, false), xs, (x, pts) => hoodJ(x, pts), (x, pts) => 104 - hoodJ(x, pts), 33, HOOD_OFF), hoodP.hinge));
    // power-dome creases and the compass badge
    for (const k of [4.8, 15.2]) hoodP.add(rebase(patchX(x => lowerSec(x, false), [J.top + k - 0.12, J.top + k + 0.12], stations(1.005, BODY_NOSE - 0.30, 0.04), 0.009), hoodP.hinge), { sub: 1 });
    hoodP.add(new THREE.CylinderGeometry(0.026, 0.026, 0.006, 20), { pos: [BODY_NOSE - 0.06 - hoodP.hinge.x, ZT(BODY_NOSE - 0.06) + 0.011 - hoodP.hinge.y, 0], sub: 2 });
    hoodP.anchor = new THREE.Vector3(1.60, ZT(1.60) + 0.01, 0.0); hoodP.anchorN = new THREE.Vector3(0.15, 1, 0);
  }
  // frunk tub and engine-bay structure under the hood
  const frunkP = P('frunk', 'FRONT TRUNK', '147 L tub between the strut towers, drain plug, power release', 'interior');
  {
    // tub side walls sit outboard of the springs (they used to be at |z| 0.48, only 50 mm inboard of the
    // towers, which capped the coil at 207 mm); the tub narrows around the towers instead of clearing them
    for (const sgn of [1, -1]) frunkP.add(new THREE.BoxGeometry(0.80, 0.30, 0.02), { pos: [T(0.62), 0.87, sgn * 0.405], sub: 1 });
    for (const dx of [-0.40, 0.40]) frunkP.add(new THREE.BoxGeometry(0.02, 0.30, 0.81), { pos: [T(0.62) + dx, 0.87, 0], sub: 1 });
    // strut towers: reach the top mount at y ~1.08 instead of stopping 100 mm short of it
    for (const sgn of [1, -1]) frunkP.add(new THREE.CylinderGeometry(0.115, 0.145, 0.44, 20), { pos: [S.XF - 0.075, 0.875, sgn * 0.635], sub: 2 });
    frunkP.add(rbox(0.30, 0.10, 0.60, 0.02, 2), { pos: [T(1.45), 0.74, 0], sub: 3 });                          // power electronics under the cowl
  }
  // floor plates that would otherwise mask the skateboard in PANELS mode — dissolve with the shell, not with the interior trim
  const frunkFloorP = P('frunkFloor', 'FRUNK FLOOR', 'Bay floor and tub floor, between the strut towers', 'shell');
  {
    frunkFloorP.add(new THREE.BoxGeometry(1.34, 0.02, 1.00), { pos: [T(0.95), 0.66, 0] });                 // bay floor (between the strut towers)
    frunkFloorP.add(new THREE.BoxGeometry(0.80, 0.02, 0.96), { pos: [T(0.62), 0.72, 0], sub: 1 });          // tub floor
  }
  // ===== greenhouse (door frames are cut in the shader) =====
  const glassP = P('greenhouse', 'GREENHOUSE', 'Long raked windscreen, door glass on a 1 220 mm belt', 'shell');
  {
    // the greenhouse stops at the foot of the windscreen lip; forward of that the cowl tray takes over
    // (it used to run on to x = 0.985, where the section is a 4 mm sliver sunk inside the body shell)
    // dense head so the tuck at the ring's foot (upperSec) lofts smoothly instead of as one step
    const xs = [...linspace(COWL_X0, 0.70, 0.012), ...linspace(0.688, T(4.49), 0.03)];
    glassP.add(loft(xs.map(x => ({ x, pts: upperSec(x) }))), { cut: true });
    glassP.anchor = new THREE.Vector3(0.55, ZROOF(0.55) + 0.005, -0.2); glassP.anchorN = new THREE.Vector3(0.7, 0.7, 0);
  }
  const roofP = P('roofGlass', 'PANORAMIC GLASS ROOF', 'Fixed black glass panel with four flush accessory ports', 'shell');
  {
    // opening runs from just behind the windscreen header to close to the rear header, and the frame
    // rails ride the full shoulder curve (cTR→top, top→sideL) out to the roof rails — a 60-90 mm frame
    const GLASS_FRONT_X = 0.15, GLASS_REAR_X = -1.88;
    roofP.add(patchX(upperSec, [J.cTR, J.top], stations(GLASS_FRONT_X, GLASS_REAR_X, 0.04), 0.003));
    roofP.add(patchX(upperSec, [J.top + 20, J.sideL], stations(GLASS_FRONT_X, GLASS_REAR_X, 0.04), 0.003));
    roofP.add(patchSection(upperSec, GLASS_FRONT_X, 0.006, J.cTR, J.sideL, 0.003));   // front edge cap
    roofP.add(patchSection(upperSec, GLASS_REAR_X, 0.006, J.cTR, J.sideL, 0.003));    // rear edge cap
    // The accessory covers sit on the crowned shoulder, below the centreline.
    // Drape their vertices over the same section as the roof so the whole cover
    // stays seated as the roof curves, with its top 1 mm above the 3 mm roof skin.
    const roofY = (x, z) => {
      const sec = upperSec(x);
      for (let j = J.cTR; j < J.sideL; j++) {
        const a = sec[j], b = sec[j + 1];
        if (a[0] >= z && z >= b[0] && a[0] !== b[0]) {
          return a[1] + (b[1] - a[1]) * (z - a[0]) / (b[0] - a[0]);
        }
      }
      throw new Error('Roof accessory cover lies outside the roof section');
    };
    for (const xt of [2.80, 4.10]) for (const sgn of [1, -1]) {
      const cover = rbox(0.06, 0.008, 0.06, 0.012, 2);
      const vertices = cover.getAttribute('position');
      for (let i = 0; i < vertices.count; i++) {
        const x = T(xt) + vertices.getX(i), z = sgn * 0.66 + vertices.getZ(i);
        vertices.setXYZ(i, x, roofY(x, z) + vertices.getY(i), z);
      }
      vertices.needsUpdate = true;
      cover.computeVertexNormals();
      roofP.add(cover, { sub: 1 });
    }
    roofP.add(rbox(0.02, 0.014, 0.08, 0.005, 2), { pos: [T(4.495), ZROOF(T(4.495)) - 0.02, 0], sub: 2 });   // CHMSL
    roofP.add(rbox(0.12, 0.03, 1.46, 0.012, 2), { pos: [T(4.44), ZROOF(T(4.44)) - 0.030, 0], sub: 3 });     // spoiler lip (under the roofline)
    roofP.anchor = new THREE.Vector3(T(3.2), ZROOF(T(3.2)) + 0.006, -0.35); roofP.anchorN = new THREE.Vector3(0, 1, -0.2);
  }
  // pillars & glazing surrounds that belong to the body (doors carry their own frames)
  const pillP = P('pillars', 'PILLARS & SURROUNDS', 'Black A pillars, B pillars, body-colour C pillar, drip rail', 'shell');
  {
    const GLASS_X0 = 1.00; // windscreen glass starts at the cowl (official drawing); the tray is the strip ahead of it
    const GLASS_BASE_Y = 1.201, HEADER_X = 0.10;
    const yDoor = (x) => Math.min(1.60, Math.max(CUT.beltY, CUT.beltY + (CUT.frontGlassX1 - x) / CUT.aSlope));
    // lower edge of the black A-pillar band: the door-glass line (capped at the DLO top so it runs into the roof band),
    // then rising from the mirror base to the glass-base corner so the cowl side stays body colour
    const ySail = ySailAt;
    const sideRange = (sgn) => sgn > 0 ? [J.sideR, J.cTR + 3] : [J.cTL + 5, J.sideL + 17];
    // ONE surround. The whole side of the greenhouse from the belt up over the roof rail, from the
    // cowl to the rear-glass split, built as a single grid per side and cut by the very same window
    // apertures as the greenhouse beneath it. The A, B, C and D pillars are therefore not separate
    // pieces that have to be made to meet — they are what is left of one surface after the windows
    // are removed, so they cannot mis-register or leave slivers.
    const surround = (sgn) => colGrid(upperSec, stations(COWL_X0, T(4.49), 0.025),
      () => (sgn > 0 ? J.cTR + 1 : J.cTL + 7), () => (sgn > 0 ? J.cBR + 2 : J.cBL + 5), 16, 0.004);
    pillP.add(surround(1), { cut: true }); pillP.add(surround(-1), { cut: true });
    // quarter glass sits in its own aperture, inset so it reads as glazing rather than a hole
    // bottom index is the surround's OWN bottom, not a height lookup: searching for CUT.beltY landed
    // 15 mm high and left a see-through slot along the whole quarter. Below the belt the body skin is
    // uncut back here (the door aperture stops at the rearShut rake), so the glass tucks in behind it.
    const quarter = (sgn) => colGrid(upperSec, stations(CUT.quarterX1 + 0.005, CUT.quarterX0 - 0.005, 0.02),
      () => (sgn > 0 ? J.cTR + 2 : J.cTL + 6), () => (sgn > 0 ? J.cBR + 2 : J.cBL + 5), 10, -0.002);
    pillP.add(quarter(1), { sub: 5 }); pillP.add(quarter(-1), { sub: 5 });
    // cowl tray: one black panel from the windscreen lip forward to the hood's rear edge, plus the
    // vertical lip itself (the cap on the greenhouse's front ring) so the glass base lands on something
    pillP.add(cowlTray(), { sub: 3 });
    pillP.add(cowlSkirt(1), { sub: 3 }); pillP.add(cowlSkirt(-1), { sub: 3 });
    pillP.add(capFromLoop(upperSec(COWL_X0), COWL_X0, +1), { sub: 3 });
    pillP.add(patchSection(upperSec, HEADER_X, 0.025, J.cTR + 6, J.cTL + 2));                // windscreen header (top surface only)
    // wipers: pivot boss in the cowl trough, arm, blade — every point sits on the tray surface, so
    // nothing overhangs the hood or ends in free air the way the two bare sticks did
    const layBar = (p0, p1, w, h, r, sub) => {
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2], L = Math.hypot(dx, dy, dz);
      pillP.add(rbox(L, h, w, r, 2), {
        pos: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2],
        rot: [0, Math.atan2(-dz, dx), Math.asin(clamp(dy / L, -1, 1))], sub,
      });
    };
    const onCowl = (x, z, lift) => [x, cowlYat(x, z) + lift, z];
    for (const sgn of [1, -1]) {
      const pv = onCowl(1.062, sgn * 0.585, 0.004);
      pillP.add(new THREE.CylinderGeometry(0.020, 0.020, 0.018, 16), { pos: [pv[0], pv[1] + 0.005, pv[2]], sub: 2 });    // pivot boss
      layBar(onCowl(1.062, sgn * 0.585, 0.015), onCowl(1.012, sgn * 0.315, 0.014), 0.020, 0.011, 0.005, 2);              // arm
      layBar(onCowl(1.024, sgn * 0.410, 0.008), onCowl(0.976, sgn * 0.045, 0.008), 0.015, 0.010, 0.004, 2);              // blade
    }
    // B pillars taper upward — ~1.7x wider at the belt than at the roof rail (with the black frame surrounds)

  }
  // ===== doors (skin + window frame + card, hinged at the leading edge; mirrors ride the front doors) =====
  const doors = [];
  const doorDefs = [
    ['doorFL', -1, CUT.frontX0, 0.71, 'FRONT LEFT DOOR', true], ['doorFR', 1, CUT.frontX0, 0.71, 'FRONT RIGHT DOOR', true],
    ['doorRL', -1, -1.243, CUT.rearX1, 'REAR LEFT DOOR', false], ['doorRR', 1, -1.243, CUT.rearX1, 'REAR RIGHT DOOR', false],
  ];
  const aSlope = CUT.aSlope, glassX1 = CUT.frontGlassX1, beltY = CUT.beltY;
  for (const [name, sgn, xa, xb, label, front] of doorDefs) {
    const dp = P(name, label, front ? 'Front door with door-mounted mirror, flush handle, framed glass' : 'Rear door, framed glass, flush handle', 'shell');
    const hw = HWT(xb) - 0.01;
    dp.hinge = new THREE.Vector3(xb, 0, sgn * hw);
    dp.group.position.copy(dp.hinge);
    const xs = stations(xa - 0.003, xb + 0.003, 0.03);
    const gxa = front ? CUT.frontGlassX0 : CUT.rearGlassX0, gxb = front ? xb : CUT.rearGlassX1;
    const xsG = stations(gxa + 0.004, gxb - 0.004, 0.03);
    const lowerJ = sgn > 0 ? [jRockTop, J.cTR + 4] : [J.cTL + 4, jRockTopL];
    const jsL = []; for (let j = Math.ceil(lowerJ[0]); j <= Math.floor(lowerJ[1]); j++) jsL.push(j); jsL.unshift(lowerJ[0]); jsL.push(lowerJ[1]);
    // rear door: trailing edge on the measured rake; front door: a straight edge, as on the car
    const shutAt = front ? () => xa - 0.003 : (y) => rakeX(y) - 0.003;
    dp.add(rebase(rakedPatch(lowerSec, jsL, shutAt, xb + 0.003, 26, 0.003), dp.hinge));            // skin
    // The glass runs down to the greenhouse ring's own floor (BELT_Y - 12 mm, i.e. upperSec's zb).
    // Any higher and the door skin's top edge does not reach it: at yGlass0 = beltY the two miss each
    // other by 12.8 mm and you see straight through the car along every window. Any lower is wasted --
    // rows under the floor clamp onto it and add nothing.
    const yGlass0 = beltY - 0.012;
    const ys = []; for (let r = 0; r < 15; r++) ys.push(yGlass0 + (DLO_TOP - yGlass0) * r / 14);
    const jr = sgn > 0 ? [J.cBR + 1, J.cTR + 3] : [J.cTL + 5, J.cBL + 7];
    // The upper panel spans the WHOLE door, not just the glazed opening: on a real door the window
    // frame is part of the door, and only the DLO is visible anyway because everything outside the
    // body's aperture is covered by the surround. Running it door-wide is what lets the aperture be
    // cut continuously through the belt -- the earlier alternative, leaving a band of body uncut
    // there, put a solid rail across both door openings that you could see the moment a door swung.
    // Offset 3 mm, one under the surround's 4 mm, so the two never fight where they overlap.
    const frame = front
      ? rowGrid(upperSec, ys, () => Math.min(xa, CUT.frontGlassX0) - 0.005, (y) => Math.min(xb + 0.005, Math.max(doorGlassX(y) + 0.005, gxa)), jr, 40, 0.003)
      : rowGrid(upperSec, ys, () => CUT.rearGlassX0, () => xb + 0.005, jr, 22, 0.003);
    dp.add(rebase(frame, dp.hinge), { sub: 1 });                                                  // window frame + glass
    // the rear door's own frame, aft of its glass: sub 7 so an ink line draws where the glass stops
    if (!front) dp.add(rebase(rowGrid(upperSec, ys, () => xa - 0.005, () => CUT.rearGlassX0, jr, 12, 0.003), dp.hinge), { sub: 7 });
    // crease and inner card both used to be laid out across the door's bounding x range, which is
    // only correct while the trailing edge is vertical. On the raked rear door that put the crease
    // 117 mm and the card 300 mm behind the skin, hanging in the wheel arch.
    const jc = sgn > 0 ? jCrease : jCreaseL;
    const creaseY = loopPoint(lowerSec((xa + xb) / 2), jc)[1];
    const xsC = stations(shutAt(creaseY), xb + 0.003, 0.03);
    dp.add(rebase(patchX(lowerSec, [jc - 0.04, jc + 0.04], xsC, 0.006), dp.hinge), { sub: 2 }); // crease
    // the card is a flat box, so it has to fit inside the skin at its LOWEST edge, where a raked
    // trailing edge is furthest forward
    const xaCard = shutAt(0.86 - 0.31) + 0.03;
    const len = xb - xaCard, mid = (xaCard + xb) / 2;
    dp.add(rbox(len - 0.06, 0.62, 0.035, 0.02, 2), { pos: [mid - dp.hinge.x, 0.86, sgn * (hw - 0.06) - dp.hinge.z], sub: 3 });   // inner door card
    dp.add(rbox(0.36, 0.06, 0.09, 0.02, 2), { pos: [mid - dp.hinge.x, 0.99, sgn * (hw - 0.11) - dp.hinge.z], sub: 4 });          // armrest
    const hx = front ? 0.10 : rakeX(1.03) + 0.15; const hp = onSkin(hx, 1.03, sgn, 0.007);   // 150 mm in from the trailing edge, as before
    dp.add(rbox(0.12, 0.03, 0.012, 0.01, 2), { pos: [hp[0] - dp.hinge.x, hp[1], hp[2] - dp.hinge.z], sub: 5 });                      // flush handle
    if (front) {
      // mirror: rooted on the sail panel above the belt (not floating on the door skin). The stalk
      // starts at the exact lateral position of the sail skin at its own height and runs out to the
      // housing's inboard face, so the two read as one bracket.
      const mx = 0.632, my = 1.222, mzOut = 1.033, mHalf = 0.0425;
      const mPts = upperSec(mx), mz = loopPoint(mPts, jExact(mPts, J.sideR, J.cTR, my))[0];
      const zRoot = mz - 0.008, zIn = mzOut - mHalf;
      dp.add(rbox(0.082, 0.050, zIn - zRoot + 0.020, 0.014, 2), { pos: [mx - dp.hinge.x, my, sgn * (zRoot + zIn) / 2 - dp.hinge.z], sub: 6 });
      dp.add(rbox(0.21, 0.125, 2 * mHalf, 0.03, 3), { pos: [mx - 0.030 - dp.hinge.x, my + 0.026, sgn * mzOut - dp.hinge.z], sub: 6 });
    }
    dp.explode.set(front ? 0.26 : -0.26, 1.50, sgn * 1.20);   // straight outboard, on the body shell's level
    doors.push({ part: dp, sgn, front });
  }
  // black lower cladding: sill shoe + arch trims (one continuous "shoe")
  const cladP = P('cladding', 'LOWER CLADDING', 'Black sill shoe, arch and bumper cladding — one continuous band', 'shell');
  {
    for (const sgn of [1, -1]) cladP.add(rbox(1.96, 0.21, 0.05, 0.02, 2), { pos: [T(2.32), 0.395, sgn * (HWB(T(2.32)) + 0.003)] });
    for (const xa of [S.XF, S.XR]) for (const sgn of [1, -1]) {
      const shape = new THREE.Shape();
      const ro = RA + 0.06, ri = RA + 0.004, zc = S.tireR, zclip = 0.29;
      const arc = (r, dir) => {
        const n = 48; const pts = [];
        for (let i = 0; i <= n; i++) {
          const ang = Math.PI * i / n;
          let px = Math.cos(ang), pz = Math.sin(ang);
          const q = Math.pow(Math.pow(Math.abs(px), ARCH_N) + Math.pow(Math.abs(pz), ARCH_N), 1 / ARCH_N);
          pts.push([px / q * r, zc + pz / q * r]);
        }
        if (dir < 0) pts.reverse();
        return pts;
      };
      const o = arc(ro, 1), inn = arc(ri, -1);
      shape.moveTo(o[0][0], Math.max(o[0][1], zclip));
      for (const p of o) shape.lineTo(p[0], Math.max(p[1], zclip));
      for (const p of inn) shape.lineTo(p[0], Math.max(p[1], zclip));
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 });
      const hw = HWB(xa) - 0.008;
      const m = cladP.add(g, { pos: [xa, 0, sgn > 0 ? hw : -hw - 0.022] });
      m.userData.subId = 1;
    }
  }
  // ===== front lamps & fascia =====
  const lampP = P('headlamps', 'STADIUM HEADLAMPS', 'Vertical LED “stadium” rings, 190 × 330 mm, three matrix modules', 'shell');
  {
    for (const sgn of [1, -1]) {
      lampP.add(rbox(0.035, 0.33, 0.19, 0.095, 4), { pos: [BODY_NOSE + 0.010, 0.875, sgn * 0.595] });
      lampP.add(rbox(0.012, 0.27, 0.13, 0.065, 4), { pos: [BODY_NOSE + 0.028, 0.875, sgn * 0.595], sub: 1 });
    }
    lampP.anchor = new THREE.Vector3(BODY_NOSE + 0.04, 0.875, -0.595); lampP.anchorN = new THREE.Vector3(1, 0, -0.3);
  }
  const barP = P('lightBar', 'FRONT LIGHT BAR', 'Edge-lit bar under the hood lip, wraps the corners', 'shell');
  {
    barP.add(rbox(0.03, 0.05, 1.72, 0.015, 2), { pos: [BODY_NOSE + 0.008, 0.995, 0] });
    for (const sgn of [1, -1]) barP.add(rbox(0.11, 0.05, 0.03, 0.012, 2), { pos: [BODY_NOSE - 0.06, 1.002, sgn * (HWT(BODY_NOSE - 0.06) + 0.004)], sub: 1 });
    barP.anchor = new THREE.Vector3(BODY_NOSE + 0.03, 1.005, 0.2); barP.anchorN = new THREE.Vector3(1, 0.2, 0);
  }
  const fasciaP = P('fasciaFront', 'FRONT FASCIA', 'Deep black bumper, intake slot, grey skid lip, tow-hook covers, radar', 'shell');
  {
    fasciaP.add(rbox(0.06, 0.34, 1.62, 0.04, 3), { pos: [BODY_NOSE - 0.012, 0.535, 0] });
    fasciaP.add(rbox(0.05, 0.07, 1.00, 0.015, 2), { pos: [BODY_NOSE + 0.005, 0.42, 0], sub: 1 });   // intake slot
    fasciaP.add(rbox(0.16, 0.06, 1.24, 0.015, 2), { pos: [BODY_NOSE - 0.17, 0.315, 0], sub: 2 });  // skid lip
    for (const sgn of [1, -1]) fasciaP.add(new THREE.BoxGeometry(0.008, 0.045, 0.11), { pos: [BODY_NOSE + 0.02, 0.60, sgn * 0.59], sub: 3 });
    fasciaP.add(new THREE.CylinderGeometry(0.016, 0.016, 0.01, 16), { pos: [BODY_NOSE + 0.022, 0.56, 0], rot: [0, 0, Math.PI / 2], sub: 4 });
  }
  // ===== rear: quarter pills on the body, liftgate carries the bar, glass, plate and lettering =====
  const pillsP = P('tailPills', 'REAR CORNER LAMPS', 'Horizontal stadium pills in a recess, body-colour brow above, vent below', 'shell');
  {
    const tailX = T(4.58), tailY = 1.115;
    // ONE bar: up each quarter, around both corners and across the tail, with the lit strip inside it
    // and a body-colour brow above. The corner "pills" are simply its ends.
    pillsP.add(wrapBand(T(4.46), BODY_TAIL, tailY, 0.090, 0.005, J.cTR + 8, 'ends'), { sub: 1 });  // recess
    pillsP.add(wrapBand(T(4.46), BODY_TAIL, tailY, 0.052, 0.011, J.cTR + 8, 'ends'));               // lit strip
    // brow height is keyed UNDER the section's own top at the tail, not set by a constant: the roll
    // pulls zt down to 1.178 there, and a brow at tailY + 0.068 = 1.183 sits above the bodywork, so
    // jAtHeight finds no such height, clamps to the top corner and returns a crossing 60 mm narrower
    // at each end than the lit strip below it. Invisible while the bands were buried; not any more.
    pillsP.add(wrapBand(T(4.46), BODY_TAIL, tailY + 0.050, 0.024, 0.014, J.cTR + 8, 'ends'), { sub: 2 });  // brow above
    for (const sgn of [1, -1]) {
      const vp = onSkin(tailX + 0.12, 0.62, sgn, 0.006);
      pillsP.add(rbox(0.16, 0.075, 0.010, 0.018, 2), { pos: vp, sub: 3 });                      // pressure-relief vent
    }
  }
  const fasciaRP = P('fasciaRear', 'REAR FASCIA', 'Black bumper band, grey skid, reflectors, hitch cover', 'shell');
  {
    fasciaRP.add(wrapBand(T(4.44), BODY_TAIL, 0.560, 0.235, 0.004, J.sideR + 17));                 // bumper band, wraps the corners
    fasciaRP.add(wrapBand(T(4.41), BODY_TAIL, 0.432, 0.070, 0.011, J.sideR + 17), { sub: 1 });     // grey skid under it
    for (const sgn of [1, -1]) fasciaRP.add(new THREE.BoxGeometry(0.008, 0.08, 0.03), { pos: [BODY_TAIL + 0.03, 0.62, sgn * 0.74], rot: [0, sgn * Math.PI / 4, 0], sub: 3 });
  }
  const gateP = P('tailgate', 'LIFTGATE & DROP GLASS', 'One-piece liftgate, top-hinged; powered rear window lowers into it', 'shell');
  {
    gateP.hinge = new THREE.Vector3(T(4.50), 1.665, 0);
    gateP.group.position.copy(gateP.hinge);
    gateP.add(rebase(capFromLoop(lowerSec(BODY_TAIL + 0.002), BODY_TAIL + 0.002, -1), gateP.hinge));
    const xs = stations(T(4.49), T(4.70), 0.015);
    gateP.add(rebase(loft(xs.map(x => ({ x, pts: upperSec(x) }))), gateP.hinge), { sub: 1 });
    gateP.add(rebase(capFromLoop(upperSec(T(4.70) - 0.001), T(4.70) - 0.001, -1), gateP.hinge), { sub: 1 });
    gateP.add(new THREE.BoxGeometry(0.012, 0.20, 0.36), { pos: [BODY_TAIL - 0.014 - gateP.hinge.x, 0.82 - gateP.hinge.y, 0], sub: 3 });   // licence plate
    gateP.add(new THREE.BoxGeometry(0.006, 0.06, 0.75), { pos: [BODY_TAIL - 0.013 - gateP.hinge.x, 0.96 - gateP.hinge.y, 0], sub: 4 });   // RIVIAN lettering plate
    gateP.add(rbox(0.008, 0.025, 0.065, 0.006, 2), { pos: [BODY_TAIL - 0.014 - gateP.hinge.x, 0.84 - gateP.hinge.y, -0.72], sub: 5 });    // R2 badge
    // the lamp bar across the tail belongs to the gate and swings with it. Subs 8-10 are free on this
    // part, so the glow test can pick out the lit strip without lighting the rest of the liftgate.
    const TY = 1.115;
    gateP.add(rebase(wrapBand(T(4.46), BODY_TAIL, TY, 0.090, 0.005, J.cTR + 8, 'cross'), gateP.hinge), { sub: 9 });
    gateP.add(rebase(wrapBand(T(4.46), BODY_TAIL, TY, 0.052, 0.011, J.cTR + 8, 'cross'), gateP.hinge), { sub: 8 });
    gateP.add(rebase(wrapBand(T(4.46), BODY_TAIL, TY + 0.050, 0.024, 0.014, J.cTR + 8, 'cross'), gateP.hinge), { sub: 10 });
    gateP.add(rbox(0.05, 0.40, 1.30, 0.03, 2), { pos: [BODY_TAIL + 0.05 - gateP.hinge.x, 0.95 - gateP.hinge.y, 0], sub: 6 });            // inner trim panel
    for (const sgn of [1, -1]) gateP.add(new THREE.BoxGeometry(0.004, 0.42, 0.05), { pos: [BODY_TAIL + 0.03 - gateP.hinge.x, 0.93 - gateP.hinge.y, sgn * 0.74], rot: [0, sgn * Math.PI / 4, 0], sub: 7 });
    gateP.anchor = new THREE.Vector3(T(4.58), ZROOF(T(4.58)) + 0.008, 0.05); gateP.anchorN = new THREE.Vector3(-0.75, 0.65, 0);
    gateP.explode.set(-0.95, 0.50, 0);
  }
  const cargoP = P('cargo', 'CARGO AREA', '813 L behind row two, flat floor, wheel-well trims', 'interior');
  {
    for (const sgn of [1, -1]) cargoP.add(rbox(0.70, 0.26, 0.24, 0.03, 2), { pos: [S.XR, 0.83, sgn * 0.60] });
    for (const sgn of [1, -1]) cargoP.add(rbox(0.98, 0.20, 0.03, 0.02, 2), { pos: [T(4.13), 0.80, sgn * 0.70], sub: 2 });   // low well trims, inside the load bay
  }
  const cargoFloorP = P('cargoFloor', 'CARGO FLOOR', 'Flat load floor over the rear skateboard', 'shell');
  cargoFloorP.add(new THREE.BoxGeometry(1.15, 0.02, 1.10), { pos: [T(4.13), 0.70, 0] });
  const portP = P('chargePort', 'CHARGE PORT', 'NACS inlet behind a hinged door on the left-rear quarter, 210 kW DC', 'shell');
  {
    const pp = onSkin(T(4.40), 0.82, -1, 0.007);
    portP.hinge = new THREE.Vector3(pp[0] + 0.075, 0, pp[2]);
    portP.group.position.copy(portP.hinge);
    portP.add(rbox(0.15, 0.17, 0.012, 0.03, 2), { pos: [pp[0] - portP.hinge.x, pp[1], 0] });
    portP.anchor = new THREE.Vector3(pp[0], pp[1], pp[2] - 0.012); portP.anchorN = new THREE.Vector3(-0.1, 0.1, -1);
    portP.anchorLocal = false;
  }
  const inletP = P('inlet', 'NACS INLET', 'NACS inlet in its recess: DC pins, AC pins, latch and ring light', 'interior');
  {
    const rp = onSkin(T(4.40), 0.82, -1, -0.032);                       // recessed pocket behind the door
    // pocket sits just inside the door's own outline so its rim cannot peek round the edge
    inletP.add(rbox(0.142, 0.162, 0.045, 0.018, 3), { pos: rp });
    const fp = [rp[0], rp[1], rp[2] + 0.018];                            // inlet face, sitting in the pocket
    inletP.add(rbox(0.104, 0.120, 0.016, 0.026, 4), { pos: fp, sub: 1 });
    // NACS: two big DC pins low, three small AC/signal pins in a row above them
    for (const dx of [-0.026, 0.026]) inletP.add(new THREE.CylinderGeometry(0.0115, 0.0115, 0.014, 14), { pos: [fp[0] + dx, fp[1] - 0.028, fp[2] - 0.004], rot: [Math.PI / 2, 0, 0], sub: 2 });
    for (const dx of [-0.030, 0, 0.030]) inletP.add(new THREE.CylinderGeometry(0.0058, 0.0058, 0.014, 12), { pos: [fp[0] + dx, fp[1] + 0.024, fp[2] - 0.004], rot: [Math.PI / 2, 0, 0], sub: 3 });
    inletP.add(rbox(0.020, 0.010, 0.010, 0.003, 2), { pos: [fp[0], fp[1] + 0.052, fp[2]], sub: 4 });                    // latch catch
    // Ring light around the inlet. It used to be rotated a quarter turn about Y, which stands a torus
    // whose axis is meant to point OUT of the car's flank on end instead -- so it reached 72 mm either
    // side in z from a centre 40 mm inside the skin and pushed 32 mm clean through the body panel,
    // visible with the charge-port door shut. A torus already lies in the XY plane with its axis along
    // z, which is the way this one faces, so it needs no rotation at all. Radius follows the inlet face
    // (104 x 120 mm) rather than the 144 mm it was, which nearly filled the 150 mm door.
    inletP.add(new THREE.TorusGeometry(0.058, 0.004, 10, 40), { pos: [fp[0], fp[1], fp[2] - 0.006], sub: 5 });  // ring light
  }

  // ===== interior =====
  const dashP = P('dash', 'INSTRUMENT PANEL', 'Full-width dash, driver display and 15.6 in centre screen', 'interior');
  {
    dashP.add(rbox(0.50, 0.30, 1.50, 0.05, 3), { pos: [0.72, 1.0, 0] });
    dashP.add(rbox(0.02, 0.12, 0.34, 0.01, 2), { pos: [0.50, 1.16, -0.40], rot: [0, 0, 0.35], sub: 1 });   // driver display
    dashP.add(rbox(0.02, 0.19, 0.40, 0.01, 2), { pos: [0.46, 1.14, 0.05], rot: [0, 0, 0.35], sub: 2 });    // centre screen
    dashP.add(rbox(0.55, 0.20, 0.34, 0.03, 2), { pos: [T(2.45), 0.72, 0], sub: 3 });                            // centre console
  }
  const swP = P('steeringWheel', 'STEERING WHEEL', 'Two-spoke wheel, steer-by-column, 2.6 turns lock to lock', 'interior');
  {
    // rim normal points up and toward the driver (rear); the column runs forward-down to the dash
    const RAKE = 0.45, hubX = 0.18, hubY = 1.08;
    swP.add(new THREE.TorusGeometry(0.18, 0.02, 10, 40), { pos: [hubX, hubY, -0.40], rot: [0, -Math.PI / 2, -RAKE, 'ZYX'] });
    swP.add(new THREE.BoxGeometry(0.03, 0.05, 0.30), { pos: [hubX, hubY, -0.40], rot: [0, 0, -RAKE], sub: 1 });                       // horizontal spoke
    swP.add(new THREE.CylinderGeometry(0.035, 0.035, 0.30, 12), { pos: [hubX + 0.15 * Math.cos(RAKE), hubY - 0.15 * Math.sin(RAKE), -0.40], rot: [0, 0, -(Math.PI / 2 + RAKE)], sub: 2 }); // column
  }
  const seatsP = P('seats', 'SEATING', 'Five seats, both rows fold flat', 'interior');
  {
    for (const sgn of [1, -1]) {
      seatsP.add(rbox(0.52, 0.20, 0.50, 0.05, 3), { pos: [T(2.45), 0.62, sgn * 0.40] });
      seatsP.add(rbox(0.13, 0.62, 0.50, 0.05, 3), { pos: [T(2.70), 0.98, sgn * 0.40], rot: [0, 0, 0.16], sub: 1 });
      seatsP.add(rbox(0.11, 0.15, 0.26, 0.04, 3), { pos: [T(2.70) - 0.050, 1.303, sgn * 0.40], rot: [0, 0, 0.16], sub: 2 });
    }
    seatsP.add(rbox(0.52, 0.20, 1.30, 0.05, 3), { pos: [T(3.27), 0.62, 0], sub: 3 });
    seatsP.add(rbox(0.13, 0.62, 1.30, 0.05, 3), { pos: [T(3.53), 0.98, 0], rot: [0, 0, 0.14], sub: 4 });
    for (const z of [0.42, 0, -0.42]) seatsP.add(rbox(0.11, 0.15, 0.26, 0.04, 3), { pos: [T(3.53) - 0.044, 1.303, z], rot: [0, 0, 0.14], sub: 5 });
  }
  const floorP = P('floor', 'CABIN FLOOR', 'Flat floor over the structural pack, sills', 'shell');
  {
    floorP.add(new THREE.BoxGeometry(2.55, 0.02, 1.62), { pos: [T(2.95), 0.43, 0] });
    for (const sgn of [1, -1]) floorP.add(rbox(1.90, 0.10, 0.14, 0.02, 2), { pos: [T(2.47), 0.49, sgn * 0.80], sub: 1 }); // sills
  }

  // ===== skateboard / chassis (attached to root, not the bobbing body) =====
  const batP = P('battery', 'STRUCTURAL BATTERY PACK', '4695 cells, 87.9 kWh usable, pack is a stressed floor member', 'chassis', root);
  {
    batP.add(rbox(2.10, 0.155, 1.56, 0.03, 3), { pos: [0, 0.322, 0] });
    for (const sx of [1, -1]) batP.add(rbox(0.40, 0.155, 1.26, 0.03, 2), { pos: [sx * 1.22, 0.322, 0], sub: 1 });
    batP.anchor = new THREE.Vector3(-0.2, 0.26, -0.78); batP.anchorN = new THREE.Vector3(0, -0.4, -1);
  }
  const batSeamP = P('batterySeams', 'PACK MODULES', 'Module bays and coolant manifolds', 'chassis', root);
  for (const x of [-0.875, -0.525, -0.175, 0.175, 0.525, 0.875]) batSeamP.add(new THREE.BoxGeometry(0.012, 0.01, 1.40), { pos: [x, 0.404, 0] });
  const subFP = P('subframeF', 'FRONT SUBFRAME', 'Cast aluminium cradle', 'chassis', root);
  {
    // open cradle: side rails plus front and rear crossmembers. It used to be one solid 0.90 x 1.20 slab
    // at hub height, so the half shafts and the drive unit necessarily passed straight through it.
    const xF = S.XF + 0.44, xR = S.XF - 0.40, zR = 0.545;
    for (const sgn of [1, -1]) subFP.add(rbox(0.86, 0.075, 0.095, 0.02, 2), { pos: [S.XF + 0.02, 0.44, sgn * zR] });          // side rails
    subFP.add(rbox(0.085, 0.070, 2 * zR, 0.02, 2), { pos: [xF, 0.44, 0], sub: 1 });                                            // front crossmember
    subFP.add(rbox(0.085, 0.070, 2 * zR, 0.02, 2), { pos: [xR, 0.44, 0], sub: 1 });                                            // rear crossmember
    for (const sgn of [1, -1]) for (const x of [xF - 0.02, xR + 0.02]) subFP.add(new THREE.CylinderGeometry(0.036, 0.036, 0.07, 14), { pos: [x, 0.475, sgn * zR], sub: 2 }); // body bushings
  }
  const duFP = P('driveUnitF', 'FRONT DRIVE UNIT', 'Rivian-built permanent-magnet motor, integrated inverter & reducer', 'chassis', root);
  {
    // Brief §4: a cylindrical motor barrel with a distinctly larger, squarer gearbox housing on one
    // side and the inverter as a separate raised box on top. Everything stays under the frunk bay
    // floor (y 0.65) and forward of it clears the steering rack at x 1.23.
    duFP.add(new THREE.CylinderGeometry(0.132, 0.132, 0.30, 32), { pos: [1.428, 0.440, -0.150], rot: [Math.PI / 2, 0, 0] });      // motor barrel
    duFP.add(new THREE.CylinderGeometry(0.140, 0.140, 0.026, 32), { pos: [1.428, 0.440, -0.288], rot: [Math.PI / 2, 0, 0], sub: 3 }); // end bell
    duFP.add(rbox(0.33, 0.30, 0.29, 0.02, 2), { pos: [1.428, 0.445, 0.165], sub: 1 });                                            // reducer / gearbox housing
    duFP.add(rbox(0.30, 0.10, 0.34, 0.015, 2), { pos: [1.415, 0.590, -0.060], sub: 2 });                                          // inverter, raised on the barrel
    duFP.add(rbox(0.07, 0.07, 0.11, 0.012, 2), { pos: [1.300, 0.596, 0.150], sub: 4 });                                           // HV terminal boss
    duFP.anchor = new THREE.Vector3(1.428, 0.37, -0.30); duFP.anchorN = new THREE.Vector3(0.3, -1, -0.6);
  }
  const subRP = P('subframeR', 'REAR SUBFRAME', 'Multi-link cradle', 'chassis', root);
  subRP.add(rbox(0.90, 0.08, 1.20, 0.02, 2), { pos: [S.XR - 0.02, 0.44, 0] });
  const duRP = P('driveUnitR', 'REAR DRIVE UNIT', 'Rear permanent-magnet motor, 336 kW combined (Premium)', 'chassis', root);
  {
    duRP.add(new THREE.CylinderGeometry(0.145, 0.145, 0.44, 32), { pos: [S.XR + 0.06, 0.51, 0], rot: [Math.PI / 2, 0, 0] });
    duRP.add(rbox(0.30, 0.14, 0.32, 0.02, 2), { pos: [S.XR + 0.10, 0.67, -0.06], sub: 1 });
    duRP.add(new THREE.CylinderGeometry(0.11, 0.11, 0.18, 24), { pos: [S.XR + 0.06, 0.51, -0.30], rot: [Math.PI / 2, 0, 0], sub: 2 });
  }
  const suspP = P('suspension', 'SUSPENSION', 'MacPherson struts in front, five stamped-steel links on an isolated rear subframe', 'chassis', root);
  const springP = P('springs', 'COIL SPRINGS & DAMPERS', 'Coil-over struts (front), separate coils and triple-tube dampers (rear)', 'chassis', root);
  const steerP = P('steering', 'STEERING RACK', 'Electric power steering, variable ratio', 'chassis', root);
  const shaftP = P('halfshafts', 'HALF SHAFTS', 'Equal-length half shafts', 'chassis', root);
  const arbP = P('antiRoll', 'ANTI-ROLL BARS', 'Mechanical anti-roll bars front and rear with drop links', 'chassis', root);
  {
    const bush = (pos) => suspP.add(new THREE.CylinderGeometry(0.028, 0.028, 0.06, 12), { pos, rot: [0, 0, Math.PI / 2], sub: 3 });
    const bushZ = (pos) => suspP.add(new THREE.CylinderGeometry(0.030, 0.030, 0.064, 12), { pos, rot: [Math.PI / 2, 0, 0], sub: 3 });
    const ball = (pos) => suspP.add(new THREE.SphereGeometry(0.026, 12, 8), { pos, sub: 4 });
    const link = (a, b, w = 0.034, h = 0.028) => suspP.addMesh(bar(a, b, w, h, white));
    // tapered sleeve along a→b: CV boots, spring seats, rack bellows, strut clamps
    const sleeve = (part, a, b, r0, r1, sub = 0) => {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
      const g = new THREE.CylinderGeometry(r1, r0, Math.max(1e-4, A.distanceTo(B)), 20); g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, white); m.position.copy(A).add(B).multiplyScalar(0.5); m.lookAt(B);
      part.addMesh(m); m.userData.subId = sub; return m;
    };
    // ---- front: MacPherson coil-over module (brief §4, the module photographed on the stand) ----
    // The strut threads a 200 mm slot between two walls: the tyre's inner sidewall plane at
    // |z| 0.6925, which only exists below the tyre crown at y 0.813, and the frunk tub's side wall
    // at |z| 0.48, which only exists up to y 1.02. So the spring is carried ABOVE the tyre crown,
    // where the outboard wall is gone, and the axis takes the shallow end of the brief's 8–12°
    // lean (8.6°): over the spring's 208 mm rise each extra degree of lean walks the coil ~4 mm
    // further inboard, straight into the tub wall, and has to come off the spring's diameter.
    const FA = [1.452, 0.470, 0.688], FB = [1.3951, 1.090, 0.5943];   // strut foot / head of the piston rod
    const fAx = (y, sgn) => { const t = (y - FA[1]) / (FB[1] - FA[1]); return [FA[0] + t * (FB[0] - FA[0]), y, sgn * (FA[2] + t * (FB[2] - FA[2]))]; };
    for (const sgn of [1, -1]) {
      const xa = S.XF;
      // lower arm: an L in plan — long lateral leg to the ball joint, forward leg to a second bushing
      const bj = [xa, 0.290, sgn * 0.700], bA = [xa - 0.040, 0.348, sgn * 0.285], bB = [xa + 0.327, 0.352, sgn * 0.470];
      link(bA, bj, 0.090, 0.034); link(bB, bj, 0.052, 0.030); bush(bA); bushZ(bB); ball(bj);
      link([bA[0], 0.436, bA[2]], bA, 0.052, 0.052); link([bB[0], 0.436, bB[2]], bB, 0.052, 0.052);  // drop brackets off the cradle
      // knuckle: upright from the ball joint up to the strut clamp, hub flange, rearward steering arm
      link(bj, fAx(0.506, sgn), 0.094, 0.078);
      suspP.add(new THREE.CylinderGeometry(0.062, 0.062, 0.084, 20), { pos: [xa, 0.4065, sgn * 0.686], rot: [Math.PI / 2, 0, 0], sub: 5 });
      const tie = [xa - 0.093, 0.478, sgn * 0.700];
      link([xa - 0.004, 0.444, sgn * 0.692], tie, 0.050, 0.040); ball(tie);
      // coil-over: fat damper tube, piston rod, dished perch, 6.5-coil spring, flat circular top mount
      springP.addMesh(bar(fAx(0.488, sgn), fAx(0.856, sgn), 0.052, 0.052, white));            // damper tube (foot sits above the cradle deck at y 0.48)
      springP.addMesh(bar(fAx(0.848, sgn), fAx(1.072, sgn), 0.034, 0.034, white));            // piston rod
      sleeve(suspP, fAx(0.490, sgn), fAx(0.556, sgn), 0.052, 0.052, 6);                       // knuckle-to-strut clamp
      sleeve(springP, fAx(0.830, sgn), fAx(0.848, sgn), 0.108, 0.100, 3);                     // lower spring perch, clear of the tyre crown at y 0.813
      // 218 mm OD. The brief reads the photo's spring as about a third of the wheel (271 mm), but that is
      // perspective: the springs sit nearer the camera than the discs. A coil that wide cannot pass inboard
      // of the tyre's inner sidewall at |z| 0.6925 without either a 19 degree strut lean or a tiny frunk.
      springP.add(helix(fAx(0.850, sgn), fAx(1.058, sgn), 0.095, 6.5, 0.014), { sub: 1 });    // main coil, 218 mm OD = 0.27 x wheel dia
      sleeve(springP, fAx(0.972, sgn), fAx(1.038, sgn), 0.056, 0.056, 4);                     // collar where the rod runs up through the tower
      sleeve(springP, fAx(1.058, sgn), fAx(1.074, sgn), 0.100, 0.110, 3);                     // upper seat
      sleeve(springP, fAx(1.074, sgn), fAx(1.096, sgn), 0.118, 0.118, 2);                     // flat circular top mount
      // half shaft with CV boots at both ends
      sleeve(shaftP, [1.420, 0.4065, sgn * 0.298], [1.424, 0.4065, sgn * 0.378], 0.064, 0.034, 1);
      shaftP.addMesh(bar([1.424, 0.4065, sgn * 0.378], [xa - 0.004, 0.4065, sgn * 0.616], 0.044, 0.044, white));
      sleeve(shaftP, [xa - 0.004, 0.4065, sgn * 0.616], [xa, 0.4065, sgn * 0.690], 0.032, 0.062, 1);
    }
    // steering: slim rack tube BEHIND the drive unit (x 1.205, clear of the barrel at x 1.296),
    // tie rods running outboard and slightly forward to the knuckles' steering arms
    steerP.add(new THREE.CylinderGeometry(0.026, 0.026, 0.80, 14), { pos: [1.205, 0.532, 0], rot: [Math.PI / 2, 0, 0] });
    steerP.add(rbox(0.11, 0.13, 0.13, 0.02, 2), { pos: [1.184, 0.578, -0.160], sub: 2 });     // EPS motor / pinion housing
    for (const sgn of [1, -1]) {
      sleeve(steerP, [1.205, 0.532, sgn * 0.312], [1.205, 0.532, sgn * 0.400], 0.044, 0.027, 1);   // bellows boot
      steerP.addMesh(bar([1.205, 0.528, sgn * 0.400], [1.375, 0.478, sgn * 0.700], 0.024, 0.024, white)); // tie rod
    }
    // ---- rear: five links per side, coil spring on the lower arm, inclined damper ----
    for (const sgn of [1, -1]) {
      const xa = S.XR, hub = (dx, y, z) => [xa + dx, y, sgn * z];
      const L = [
        [[xa + 0.06, 0.36, sgn * 0.30], hub(0.02, 0.33, 0.70), 0.09, 0.04],    // lower lateral arm (spring seat) — widened, load-bearing
        [[xa - 0.08, 0.62, sgn * 0.36], hub(-0.04, 0.60, 0.66), 0.03, 0.025],  // upper camber link
        [[xa + 0.38, 0.44, sgn * 0.60], hub(0.04, 0.44, 0.70), 0.036, 0.03],   // trailing arm to the body — pivot moved clear of the battery pack (S.XR+0.38)
        [[xa - 0.20, 0.40, sgn * 0.30], hub(-0.12, 0.40, 0.68), 0.03, 0.024],  // toe link
        [[xa - 0.16, 0.30, sgn * 0.32], hub(-0.10, 0.31, 0.66), 0.03, 0.026],  // lower rear lateral link
      ];
      for (const [a, b, w, h] of L) { link(a, b, w, h); bush(a); ball(b); }
      suspP.add(rbox(0.08, 0.36, 0.06, 0.015, 2), { pos: [xa, 0.47, sgn * 0.73], sub: 1 });                     // hub carrier
      springP.add(helix([xa + 0.05, 0.32, sgn * 0.50], [xa + 0.05, 0.66, sgn * 0.50], 0.07, 5.5, 0.009), { sub: 1 }); // coil on the lower arm — lowered clear of the cargo floor
      springP.add(new THREE.CylinderGeometry(0.045, 0.05, 0.015, 20), { pos: [xa + 0.05, 0.315, sgn * 0.50], sub: 3 }); // rear spring seat pan
      springP.addMesh(bar([xa - 0.10, 0.40, sgn * 0.62], [xa - 0.18, 0.82, sgn * 0.52], 0.045, 0.045, white));  // damper, inclined up into the wheelhouse tower
      shaftP.addMesh(bar([xa + 0.06, 0.51, sgn * 0.22], [xa, 0.42, sgn * 0.70], 0.04, 0.04, white));
    }
    // ---- anti-roll bars ----
    // front (brief §4): the bar runs across the FRONT face of the cradle at x 1.90, below it at
    // y 0.352 so it clears the subframe deck, ends bend rearward outboard of the cradle at |z| 0.638,
    // and vertical drop links rise to brackets clamped on the STRUT BODIES.
    {
      const xb = 1.900, yb = 0.352, ze = 0.672;
      arbP.add(new THREE.CylinderGeometry(0.017, 0.017, 2 * ze - 0.12, 12), { pos: [xb, yb, 0], rot: [Math.PI / 2, 0, 0] });
      for (const sgn of [1, -1]) {
        arbP.addMesh(bar([xb, yb, sgn * (ze - 0.076)], [xb, yb + 0.008, sgn * ze], 0.033, 0.033, white));      // end bend
        arbP.addMesh(bar([xb, yb + 0.008, sgn * ze], [1.470, yb + 0.020, sgn * ze], 0.030, 0.028, white));     // lever arm, swept rearward
        const br = fAx(0.700, sgn);
        arbP.addMesh(bar([1.470, 0.372, sgn * ze], [br[0] + 0.006, 0.694, br[2] + sgn * 0.012], 0.019, 0.019, white)); // drop link
        arbP.add(new THREE.CylinderGeometry(0.028, 0.028, 0.050, 12), { pos: [br[0] + 0.006, 0.700, br[2] + sgn * 0.006], rot: [Math.PI / 2, 0, 0], sub: 1 }); // bracket on the strut body
      }
    }
    // rear: transverse bar on the cradle with lever arms and drop links to the lower arms
    for (const [xb, xl, yl, zl] of [[S.XR - 0.32, S.XR - 0.12, 0.36, 0.58]]) {
      arbP.add(new THREE.CylinderGeometry(0.014, 0.014, 1.16, 10), { pos: [xb, 0.36, 0], rot: [Math.PI / 2, 0, 0] });
      for (const sgn of [1, -1]) {
        arbP.addMesh(bar([xb, 0.36, sgn * 0.58], [xl, yl, sgn * zl], 0.026, 0.026, white));
        arbP.addMesh(bar([xl, yl, sgn * zl], [xl, yl + 0.22, sgn * (zl + 0.02)], 0.016, 0.016, white));  // drop link
      }
    }
    suspP.anchor = new THREE.Vector3(S.XR, 0.95, -0.96); suspP.anchorN = new THREE.Vector3(0, 0.2, -1);
  }
  const brakeP = P('brakes', 'BRAKES', 'Ventilated discs, fixed calipers, regen-first', 'chassis', root);

  // ===== wheels =====
  const wheels = [];
  const r = S.tireR, hw = S.tireW / 2;
  const tireProfile = [[0.268, hw - 0.025], [0.33, hw], [0.375, hw], [r - 0.008, hw - 0.012], [r, hw - 0.030], [r, -(hw - 0.030)], [r - 0.008, -(hw - 0.012)], [0.375, -hw], [0.33, -hw], [0.268, -(hw - 0.025)]].map(p => new THREE.Vector2(p[0], p[1]));
  const tireGeo = new THREE.LatheGeometry(tireProfile, 60);
  const barrelGeo = new THREE.CylinderGeometry(S.rimR, S.rimR, 0.216, 40, 1, true);
  const wheelDefs = [['wheelFL', S.XF, -1, 'FRONT LEFT WHEEL'], ['wheelFR', S.XF, 1, 'FRONT RIGHT WHEEL'], ['wheelRL', S.XR, -1, 'REAR LEFT WHEEL'], ['wheelRR', S.XR, 1, 'REAR RIGHT WHEEL']];
  for (const [name, xa, sgn, label] of wheelDefs) {
    const wp = P(name, label, '20 in Bicolor Carbon alloy, 255/60 R20, 5×114.3 PCD', 'running', root);
    wp.group.position.set(xa, S.tireR, sgn * S.track / 2);
    wp.rest.copy(wp.group.position);
    const spin = new THREE.Group(); wp.group.add(spin);
    const face = new THREE.Group(); spin.add(face); if (sgn < 0) face.rotation.y = Math.PI;
    wp.add(tireGeo, { rot: [Math.PI / 2, 0, 0], parent: face });
    wp.add(barrelGeo, { rot: [Math.PI / 2, 0, 0], parent: face, sub: 1 });
    const ax = 0.085;
    wp.add(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 24), { pos: [0, 0, ax], rot: [Math.PI / 2, 0, 0], parent: face, sub: 2 });
    wp.add(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 20), { pos: [0, 0, ax + 0.03], rot: [Math.PI / 2, 0, 0], parent: face, sub: 3 });
    for (let k = 0; k < 5; k++) {
      const a = k * Math.PI * 2 / 5 + 0.3;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.085, 0.03), white);
      spoke.position.set(Math.cos(a) * 0.155, Math.sin(a) * 0.155, ax); spoke.rotation.z = a; wp.addMesh(spoke, face); spoke.userData.subId = 4;
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.008), white);
      const b = a + Math.PI / 5; pocket.position.set(Math.cos(b) * 0.19, Math.sin(b) * 0.19, ax - 0.012); pocket.rotation.z = b; wp.addMesh(pocket, face); pocket.userData.subId = 5;
      const lug = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.02, 8), white);
      lug.position.set(Math.cos(a + 0.628) * 0.057, Math.sin(a + 0.628) * 0.057, ax + 0.03); lug.rotation.x = Math.PI / 2; wp.addMesh(lug, face); lug.userData.subId = 6;
    }
    const hub = new THREE.Group(); wp.group.add(hub); if (sgn < 0) hub.rotation.y = Math.PI;
    // 352 mm vented disc with the caliper TRAILING (brief §4). The hub group is mirrored (rot y = π)
    // on the left, so the fore/aft offset and the tilt are negated there — without that the caliper
    // led the disc on the left and trailed it on the right.
    const mir = sgn < 0 ? -1 : 1;
    brakeP.add(new THREE.CylinderGeometry(0.176, 0.176, 0.032, 44), { pos: [0, 0, -0.02], rot: [Math.PI / 2, 0, 0], parent: hub });
    brakeP.add(new THREE.CylinderGeometry(0.1785, 0.1785, 0.009, 44), { pos: [0, 0, -0.02], rot: [Math.PI / 2, 0, 0], parent: hub, sub: 2 });  // vent gap on the disc edge
    brakeP.add(new THREE.CylinderGeometry(0.086, 0.086, 0.084, 24), { pos: [0, 0, -0.060], rot: [Math.PI / 2, 0, 0], parent: hub, sub: 3 });   // disc hat, reaching in to the hub flange
    brakeP.add(rbox(0.086, 0.155, 0.090, 0.014, 2), { pos: [-0.148 * mir, 0.056, -0.02], rot: [0, 0, -0.353 * mir], parent: hub, sub: 1 });    // caliper, trailing
    brakeP.add(rbox(0.030, 0.090, 0.104, 0.010, 2), { pos: [-0.108 * mir, 0.041, -0.02], rot: [0, 0, -0.353 * mir], parent: hub, sub: 4 });    // caliper carrier bracket
    wp.explode.set(0, 0.0, sgn * 0.85);   // straight outboard on the ground line; brakes ride the hub
    if (name === 'wheelFL') { wp.anchor = new THREE.Vector3(0, 0.02, -0.15); wp.anchorN = new THREE.Vector3(0, 0, -1); wp.anchorLocal = true; }
    wheels.push({ part: wp, spin, sgn, xa, front: xa > 0 });
  }

  // ===== rest positions, explode vectors =====
  for (const p of order) { if (!p.rest.lengthSq()) p.rest.copy(p.group.position); }
  const setExp = (names, v) => names.forEach(n => parts[n].explode.set(...v));
  // Vertical stack (bottom → top): pack down · running gear stays · interior barely lifted ·
  // body shell · greenhouse · roof glass. Every tier clears the one below it in y.
  setExp(['roofGlass'], [0, 2.05, 0]);
  setExp(['greenhouse', 'pillars'], [0, 1.78, 0]);
  setExp(['body', 'cladding', 'tailPills'], [0, 1.50, 0]);
  setExp(['chargePort'], [0, 1.50, -0.22]);                 // rides the body, door swings outboard
  // front stack: hood lifts forward-up over the nose, the three front plates cascade straight ahead
  setExp(['hood'], [0.65, 1.95, 0]);
  setExp(['headlamps'], [0.85, 1.72, 0]);
  setExp(['lightBar'], [1.25, 2.18, 0]);
  setExp(['fasciaFront'], [1.70, 1.25, 0]);
  // rear stack: liftgate swings back and up, rear fascia straight back beneath it
  setExp(['fasciaRear'], [-0.45, 1.50, 0]);
  // interior lifts just clear of the skateboard; the frunk tub slides forward with it
  setExp(['dash', 'steeringWheel', 'seats', 'floor', 'cargo', 'cargoFloor', 'inlet'], [0, 0.14, 0]);
  setExp(['frunk', 'frunkFloor'], [0.15, 0.70, 0]);
  // skateboard: pack drops, the two cradles pull fore and aft so they clear the pack in plan
  setExp(['battery', 'batterySeams'], [0, -0.24, 0]);
  setExp(['subframeF'], [0.55, -0.26, 0]);
  setExp(['subframeR'], [-0.55, -0.26, 0]);
  setExp(['antiRoll'], [0, -0.16, 0]);

  const shellNames = order.filter(p => p.category === 'shell').map(p => p.name);
  const pickables = []; for (const p of order) pickables.push(...p.meshes);
  const lampIds = [parts.headlamps.id, parts.lightBar.id];
  const tailIds = [parts.tailPills.id, parts.tailgate.id];   // see isTail in blueprint.js for the sub tests

  const V = {
    root, body, parts, order, wheels, doors, pickables, lampIds, tailIds, shellNames, SPEC: S, dissolve, hidden,
    explodeT: 0, openT: 0, panelsT: 1, spinAngle: 0, steer: 0, bob: 0, ride: 0,
    guideAnchors: {
      roofGlass: [-1.15, ZROOF(-1.15) + 0.006, 0.34], greenhouse: [-0.55, 1.42, 0.82],
      hood: [1.7 - hoodP.hinge.x, ZT(1.7) + 0.01 - hoodP.hinge.y, 0], tailgate: [BODY_TAIL + 0.02 - gateP.hinge.x, 0.95 - gateP.hinge.y, 0],
      body: [0.0, 0.7, 0.93], battery: [0.4, 0.32, 0.0], wheelFL: [0, 0, 0], wheelRL: [0, 0, 0], wheelFR: [0, 0, 0], wheelRR: [0, 0, 0],
      doorFL: [-0.55, 0.9, 0], doorFR: [-0.55, 0.9, 0], doorRL: [-0.35, 0.9, 0], doorRR: [-0.35, 0.9, 0],
      headlamps: [BODY_NOSE, 0.875, 0.595], lightBar: [BODY_NOSE + 0.008, 0.995, -0.55], fasciaFront: [BODY_NOSE - 0.02, 0.535, 0.55],
      fasciaRear: [BODY_TAIL, 0.52, -0.50], seats: [T(2.45), 0.8, 0.4], frunk: [1.69, 1.00, -0.45],
      subframeF: [S.XF + 0.02, 0.44, 0.50], subframeR: [S.XR - 0.02, 0.44, -0.50],
    },
    update(dt, st) {
      const omega = st.speed / 3.6 / S.tireR;
      this.spinAngle -= omega * dt;
      for (const w of this.wheels) { w.spin.rotation.z = this.spinAngle; w.part.group.rotation.y = w.front ? st.steer * Math.PI / 180 : 0; }
      const t = st.time;
      const runB = st.run ? Math.sin(t * 1.7) * 0.004 + Math.sin(t * 2.9) * 0.002 : 0;
      const driveB = st.drive ? Math.sin(t * 6.3) * 0.010 + Math.sin(t * 9.1) * 0.006 : 0;
      this.bob = runB + driveB;
      this.body.position.y = this.bob; this.body.rotation.z = st.drive ? Math.sin(t * 2.2) * 0.006 : 0; this.body.rotation.x = st.drive ? Math.sin(t * 3.1) * 0.004 : 0;
      for (const w of this.wheels) { const wob = st.drive ? Math.sin(t * 7.7 + w.sgn * 1.3 + (w.front ? 0 : 2.1)) * 0.008 : 0; w.part.group.position.y = w.part.rest.y + wob + (w.part.explode.y * this.explodeT); }
      for (const p of this.order) {
        // the isolation check comes FIRST: running parts return early below, so a check placed after
        // that branch could never hide a wheel, and every ?only= capture silently kept all four
        if (this.hidden.has(p.name)) p.group.visible = false;
        else if (p.category !== 'shell') p.group.visible = true;
        if (p.category === 'running') { p.group.position.z = p.rest.z + p.explode.z * this.explodeT; continue; }
        p.group.position.set(p.rest.x + p.explode.x * this.explodeT, p.rest.y + p.explode.y * this.explodeT, p.rest.z + p.explode.z * this.explodeT);
        if (p.category === 'shell' && !this.hidden.has(p.name)) p.group.visible = this.panelsT > 0.001;
      }
      dissolve.value = this.panelsT;
      // OPEN: hood, liftgate, four doors and the charge-port door
      const o = this.openT;
      this.parts.hood.group.rotation.z = o * 0.95;
      this.parts.tailgate.group.rotation.z = -o * 1.30;
      for (const d of this.doors) d.part.group.rotation.y = d.sgn * o * (d.front ? 1.10 : 1.25);
      this.parts.chargePort.group.rotation.y = -o * 1.5;
    },
  };
  return V;
}
