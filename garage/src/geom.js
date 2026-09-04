// Geometry helpers: monotone interpolation, rounded-rectangle section loops,
// lofting sections into smooth surfaces, surface ribbons (seams / pillars), caps.
import * as THREE from 'three';

// Monotone cubic (Fritsch–Carlson) interpolation of [[x,v],...] sorted by x.
export function interp(pts) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const n = xs.length, ms = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) ms[i] = (ys[1] - ys[0]) / (xs[1] - xs[0]);
    else if (i === n - 1) ms[i] = (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2]);
    else {
      const d0 = (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1]);
      const d1 = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
      ms[i] = (d0 * d1 <= 0) ? 0 : (d0 + d1) / 2;
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const d = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    if (d === 0) { ms[i] = 0; ms[i + 1] = 0; continue; }
    const a = ms[i] / d, b = ms[i + 1] / d, s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); ms[i] = t * a * d; ms[i + 1] = t * b * d; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (i < n - 2 && xs[i + 1] < x) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * ms[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * ms[i + 1];
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeInOut = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// Fixed segment layout for section loops so every section has the same point count.
export const J = { bottomR: 0, cBR: 8, sideR: 16, cTR: 34, top: 42, cTL: 62, sideL: 70, cBL: 88, bottomL: 96, N: 104 };
const SEG = [8, 8, 18, 8, 20, 8, 18, 8, 8];

function quad(p0, c, p1, n, out) {
  for (let k = 0; k < n; k++) {
    const t = k / n, u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]);
  }
}
function line(p0, p1, n, out) {
  for (let k = 0; k < n; k++) { const t = k / n; out.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]); }
}

// Rounded rectangle-ish loop in (lat, up) space. Bottom half-width hwB, top half-width hwT,
// bottom z zb, top z zt, corner radii rb/rt, side bulge (m). Clockwise as seen from +x.
export function roundedLoop({ hwB, hwT, zb, zt, rb, rt, bulge = 0 }) {
  const out = [];
  const h = zt - zb;
  rb = Math.min(rb, h * 0.45, hwB * 0.9); rt = Math.min(rt, h * 0.45, hwT * 0.9);
  const sideMid = (l) => [l * ((hwB + hwT) / 2 + bulge), (zb + rb + zt - rt) / 2];
  line([0, zb], [hwB - rb, zb], SEG[0], out);
  quad([hwB - rb, zb], [hwB, zb], [hwB, zb + rb], SEG[1], out);
  quad([hwB, zb + rb], sideMid(1), [hwT, zt - rt], SEG[2], out);
  quad([hwT, zt - rt], [hwT, zt], [hwT - rt, zt], SEG[3], out);
  line([hwT - rt, zt], [-(hwT - rt), zt], SEG[4], out);
  quad([-(hwT - rt), zt], [-hwT, zt], [-hwT, zt - rt], SEG[5], out);
  quad([-hwT, zt - rt], sideMid(-1), [-hwB, zb + rb], SEG[6], out);
  quad([-hwB, zb + rb], [-hwB, zb], [-(hwB - rb), zb], SEG[7], out);
  line([-(hwB - rb), zb], [0, zb], SEG[8], out);
  return out;
}

