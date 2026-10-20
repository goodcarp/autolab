// Synced from roadster-lab 233f7ab (src/fx/util.js) by tools/sync-garage.mjs.
// Edit it in the lab and re-sync; a hand edit here makes the next sync refuse.
// Small deterministic helpers shared by the scene, the effects and the run.
// Nothing here touches the DOM, so tests can import it under plain node.

/** Integer hash → [0, 1). Same input, same output, on every machine. */
export function hash01(n) {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Hash of two integers (e.g. emitter, index) → [0, 1). */
export function hash2(a, b) { return hash01(Math.imul(a | 0, 0x27d4eb2d) ^ (b | 0)); }

/** mulberry32: a seeded generator for building static things (textures, layouts). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, u) => a + (b - a) * u;
export function smoothstep(a, b, x) { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); }
export function smootherstep(a, b, x) { const u = clamp((x - a) / (b - a), 0, 1); return u * u * u * (u * (6 * u - 15) + 10); }

/** A soft on/off pulse: 0 before t0, 1 between t0 + ramp and t1 - ramp, 0 after t1. */
export function pulse(t, t0, t1, ramp = 0.05) {
  return smoothstep(t0, t0 + ramp, t) * (1 - smoothstep(t1 - ramp, t1, t));
}

/**
 * Monotone cubic interpolation (Fritsch–Carlson) through knots [[x, y], ...] with
 * strictly increasing x. Returns f(x) clamped at the ends, plus f.d(x) (slope) and
 * f.knots. It never overshoots between knots, so a monotone run stays monotone.
 * `endSlopes` = [d0, dN] pins the end slopes (e.g. 0 to start or stop at rest).
 */
export function pchip(knots, { endSlopes } = {}) {
  const n = knots.length;
  const xs = knots.map((k) => k[0]), ys = knots.map((k) => k[1]);
  const h = [], dl = [];
  for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); dl.push((ys[i + 1] - ys[i]) / h[i]); }
  const m = new Array(n).fill(0);
  if (n === 2) { m[0] = m[1] = dl[0]; }
  else if (n > 2) {
    for (let i = 1; i < n - 1; i++) {
      if (dl[i - 1] * dl[i] <= 0) m[i] = 0;
      else {
        const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
        m[i] = (w1 + w2) / (w1 / dl[i - 1] + w2 / dl[i]);
      }
    }
    const end = (h0, h1, d0, d1) => {
      let d = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
      if (Math.sign(d) !== Math.sign(d0)) d = 0;
      else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(d) > Math.abs(3 * d0)) d = 3 * d0;
      return d;
    };
    m[0] = end(h[0], h[1], dl[0], dl[1]);
    m[n - 1] = end(h[n - 2], h[n - 3], dl[n - 2], dl[n - 3]);
  }
  if (endSlopes) { if (endSlopes[0] != null) m[0] = endSlopes[0]; if (endSlopes[1] != null) m[n - 1] = endSlopes[1]; }
  function seg(x) {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    return lo;
  }
  function f(x) {
    if (n === 1) return ys[0];
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    const i = seg(x), hh = h[i], u = (x - xs[i]) / hh, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * hh * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * hh * m[i + 1];
  }
  f.d = function (x) {
    if (n === 1 || x < xs[0] || x > xs[n - 1]) return 0;
    const i = Math.min(n - 2, seg(x)), hh = h[i], u = (x - xs[i]) / hh, u2 = u * u;
    return ((6 * u2 - 6 * u) * ys[i] + (3 * u2 - 4 * u + 1) * hh * m[i] + (-6 * u2 + 6 * u) * ys[i + 1] + (3 * u2 - 2 * u) * hh * m[i + 1]) / hh;
  };
  f.knots = knots;
  f.x0 = xs[0];
  f.x1 = xs[n - 1];
  return f;
}

/**
 * Value noise in 2D on an integer lattice, smooth, seeded, range [0, 1]. With
 * `period` > 0 the lattice wraps every `period` cells, so the noise tiles exactly.
 */
export function valueNoise2(x, y, seed = 0, period = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (i) => (period > 0 ? ((i % period) + period) % period : i);
  const h = (i, j) => hash01(Math.imul(w(i), 0x1f1f1f1f) ^ Math.imul(w(j), 0x5bd1e995) ^ Math.imul(seed + 1, 0x68e31da4));
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal value noise, `oct` octaves. With `period` (cells at the base octave) it tiles exactly. */
export function fbm2(x, y, { oct = 4, seed = 0, period = 0 } = {}) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    s += amp * valueNoise2(x * f, y * f, seed + o * 17, period ? period * f : 0);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}
