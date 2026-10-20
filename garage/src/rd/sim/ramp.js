// Synced from roadster-lab 233f7ab (src/sim/ramp.js) by tools/sync-garage.mjs.
// Edit it in the lab and re-sync; a hand edit here makes the next sync refuse.
// The wall-ride ramp as a curve in the vertical plane.
//
// A profile is a polyline of [x, y] metres (x along the run, y up) from the flat
// approach to the lip. Everything the car needs is a function of arc length s:
// position, pitch θ (tangent angle from horizontal, past 90° once it overhangs),
// curvature κ = dθ/ds, and the inverse altitude → s, which is single-valued as
// long as the ramp stops before 180°.

/**
 * The ramp as measured from the run-2 HUD (same numbers as
 * reference/catalog/ramp.json `segments`, kept here so shipped code does not read
 * the reference folder). Surface profile in the vertical plane: x along the run,
 * y up, origin at the foot of the curl.
 */
export const MEASURED_RAMP = {
  width_m: 3.2,
  height_m: 21.56,
  segments: {
    lower_arc: { radius_m: 8.943, from_deg: 0, to_deg: 90, centre_m: [0.0, 8.943] },
    upper_arc: { radius_m: 10.711, from_deg: 90, to_deg: 170, centre_m: [-1.768, 8.943] },
    overhang_straight: { angle_deg: 170, length_m: 11.9, length_range_m: [10.1, 14.3], tip_m: [-11.627, 21.557] },
    car_reference_offset_m: 0.5,
  },
};

/** Dense measured profile with a flat run-in (see profileFromSegments). */
export function measuredProfile(opts = {}) { return profileFromSegments(MEASURED_RAMP.segments, opts); }

/** Smooth a polyline by resampling it with a centripetal Catmull–Rom spline. */
function catmull(points, perSpan = 12) {
  const out = [];
  const P = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < perSpan; k++) {
      const t = k / perSpan, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Split every polyline segment longer than `maxSeg` into equal pieces. Catmull–Rom
 * misbehaves when neighbouring spans differ a lot in length (a 40 m run-in next to
 * a 0.8 m arc step makes the spline loop back on itself), so long straights are cut
 * to about the length of their neighbours first. Collinear points stay collinear.
 */
export function densify(profile, maxSeg = 0.8) {
  const out = [[...profile[0]]];
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxSeg));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/**
 * The measured ramp rebuilt exactly from its segments (reference/catalog/ramp.json
 * `segments`): a flat run-in of `runIn` metres, the lower arc, the upper arc and the
 * overhang straight, sampled every `step` metres. With `step` ≤ 0.1 m the chord
 * error on the 8.94 m arc is under 0.2 mm, so use it with `{ smooth: false }`.
 */
export function profileFromSegments(seg, { runIn = 40, step = 0.1, overhang } = {}) {
  const lo = seg.lower_arc, up = seg.upper_arc, st = seg.overhang_straight;
  const pts = [];
  const nIn = Math.max(1, Math.round(runIn / step));
  for (let i = 0; i < nIn; i++) pts.push([lo.centre_m[0] - runIn + (runIn * i) / nIn, 0]);
  const arc = (c, r, a0, a1) => {
    const n = Math.max(2, Math.ceil((r * Math.abs(a1 - a0) * Math.PI) / 180 / step));
    for (let i = 0; i < n; i++) {
      const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
      pts.push([c[0] + r * Math.sin(a), c[1] - r * Math.cos(a)]);
    }
  };
  arc(lo.centre_m, lo.radius_m, lo.from_deg, lo.to_deg);
  arc(up.centre_m, up.radius_m, up.from_deg, up.to_deg);
  const a = (st.angle_deg * Math.PI) / 180;
  const e = (up.to_deg * Math.PI) / 180;
  const p0 = [up.centre_m[0] + up.radius_m * Math.sin(e), up.centre_m[1] - up.radius_m * Math.cos(e)];
  const len = overhang ?? st.length_m;
  const n = Math.max(1, Math.ceil(len / step));
  for (let i = 0; i <= n; i++) pts.push([p0[0] + Math.cos(a) * (len * i) / n, p0[1] + Math.sin(a) * (len * i) / n]);
  return pts;
}