export function loopPoint(pts, jf) {
  const N = pts.length;
  const j0 = Math.floor(jf), t = jf - j0;
  const a = pts[((j0 % N) + N) % N], b = pts[(((j0 + 1) % N) + N) % N];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function loopNormal(pts, jf) {
  const N = pts.length;
  const a = loopPoint(pts, jf - 1), b = loopPoint(pts, jf + 1), p = loopPoint(pts, jf);
  let tx = b[0] - a[0], ty = b[1] - a[1];
  const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
  let nx = ty, ny = -tx;
  let cx = 0, cy = 0; for (const q of pts) { cx += q[0]; cy += q[1]; } cx /= N; cy /= N;
  if ((p[0] - cx) * nx + (p[1] - cy) * ny < 0) { nx = -nx; ny = -ny; }
  return [nx, ny];
}

// Loft sections [{x, pts:[[lat,up],...]}] into a BufferGeometry. closed: loop wraps.
export function loft(sections, { closed = true, flip = false } = {}) {
  const S = sections.length, N = sections[0].pts.length;
  const pos = new Float32Array(S * N * 3);
  for (let i = 0; i < S; i++) {
    const s = sections[i];
    for (let j = 0; j < N; j++) { const k = (i * N + j) * 3; pos[k] = s.x; pos[k + 1] = s.pts[j][1]; pos[k + 2] = s.pts[j][0]; }
  }
  const idx = [];
  const M = closed ? N : N - 1;
  for (let i = 0; i < S - 1; i++) for (let j = 0; j < M; j++) {
    const j1 = (j + 1) % N;
    const a = i * N + j, b = i * N + j1, c = (i + 1) * N + j1, d = (i + 1) * N + j;
    idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (closed) {
    // orient outward: topmost vertex of the middle section must have normal.y > 0
    const i = Math.floor(S / 2); let best = 0, bj = 0;
    for (let j = 0; j < N; j++) { const y = pos[(i * N + j) * 3 + 1]; if (y > best) { best = y; bj = j; } }
    const ny = g.attributes.normal.getY(i * N + bj);
    if ((ny < 0) !== flip) { reverseIndex(g); g.computeVertexNormals(); }
  } else if (flip) { reverseIndex(g); g.computeVertexNormals(); }
  return g;
}

function reverseIndex(g) {
  const a = g.index.array;
  for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
  g.index.needsUpdate = true;
}

// Flat cap at x from a loop; normal along +x (sign=1) or -x.
export function capFromLoop(pts, x, sign = 1) {
  const v2 = pts.map(p => new THREE.Vector2(p[0], p[1]));
  const tris = THREE.ShapeUtils.triangulateShape(v2, []);
  const pos = new Float32Array(pts.length * 3);
  for (let j = 0; j < pts.length; j++) { pos[j * 3] = x; pos[j * 3 + 1] = pts[j][1]; pos[j * 3 + 2] = pts[j][0]; }
  const idx = []; for (const t of tris) idx.push(t[0], t[1], t[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  if (Math.sign(g.attributes.normal.getX(0)) !== sign) { reverseIndex(g); g.computeVertexNormals(); }
  return g;
}

// Surface patch following a section function along x, restricted to a list of loop indices, pushed outward by off.
export function patchX(secFn, jList, xs, off = 0.004) {
  const sections = xs.map(x => {
    const pts = secFn(x);
    return { x, pts: jList.map(j => { const p = loopPoint(pts, j), n = loopNormal(pts, j); return [p[0] + n[0] * off, p[1] + n[1] * off]; }) };
  });
  return loft(sections, { closed: false });
}

// Band across a section at x (width 2*halfW along x) over indices jFrom..jTo (fractional ok).
export function patchSection(secFn, x, halfW, jFrom, jTo, off = 0.004, step = 1) {
  const js = []; for (let j = jFrom; j <= jTo + 1e-6; j += step) js.push(j);
  if (js[js.length - 1] < jTo) js.push(jTo);
  return patchX(secFn, js, [x - halfW, x + halfW], off);
}

export function linspace(a, b, step) {
  const out = []; const n = Math.max(1, Math.round(Math.abs(b - a) / step));
  for (let i = 0; i <= n; i++) out.push(a + (b - a) * i / n);
  return out;
}

// Box aligned from p0 to p1 with cross-section w x h.
export function bar(p0, p1, w, h, mat) {
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1);
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, h, len);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.lookAt(b);
  return m;
}

export function helix(p0, p1, radius, turns, tube = 0.008, segs = 160) {
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1);
  const axis = b.clone().sub(a); const len = axis.length(); axis.normalize();
  const u = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(axis, u).normalize();
  const e2 = new THREE.Vector3().crossVectors(axis, e1).normalize();
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, ang = t * turns * Math.PI * 2;
    pts.push(a.clone().addScaledVector(axis, t * len).addScaledVector(e1, Math.cos(ang) * radius).addScaledVector(e2, Math.sin(ang) * radius));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, segs, tube, 6, false);
}

