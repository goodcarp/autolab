// Synced from roadster-lab 3360319 (src/drive/math.js) by tools/sync-garage.mjs.
// Edit it in the lab and re-sync; a hand edit here makes the next sync refuse.
// Small vector and quaternion helpers for the drive physics.
//
// Plain arrays, no three.js: vectors are [x, y, z], quaternions are [x, y, z, w]
// (the same order three.js uses, so a renderer can copy them straight in), and a
// rotation matrix is 9 numbers, row-major. Everything returns a new array.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
/** a + b·s */
export const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export function normalize(a) {
  const l = length(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** Rotation of `angle` radians about the unit `axis`. */
export function quatAxisAngle(axis, angle) {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/** a·b: apply b first, then a. */
export function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function quatNormalize(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** Turn q by the world-frame angular velocity w (rad/s) over dt, then renormalise. */
export function quatIntegrate(q, w, dt) {
  const h = dt / 2;
  const d = quatMul([w[0], w[1], w[2], 0], q);
  return quatNormalize([q[0] + d[0] * h, q[1] + d[1] * h, q[2] + d[2] * h, q[3] + d[3] * h]);
}

/** Rotation matrix (row-major) of a unit quaternion. */
export function quatToMat(q) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ];
}

/** M·v (car frame to world). */
export const matVec = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
/** Mᵀ·v (world to car frame). */
export const matTVec = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];

/** Unit quaternion of a rotation matrix (row-major), w ≥ 0. */
export function quatFromMat(m) {
  const t = m[0] + m[4] + m[8];
  let q;
  if (t > 0) { const s = 2 * Math.sqrt(t + 1); q = [(m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s, s / 4]; }
  else if (m[0] > m[4] && m[0] > m[8]) { const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]); q = [s / 4, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s]; }
  else if (m[4] > m[8]) { const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]); q = [(m[1] + m[3]) / s, s / 4, (m[5] + m[7]) / s, (m[2] - m[6]) / s]; }
  else { const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]); q = [(m[2] + m[6]) / s, (m[5] + m[7]) / s, s / 4, (m[3] - m[1]) / s]; }
  q = quatNormalize(q);
  return q[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q;
}