export function makeRamp(profile, { smooth = true, perSpan = 12 } = {}) {
  const pts = smooth ? catmull(profile, perSpan) : profile.map((p) => [...p]);
  const n = pts.length;
  const s = new Float64Array(n), th = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  // Tangent angle, unwrapped so it can run continuously past 90° and 180°.
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (i > 0) { while (ang - th[i - 1] > Math.PI) ang -= 2 * Math.PI; while (ang - th[i - 1] < -Math.PI) ang += 2 * Math.PI; }
    th[i] = ang;
  }
  const length = s[n - 1];

  function seg(sq) {
    const v = Math.min(length, Math.max(0, sq));
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid] <= v) lo = mid; else hi = mid; }
    const t = s[hi] > s[lo] ? (v - s[lo]) / (s[hi] - s[lo]) : 0;
    return { lo, hi, t };
  }

  const ramp = {
    points: pts,
    length,
    height: Math.max(...pts.map((p) => p[1])),
    /** [x, y] at arc length s. */
    at(sq) { const { lo, hi, t } = seg(sq); return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t]; },
    /** Pitch in radians at arc length s (0 = flat, π/2 = vertical, > π/2 = overhang). */
    pitch(sq) { const { lo, hi, t } = seg(sq); return th[lo] + (th[hi] - th[lo]) * t; },
    /** Curvature dθ/ds (1/m), positive where the ramp curls upward. */
    curvature(sq) {
      const h = Math.max(0.25, length / 400);
      const a = Math.max(0, sq - h), b = Math.min(length, sq + h);
      return b > a ? (ramp.pitch(b) - ramp.pitch(a)) / (b - a) : 0;
    },
    /** Inward surface normal (toward the centre of curvature) at s. */
    normal(sq) { const p = ramp.pitch(sq); return [-Math.sin(p), Math.cos(p)]; },
    /** Unit tangent (direction of travel) at s. */
    tangent(sq) { const p = ramp.pitch(sq); return [Math.cos(p), Math.sin(p)]; },
    /** Arc length of the foot of the curl: where the profile first reaches x = 0 (the convention for every profile here). */
    get sFoot() {
      for (let i = 1; i < n; i++) if (pts[i][0] >= 0) { const u = (0 - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0] || 1); return s[i - 1] + (s[i] - s[i - 1]) * u; }
      return 0;
    },
    /** Smallest s at which the ramp reaches altitude y (m). */
    sAtAltitude(y) {
      if (y <= pts[0][1]) return 0;
      for (let i = 1; i < n; i++) {
        if (pts[i][1] >= y) {
          const t = (y - pts[i - 1][1]) / (pts[i][1] - pts[i - 1][1] || 1);
          return s[i - 1] + (s[i] - s[i - 1]) * t;
        }
      }
      return length;
    },
    /** Arc length where the pitch first reaches `deg`. */
    sAtPitch(deg) {
      const r = (deg * Math.PI) / 180;
      for (let i = 1; i < n; i++) if (th[i] >= r) return s[i - 1] + (s[i] - s[i - 1]) * ((r - th[i - 1]) / (th[i] - th[i - 1] || 1));
      return length;
    },
  };
  return ramp;
}

/**
 * A stand-in profile until the measured one is in: flat approach, a radius-R1
 * arc to vertical, a vertical straight, then a radius-R2 curl to the lip at
 * `apexDeg`. Height = R1 + straight + R2·(-cos apex) ≈ 21 m (69 ft) by default.
 */
export function placeholderProfile({ approach = 40, r1 = 8, straight = 4, r2 = 9.2, apexDeg = 170 } = {}) {
  const pts = [];
  for (let x = -approach; x < 0; x += 2) pts.push([x, 0]);
  for (let a = 0; a <= 90; a += 3) { const r = (a * Math.PI) / 180; pts.push([r1 * Math.sin(r), r1 * (1 - Math.cos(r))]); }
  const top = pts[pts.length - 1];
  for (let k = 1; k <= 3; k++) pts.push([top[0], top[1] + (straight * k) / 3]);
  // Second arc: centre r2 behind the wall at the top of the straight.
  const cx = top[0] - r2, cy = top[1] + straight;
  for (let a = 93; a <= apexDeg + 1e-9; a += 3) { const r = (a * Math.PI) / 180; pts.push([cx + r2 * Math.sin(r), cy - r2 * Math.cos(r)]); }
  return pts;
}