// GLSL that discards body-shell fragments inside the door, frunk and liftgate apertures.
// p is model space (x forward, y up, z lateral). Numbers are baked in from vehicle.js so both the
// beauty material and the G-buffer material cut identically.
export function cutGLSL(C) {
  const f = (v) => Number(v).toFixed(4);
  return `
bool inAperture(vec3 p){
  float az = abs(p.z);
  // doors: lower skins between the rocker top and the belt, upper frames up to the roof band. The
  // aperture runs CONTINUOUSLY from the rocker to the roof band -- it is a door opening, and a band
  // of body left uncut anywhere inside it is a bar across the doorway once the door swings.
  if (az > ${f(C.doorZ)} && p.y > ${f(C.doorY0)} && p.y < ${f(C.doorY1)}) {
    bool lower = p.y < ${f(C.beltY)};
    {
    float qf = ${f(C.quarterY0[0][1])}${C.quarterY0.slice(0, -1).map((k, i) => {
      const n = C.quarterY0[i + 1], m = (n[1] - k[1]) / (n[0] - k[0]);
      return `\n             + ${f(m)} * clamp(p.x - ${f(k[0])}, 0.0, ${f(n[0] - k[0])})`;
    }).join('')};
    // the rear door's trailing shut line rakes with height, so it is a ramp, not a constant
    float rs = ${f(C.rearShut[0][1])}${C.rearShut.slice(0, -1).map((k, i) => {
      const n = C.rearShut[i + 1], m = (n[1] - k[1]) / (n[0] - k[0]);
      return `\n             + ${f(m)} * clamp(p.y - ${f(k[0])}, 0.0, ${f(n[0] - k[0])})`;
    }).join('')};
    bool rear = lower ? (p.x > rs && p.x < ${f(C.rearX1)}) : (p.x > ${f(C.rearFrameX0)} && p.x < ${f(C.rearGlassX1)});
    bool quarter = !lower && p.y > qf && p.x > ${f(C.quarterX0)} && p.x < ${f(C.quarterX1)};
    if (quarter) return true;
    float xg = p.y >= ${f(C.sailY)} ? (${f(C.qa)} + ${f(C.qb)} * p.y + ${f(C.qc)} * p.y * p.y) : ${f(C.frontGlassX1)} - (p.y - ${f(C.beltY)}) * ${f(C.sailSlope)};
    float xmax = lower ? ${f(C.frontX1)} : min(${f(C.frontX1)}, xg);
    bool front = p.x > (lower ? ${f(C.frontX0)} : ${f(C.frontGlassX0)}) && p.x < xmax;
    if (rear || front) return true;
    }
  }
  // cabin: no deck across the tub at belt height and no floor under the glasshouse (closed-loft artifacts)
  float dc = ${f(C.deckCeil[0][1])}${C.deckCeil.slice(0, -1).map((k, i) => {
    const n = C.deckCeil[i + 1], m = (n[1] - k[1]) / (n[0] - k[0]);
    return `\n           + ${f(m)} * clamp(p.x - ${f(k[0])}, 0.0, ${f(n[0] - k[0])})`;
  }).join('')};
  if (p.x > ${f(C.deckX0)} && p.x < ${f(C.deckX1)} && az < ${f(C.deckZ)} && p.y > ${f(C.deckY0)} && p.y < min(${f(C.deckY1)}, dc)) return true;
  // frunk: the body top under the hood. The boundary is the hood's OWN outer edge, sampled from the
  // same section curves and emitted as a piecewise-linear ramp sum, so the shut line lands on the
  // fender shoulder along its whole length instead of drifting away from a straight cut.
  float hy = ${f(C.hoodEdge[0][1])}${C.hoodEdge.slice(0, -1).map((k, i) => {
    const n = C.hoodEdge[i + 1], m = (n[1] - k[1]) / (n[0] - k[0]);
    return `\n           + ${f(m)} * clamp(p.x - ${f(k[0])}, 0.0, ${f(n[0] - k[0])})`;
  }).join('')};
  if (p.x > ${f(C.hoodX0)} && p.x < ${f(C.hoodX1)} && p.y > hy && az < ${f(C.hoodZ)}) return true;
  return false;
}`;
}
