// Synced from roadster-lab d92328a (src/roadster/vehicle.js) by tools/sync-garage.mjs.
// Edit it in the lab and re-sync; a hand edit here makes the next sync refuse.
// The Roadster, generated in code.
//
// One analytic body surface S(x, u). At every station x the half-section is a
// chain of eight key points, u = 0..7, from the floor centre round the side to
// the top centre:
//
//   u0 floor centre      u1 floor edge        u2 sill bottom corner
//   u3 lower crease (top of the black sill band)
//   u4 shoulder: the widest line (door crease; over the front wheel, where the
//      fender starts to roll in toward its ridge; along the haunch, its outer edge)
//   u5 belt (side-glass base); ahead of the A-pillar the fender RIDGE; behind the
//      quarter glass the inner edge of the haunch top
//   u6 roof rail and rear-glass edge; ahead of the A-pillar root the windscreen
//      corner and then the HOOD CREASE
//   u7 centre top: hood, windscreen, roof, rear glass, wing
//
// Each key point's height and half-width is a curve of x (the curve layer below,
// read by the AutoLab 3D Creation Engine as source text). Panels are patches of
// the one surface between two u values and two shut lines (x as a function of
// u), so neighbouring panels line up by construction; where they are separate
// parts a real gap opens along the shut line, over a dark channel. Every integer
// u is a crease, sharp except the shoulder (u4) and the fender ridge (u5), which
// are rounded over a narrow strip. The front end in u5..u7 is: hood (u6..u7, a flat trapezoid
// narrowing toward the windscreen), hood crease, the fender's inner facet
// (u5..u6, carrying the triangular lamp pocket at the corner), the ridge (u5).
//
// Frame (same as r2-blueprint, so the engine measures both alike): x forward,
// y up, z to the car's right, metres, ground at y = 0, origin at the wheelbase
// midpoint. Sources for every figure: docs/RESEARCH-specs.md, -exterior.md,
// docs/REFERENCE-fit.md (measured profiles), and the plan/front readings noted
// at each curve.
import * as THREE from 'three';
import { interp, tyreGeometry, merge, gridMesh, prism } from './geom.js';

export const SPEC = {
  id: 'roadster',
  label: 'Roadster (2026 reveal)',
  wheelbase: 2.825,       // Tesla executives, Top Gear video (second-hand)
  // Measured by this lab (docs/REFERENCE-fit.md): axle-calibrated, perspective-corrected.
  frontOverhang: 0.868,   // to the splitter tip (2.282); x-ray plan 0.839, side 0.870, +-35 mm
  rearOverhang: 0.689,    // to the deck lip / lamp band (-2.101); x-ray 0.701, +-25 mm
  height: 1.148,          // roof peak at x = 0.03, +-15 mm
  width: 1.953,           // body at the rear haunch (aerial at the x-ray scale), +70/-35 mm
  widthMirrors: 2.005,    // overall = over the rear tyres; no mirrors, the tyres stand proud
  trackF: 1.679,          // underside render, +-10 mm
  trackR: 1.670,
  groundClearance: 0.150, // sill bottom between the wheels, +-20 mm
  tireRF: 0.3425, tireWF: 0.295,   // 295/30R20
  tireRR: 0.3672, tireWR: 0.335,   // 335/30R21
  mass: 1700,             // kg, "just under" (executives)
};
const S = SPEC;
S.XF = S.wheelbase / 2;
S.XR = -S.wheelbase / 2;
S.NOSE = S.XF + S.frontOverhang;
S.TAIL = S.XR - S.rearOverhang;
S.length = S.NOSE - S.TAIL;
S.track = (S.trackF + S.trackR) / 2;
S.tireR = S.tireRF;
const T = (xt) => S.NOSE - xt;

// ---------- curve layer (one line each; read as text by the Creation Engine) ----------
// Knots from reference/profiles/roadster-stations.json (every 0.1 m, axle-calibrated).
// Centre top: deck lip, rear glass, roof peak at x = 0, windscreen down to the cowl at 1.570 (aerial),
// then the hood: a plane at 0.752 -> 0.684 at its shut line (front photo, perspective-corrected),
// rolling down over its last 0.1 m to the light-bar edge at the nose (side outline from x 2.13 on).
const ZC = interp([[S.TAIL, 0.863], [-1.900, 0.863], [-1.800, 0.874], [-1.600, 0.919], [-1.400, 0.967], [-1.200, 1.011], [-1.000, 1.049], [-0.800, 1.082], [-0.600, 1.110], [-0.400, 1.129], [-0.200, 1.143], [0.000, 1.148], [0.200, 1.142], [0.400, 1.111], [0.600, 1.061], [0.800, 1.006], [1.000, 0.945], [1.200, 0.882], [1.300, 0.849], [1.400, 0.813], [1.500, 0.778], [1.570, 0.752], [1.760, 0.694], [2.000, 0.624], [2.100, 0.594], [2.200, 0.545], [S.NOSE - 0.010, 0.501]]);
// u6 half-width, one nearly straight line in plan (aerial): rear-glass edge (0.26 at -1.79, 0.454 at -1.13,
// 0.48 at -0.69), roof rail between the door's roof glass and its side glass (0.506 at -0.49, 0.612 at 0.43), A-pillar to its root (1.330, 0.795), the windscreen's
// corner diagonal down to the hood crease (1.560, 0.474), then the hood crease to the front corner
// (2.164, 0.591). Aerial at 9 mm/px: crease 0.472 / 0.540 / 0.591 at x 1.558 / 1.938 / 2.164.
const HWR = interp([[S.TAIL, 0.720], [-1.900, 0.420], [-1.775, 0.264], [-1.500, 0.345], [-1.130, 0.454], [-0.690, 0.480], [-0.490, 0.506], [0.000, 0.570], [0.430, 0.612], [0.900, 0.700], [1.200, 0.760], [1.330, 0.795], [1.450, 0.650], [1.560, 0.474], [1.750, 0.490], [1.940, 0.540], [2.164, 0.591], [S.NOSE - 0.010, 0.591]]);
// u5 height: the sail's outer crease (from the quarter-glass tip straight down to the tail corner), belt, A-pillar root; ahead of it the fender ridge,
// which is the side outline down to x 2.1 and then drops to the front corner at the hood-crease height.
const ZU = interp([[S.TAIL, 0.852], [-1.850, 0.857], [-1.700, 0.882], [-1.300, 0.920], [-1.000, 0.950], [-0.800, 0.930], [-0.600, 0.908], [-0.400, 0.888], [-0.200, 0.866], [0.000, 0.848], [0.200, 0.830], [0.400, 0.811], [0.550, 0.801], [0.700, 0.806], [0.900, 0.818], [1.100, 0.827], [1.250, 0.832], [1.400, 0.832], [1.520, 0.824], [1.700, 0.786], [1.900, 0.709], [2.000, 0.660], [2.100, 0.605], [2.164, 0.505]]);
// u5 half-width: the quarter glass narrows in plan to its tip (aerial: 0.706 at -0.69, tip at -1.02),
// the belt is widest mid-cabin (0.835) and narrows to the A-pillar root; then the ridge (aerial:
// 0.85 at 1.3..1.6, 0.80 at 1.7, 0.72 at 1.9, 0.64 at 2.1) to the front corner.
const HWU = interp([[S.TAIL, 0.830], [-1.850, 0.782], [-1.600, 0.728], [-1.300, 0.664], [-1.000, 0.600], [-0.800, 0.672], [-0.600, 0.735], [-0.400, 0.767], [-0.200, 0.793], [0.000, 0.813], [0.200, 0.826], [0.400, 0.833], [0.900, 0.833], [1.100, 0.824], [1.250, 0.815], [1.400, 0.840], [1.600, 0.830], [1.700, 0.800], [1.800, 0.770], [1.900, 0.722], [2.000, 0.680], [2.100, 0.640], [2.164, 0.594]]);
// u4: the shoulder crease, the wedge line from the camera pod (0.855, 0.705) to the haunch; over the
// front wheel it stays just above the arch, then falls to the front corner.
const ZSH = interp([[S.TAIL, 0.850], [-1.700, 0.863], [-1.400, 0.867], [-1.000, 0.856], [-0.600, 0.830], [-0.300, 0.805], [0.000, 0.778], [0.300, 0.751], [0.600, 0.723], [0.855, 0.705], [1.000, 0.716], [1.150, 0.732], [1.650, 0.732], [1.800, 0.695], [1.950, 0.620], [2.164, 0.480]]);
// u4 half-width: the plan outline (aerial), into the front corner.
const HWSH = interp([[S.TAIL, 0.838], [-2.000, 0.852], [-1.900, 0.888], [-1.800, 0.921], [-1.700, 0.948], [-1.550, 0.971], [-1.300, 0.970], [-1.100, 0.957], [-0.900, 0.941], [-0.600, 0.926], [0.000, 0.930], [0.900, 0.935], [1.200, 0.952], [1.450, 0.952], [1.600, 0.942], [1.700, 0.915], [1.800, 0.863], [1.900, 0.801], [2.000, 0.734], [2.100, 0.664], [2.164, 0.600]]);
// u3: lower crease, top of the black sill band; taller toward the rear, where the carbon behind the
// rear wheel reaches up to the end plate's lower corner (side frame: 0.64 at x -1.80..-1.88, 0.68 at -1.95).
const ZL = interp([[S.TAIL, 0.680], [-1.850, 0.640], [S.XR, 0.440], [-1.000, 0.414], [-0.800, 0.384], [-0.600, 0.353], [-0.400, 0.324], [-0.200, 0.307], [0.000, 0.300], [0.400, 0.287], [0.800, 0.277], [1.000, 0.270], [S.XF, 0.275], [1.900, 0.285], [2.164, 0.280]]);
const HWL = interp([[S.TAIL, 0.820], [S.XR, 0.950], [-0.600, 0.915], [0.000, 0.920], [S.XF, 0.935], [1.900, 0.788], [2.164, 0.598]]);
// u2/u1/u0: sill and floor; the splitter sits low at the front. Between the axles the sill corner is a
// straight line in plan (underside footage).
const ZB = interp([[S.TAIL, 0.220], [-1.900, 0.194], [-1.800, 0.163], [S.XR, 0.150], [0.000, 0.150], [S.XF, 0.150], [1.700, 0.157], [1.900, 0.145], [2.100, 0.176], [S.NOSE - 0.010, 0.195]]);
const HWB = interp([[S.TAIL, 0.780], [S.XR, 0.905], [0.000, 0.895], [S.XF, 0.885], [1.900, 0.758], [2.164, 0.596]]);
// Crown of the canopy between the rail and the centre (computed: derived from ZC).
const ZR = interp(Array.from({ length: 241 }, (_, i) => S.TAIL + (i / 240) * (S.NOSE - 0.005 - S.TAIL)).map((x) => [x, ZC(x) - crown(x)]));

function crown(x) {
  // Hood: flat across; over its last 0.16 m it rolls down so the front edge (the
  // light bar) runs level at the corner height while the centre rounds over.
  if (x > 1.57) return 0.003 + 0.070 * smooth(2.0, 2.164, x);
  // Windscreen: crowned across the cabin, flat at the base, where its corner
  // line runs at the hood's height out to the A-pillar root. The crown eases out
  // over 0.6 m: over 0.15 m (1.15 to 1.30) the corner line rose while the centre
  // fell, a saddle at the A-pillar root.
  const wind = 0.040 + Math.max(0, x - 0.34) * 0.025;
  if (x > 0.34) return wind + (0.004 - wind) * smooth(0.80, 1.38, x);
  // Rear glass: flatter than the roof.
  if (x > -1.775) return 0.040 + (0.012 - 0.040) * smooth(-0.3, -0.8, x);
  return 0.020;                               // wing top
}

function smooth(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- the surface ----------
const ARCH_GAP = 0.035;
function archLift(x) {
  // Height of the wheel-arch edge above the ground at x (0 outside the arches).
  let y = 0;
  for (const [xa, r] of [[S.XF, S.tireRF], [S.XR, S.tireRR]]) {
    const ra = r + ARCH_GAP, dx = x - xa;
    if (Math.abs(dx) < ra) y = Math.max(y, r + Math.sqrt(ra * ra - dx * dx));
  }
  return y;
}

/** The eight key points of the +z half-section at x, as [z, y]. */
export function keyPoints(x) {
  const lift = archLift(x);
  const zsh = ZSH(x), zu = Math.max(ZU(x), zsh + 0.004);
  const zl = Math.min(Math.max(ZL(x), lift > 0 ? lift + 0.012 : 0), zsh - 0.012);
  const zb = ZB(x);
  const sill = Math.min(Math.max(zb + 0.035, lift), zl - 0.008);
  const floorEdge = Math.min(Math.max(zb, lift), sill);
  const zc = ZC(x), zr = Math.min(ZR(x), zc - 0.002);
  // 1 in the cabin, 0 over the hood and the deck, eased over 0.1 m at each end (a switch
  // left a 9 mm step in the rail across the rear glass at x -1.70).
  const cabin = smooth(-1.75, -1.62, x) * smooth(1.36, 1.26, x);
  const hwu = Math.min(HWU(x), HWSH(x) - 0.004);
  return [
    [0, zb],
    [HWB(x) - 0.07, floorEdge],
    [HWB(x), sill],
    [HWL(x), zl],
    [HWSH(x), zsh],
    [hwu, zu],
    // In the cabin the glass rises from the belt to the rail to the roof, so each point
    // must sit above the last. Over the hood and the deck the centre is lower than the
    // fender ridge and the haunch, legitimately: no ordering is forced there.
    [Math.min(HWR(x), hwu - lerp(0.002, 0.02, cabin)), lerp(zr, Math.max(zr, zu + 0.01), cabin)],
    [0, lerp(zc, Math.max(zc, zu + 0.012), cabin)],
  ];
}

// Outward bulge (m) of each segment between key points, by x region (smooth in x:
// a step in a bulge would be a step in the skin).
function bulge(k, x) {
  switch (k) {
    case 2: return 0.006;                                                     // sill band
    case 3: return lerp(0.008, 0.010, smooth(1.2, 0.8, x)) * (1 - 0.75 * smooth(1.85, 2.05, x));  // body side: a slightly curved door; flat wedge faces at the front corners
    case 4: return lerp(0.004, 0.007, smooth(0.95, 1.25, x)) * (1 - 0.5 * smooth(1.85, 2.05, x));  // shoulder top; rolled over the front wheel
    case 5: return 0.010 * smooth(1.42, 1.02, x) * smooth(-1.3, -0.9, x);     // side glass; flat fender facet and sails
    default: return 0;                                                        // the top segment is a dome (see surface)
  }
}

// surface() is asked for the same stations over and over (normals, offsets, panels that share an
// edge): it keeps the key points of the last few thousand. keyPoints is pure, so this changes no
// number, and the build stays deterministic.
const KP = new Map();
function keyPointsAt(x) {
  let K = KP.get(x);
  if (!K) {
    if (KP.size > 20000) KP.clear();
    K = keyPoints(x);
    KP.set(x, K);
  }
  return K;
}

/** Point on the body surface: x, and u in [0, 7]. Returns [z, y] on the +z side. */
export function surface(x, u) {
  const K = keyPointsAt(x);
  const k = Math.min(6, Math.max(0, Math.floor(u)));
  const s = Math.min(1, Math.max(0, u - k));
  const [z0, y0] = K[k], [z1, y1] = K[k + 1];
  let z = z0 + (z1 - z0) * s, y = y0 + (y1 - y0) * s;
  // The top segment meets its mirror image at the centreline, so it must arrive
  // there level: y = y6 + (y7 - y6)(2s - s²) has zero cross-slope at s = 1.
  if (k === 6) y = y0 + (y1 - y0) * (2 * s - s * s);
  const b = bulge(k, x) * 4 * s * (1 - s);
  if (b) {
    const dz = z1 - z0, dy = y1 - y0, L = Math.hypot(dz, dy) || 1;
    // Chain runs counter-clockwise in (z, y), so outward is the direction rotated clockwise.
    z += (dy / L) * b;
    y += (-dz / L) * b;
  }
  return [z, y];
}

/** Surface point pushed `off` along the outward section normal (an offset is a vector). */
function surfOff(x, u, off) {
  let [z, y] = surface(x, u);
  if (off) {
    const e = 1e-3;
    const [za, ya] = surface(x, Math.min(u + e, 7)), [zb, yb] = surface(x, Math.max(u - e, 0));
    const dz = za - zb, dy = ya - yb, L = Math.hypot(dz, dy) || 1;
    z += (dy / L) * off;
    y += (-dz / L) * off;
  }
  return [z, y];
}

const XEND_F = S.NOSE - 0.010; // skin datum: the splitter adds the last 10 mm
const XEND_R = S.TAIL + 0.025; // skin datum: the lamp band stands 25 mm proud of the tail skin
const yAt = (x, u) => surface(x, u)[1];
const uniform = (t) => t;
const cluster = (t) => t - 0.35 * Math.sin(2 * Math.PI * t) / (2 * Math.PI);

/**
 * A patch of the surface between u0 and u1 (within ONE key segment, so creases
 * stay hard) and between shut lines xa(u) and xb(u). Mirrored to -z unless
 * side is given. `off` pushes the patch along the surface normal; `flip` turns
 * it to face inward (the underside of a thin part). Where xb(u) < xa(u) the
 * patch has no width at that u.
 */
function patch(u0, u1, xa, xb, { nu = 6, nx = 48, side = 0, off = 0, flip = false, spread = cluster, exact = false, round = null } = {}) {
  const XA = typeof xa === 'function' ? xa : () => xa;
  const XB = typeof xb === 'function' ? xb : () => xb;
  const pos = [], idx = [], nor = [], uv = [];
  // uv: x, and the distance along the surface from u0 (metres), so a texture such as the carbon
  // weave keeps one scale on every panel.
  // `exact`: normals from the surface itself (its x and u tangents) rather than from the faces.
  // Round an arch the rows of constant u are squeezed upward, so closely spaced columns there make
  // long, sheared faces whose own normals tilt; the surface's normal does not. The x tangent never
  // reaches across an arch's end. `round` ('lo' or 'hi', an edge on a crease): the rows turn toward
  // the crease's mean normal, reaching it at that edge, so a narrow strip ending there shades as a
  // rounded crease (see band's `fillet`).
  const inArch = (x) => archLift(x) > 0;
  const normalAt = (x, u, sg, ua = Math.max(u0, u - 1e-4), ub = Math.min(u1, u + 1e-4)) => {
    const e = 1e-4;
    let x0 = x - e, x1 = x + e;
    if (inArch(x0) !== inArch(x)) x0 = x;
    if (inArch(x1) !== inArch(x)) x1 = x;
    const P = (xx, uu) => { const [z, y] = surfOff(xx, uu, off); return new THREE.Vector3(xx, y, sg * z); };
    const n = P(x1, u).sub(P(x0, u)).cross(P(x, ub).sub(P(x, ua))).normalize();
    return (sg > 0) !== flip ? n : n.negate();
  };
  const creaseNormal = (x, u, sg) => normalAt(x, u, sg, u - 1e-4, u).add(normalAt(x, u, sg, u, u + 1e-4)).normalize();
  const sides = side ? [side] : [1, -1];
  for (const sg of sides) {
    const base = pos.length / 3;
    const arc = new Array(nx + 1).fill(0), prev = [];
    for (let i = 0; i <= nu; i++) {
      const u = u0 + ((u1 - u0) * i) / nu;
      const a = XA(u), b = Math.max(a, XB(u));
      // How far this row's normal has turned toward the crease's mean normal (0 off the crease edge).
      const t = round === 'lo' ? 1 - i / nu : round === 'hi' ? i / nu : 0;
      const ce = round === 'lo' ? u0 : u1;
      for (let j = 0; j <= nx; j++) {
        const x = a + (b - a) * spread(j / nx);
        const [z, y] = surfOff(x, u, off);
        if (i) arc[j] += Math.hypot(x - prev[j][0], y - prev[j][1], z - prev[j][2]);
        prev[j] = [x, y, z];
        pos.push(x, y, sg * z);
        uv.push(x, arc[j]);
        if (!exact) continue;
        const n = normalAt(x, u, sg);
        if (t > 0) n.lerp(creaseNormal(x, ce, sg), t).normalize();
        nor.push(n.x, n.y, n.z);
      }
    }
    const m = nx + 1;
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nx; j++) {
        const a = base + i * m + j, b = a + 1, c = a + m, d = c + 1;
        // u increases away from the floor centre; x increases forward. On +z this
        // winding faces outward; mirrored, it flips.
        if ((sg > 0) !== flip) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (exact) g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  else g.computeVertexNormals();
  return g;
}

/**
 * Patches across several key segments: one per segment so every integer u stays a crease.
 * `fillet: { at: [k, ...], w }` rounds those creases (integer u at or inside [u0, u1]): each
 * patch that ends on one gives up a strip `w` metres wide along it (w a number, or { [k]: w }),
 * sampled exactly as the patch, whose normals turn from the surface's own to the crease's mean
 * normal at the crease. The strip's width in u is taken at x = fillet.x when given, so bands split
 * in x agree. The strips come back marked (userData.fillet), so a caller can give them a mesh of
 * their own. The crease itself does not move: the outline is unchanged.
 */
function band(u0, u1, xa, xb, opts = {}) {
  const out = [];
  const { fillet, ...o } = opts;
  const at = new Set(fillet ? fillet.at : []);
  const XA = typeof xa === 'function' ? xa : () => xa;
  const XB = typeof xb === 'function' ? xb : () => xb;
  for (let k = Math.floor(u0); k < u1; k++) {
    let a = Math.max(u0, k), b = Math.min(u1, k + 1);
    if (b - a <= 1e-6) continue;
    const strip = (c, dir) => {
      const w = typeof fillet.w === 'number' ? fillet.w : fillet.w[c];
      const xm = fillet.x ?? (XA(c) + XB(c)) / 2, du = Math.min(uStep(xm, c, w, dir), (b - a) / 3);
      const [s0, s1] = dir > 0 ? [c, c + du] : [c - du, c];
      const g = patch(s0, s1, xa, xb, { ...o, exact: true, nu: 2, round: dir > 0 ? 'lo' : 'hi' });
      g.userData.fillet = true;
      out.push(g);
      return du;
    };
    const lo = at.has(a) ? strip(a, 1) : 0, hi = at.has(b) ? strip(b, -1) : 0;
    a += lo; b -= hi;
    out.push(patch(a, b, xa, xb, fillet ? { ...o, exact: true } : o));
  }
  return out;
}
/** Split a list of geometries into [the panels, their fillet strips]. */
const unfillet = (list) => [list.filter((g) => !g.userData.fillet), list.filter((g) => g.userData.fillet)];
/** The step in u that covers `w` metres of surface from u toward u + dir (dir +-1), at x. */
function uStep(x, u, w, dir) {
  const e = 1e-3, [z0, y0] = surface(x, u), [z1, y1] = surface(x, u + dir * e);
  return w / (Math.hypot(z1 - z0, y1 - y0) / e);
}

/**
 * A wall along a path on the surface, from offset o0 to offset o1 (both sides
 * visible): the step at the edge of a pocket, a recess or a thin part. `path`
 * is [[x, u], ...]; it is split at integer u so a crease stays a crease.
 * `face` shades it properly where it shows: a direction (or a function of the
 * side) makes it one-sided, facing that way; 'both' gives each side vertices
 * of its own (two windings on shared vertices have no normal to speak of).
 */
function wall(path, o0, o1, { side = 0, face = null } = {}) {
  const geoms = [];
  for (const sg of side ? [side] : [1, -1]) {
    const rows = [o0, o1].map((o) => path.map(([x, u]) => { const [z, y] = surfOff(x, u, o); return [x, y, sg * z]; }));
    if (!face) geoms.push(gridMesh(rows, { both: true }));
    else if (face === 'both') geoms.push(gridMesh(rows), gridMesh(rows, { flip: true }));
    else geoms.push(orient(gridMesh(rows), typeof face === 'function' ? face(sg) : face));
  }
  return merge(geoms);
}
const pathU = (u, xa, xb, n = 24) => Array.from({ length: n + 1 }, (_, i) => [xa + (xb - xa) * (i / n), u]);
const pathX = (xOf, u0, u1, n = 12) => Array.from({ length: n + 1 }, (_, i) => { const u = u0 + (u1 - u0) * (i / n); return [xOf(u), u]; });

/** A thin shell over a region: outer skin, inner skin `t` beneath, and its four edges. */
function shell(u0, u1, xa, xb, t, opts = {}) {
  const XA = typeof xa === 'function' ? xa : () => xa;
  const XB = typeof xb === 'function' ? xb : () => xb;
  const side = opts.side || 0;
  return [
    ...band(u0, u1, XA, XB, opts),
    ...band(u0, u1, XA, XB, { ...opts, off: -t, flip: true }),
    wall(pathU(u0, XA(u0), XB(u0)), 0, -t, { side }),
    wall(pathU(u1, XA(u1), XB(u1)), 0, -t, { side }),
    wall(pathX(XA, u0, u1, 24), 0, -t, { side }),
    wall(pathX(XB, u0, u1, 24), 0, -t, { side }),
  ];
}

// ---------- wheel arches ----------
// archLift() cuts each arch out of the side, the sill and the floor. A band that crosses an arch
// is split at the arch's ends and sampled there by angle round the arch, so the arch comes out
// round (chords under 10 mm); each cut sits 1 um outside the arch, so the arch's vertical ends fall
// within one sample. Bands that meet along a u line get the same samples across an arch, so their
// edges coincide there. Elsewhere a band is sampled about every 25 mm.
const ARCHES = [[S.XR, S.tireRR + ARCH_GAP], [S.XF, S.tireRF + ARCH_GAP]];
const ARCH_CUTS = ARCHES.flatMap(([x, ra]) => [x - ra - 1e-6, x + ra + 1e-6]);
const ARCH_N = 144;
// Wheel wells: the liner runs 8 mm behind the arch edge (WELL_HALF is its radius, and half the
// well's length); the inboard wall stands at WELL_IN (front: room for about 20 deg of steer).
const WELL_HALF = { F: S.tireRF + ARCH_GAP + 0.008, R: S.tireRR + ARCH_GAP + 0.008 };
const WELL_IN = { F: 0.56, R: 0.62 };
const roundArch = (t) => (1 - Math.cos(Math.PI * t)) / 2;
function archBand(u0, u1, xa, xb, opts = {}) {
  const XA = typeof xa === 'function' ? xa : () => xa;
  const XB = typeof xb === 'function' ? xb : () => xb;
  // Rounded creases take one width in u across all the pieces, so their rows meet at the cuts.
  if (opts.fillet) opts = { ...opts, fillet: { x: (XA(u1) + XB(u1)) / 2, ...opts.fillet } };
  const E = [XA, ...ARCH_CUTS.map((c) => (u) => Math.min(Math.max(c, XA(u)), XB(u))), XB];
  const us = Array.from({ length: 9 }, (_, i) => u0 + ((u1 - u0) * i) / 8);
  const out = [];
  for (let i = 0; i < E.length - 1; i++) {
    const a = E[i], b = E[i + 1];
    const width = Math.max(...us.map((u) => b(u) - a(u)));
    if (width < 1e-4) continue;
    // Odd pieces lie between an arch's two cuts.
    const arch = i % 2 === 1;
    out.push(...band(u0, u1, a, b, { ...opts, exact: true, nx: arch ? ARCH_N : Math.max(2, Math.ceil(width / 0.025)), ...(arch ? { spread: roundArch } : {}) }));
  }
  return out;
}

/** Turn a geometry so that, summed over its faces, it faces along `dir` (a whole panel at once). */
function orient(g, dir) {
  const p = g.getAttribute('position'), idx = g.index;
  const n = idx ? idx.count : p.count;
  const vi = (i) => (idx ? idx.getX(i) : i);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), sum = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    A.fromBufferAttribute(p, vi(i)); B.fromBufferAttribute(p, vi(i + 1)); C.fromBufferAttribute(p, vi(i + 2));
    sum.add(B.sub(A).cross(C.sub(A)));
  }
  if (sum.dot(dir) >= 0) return g;
  if (idx) {
    for (let i = 0; i < n; i += 3) { const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t); }
  } else {
    for (let i = 0; i < n; i += 3) for (let k = 0; k < 3; k++) { const t = p.getComponent(i + 1, k); p.setComponent(i + 1, k, p.getComponent(i + 2, k)); p.setComponent(i + 2, k, t); }
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A flat floor panel facing down at the floor's own height ZB(x), raised by dy (a seam recessed
 * into the floor has dy > 0): x0..x1, z from z0(x) to z1(x), on each of `sides`.
 */
function floorPanel(x0, x1, z0, z1, { dy = 0, nx = 12, nz = 2, sides = [1, -1] } = {}) {
  const Z0 = typeof z0 === 'function' ? z0 : () => z0;
  const Z1 = typeof z1 === 'function' ? z1 : () => z1;
  return sides.map((sg) => {
    const rows = [];
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx, y = ZB(x) + dy;
      rows.push(Array.from({ length: nz + 1 }, (_, j) => [x, y, sg * lerp(Z0(x), Z1(x), j / nz)]));
    }
    return orient(gridMesh(rows), new THREE.Vector3(0, -1, 0));
  });
}

/** The closed end-section outline as [z, y, x], both sides; x may vary with u (a raked face). */
function endOutline(xOf, uMax = 7) {
  const X = typeof xOf === 'function' ? xOf : () => xOf;
  const pts = [];
  const n = 70;
  for (let i = 0; i <= n; i++) { const u = (uMax * i) / n, x = X(u); const [z, y] = surface(x, u); pts.push([z, y, x]); }
  return [...pts, ...pts.slice(1, -1).reverse().map(([z, y, x]) => [-z, y, x])];
}

/** Sutherland–Hodgman: keep the part of polygon `poly` where f([z, y]) >= 0 (f linear). */
function clipPoly(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return out;
}

/**
 * Cap over the end section at x (or x(u) for a raked face), facing +x or -x;
 * optional clip, optional holes ([[z, y], ...] each) whose points take x from xOfY.
 */
function endCap(x, facing, uMax = 7, clip = null, holes = [], xOfY = null) {
  let full = endOutline(x, uMax);
  if (clip) for (const f of [].concat(clip)) full = clipPoly(full, f);
  if (full.length < 3) return new THREE.BufferGeometry();
  const shape = new THREE.Shape(full.map(([z, y]) => new THREE.Vector2(z, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([z, y]) => new THREE.Vector2(z, y))));
  const g = new THREE.ShapeGeometry(shape);
  const p = g.getAttribute('position');
  const holePts = holes.flat();
  // ShapeGeometry keeps the outline's (and holes') own points as vertices: give each its x back.
  for (let i = 0; i < p.count; i++) {
    const z = p.getX(i), y = p.getY(i);
    let best = full[0], d = Infinity;
    for (const q of full) { const e = (q[0] - z) ** 2 + (q[1] - y) ** 2; if (e < d) { d = e; best = q; } }
    let xx = best[2];
    if (xOfY && holePts.some(([hz, hy]) => (hz - z) ** 2 + (hy - y) ** 2 < 1e-12)) xx = xOfY(y);
    p.setXYZ(i, xx, y, z);
  }
  // ShapeGeometry faces +z in its own frame; mapped (u,v)->(z,y) it faces -x. Flip for the front.
  if (facing > 0) {
    const ix = g.getIndex();
    for (let i = 0; i < ix.count; i += 3) { const t = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, t); }
  }
  // Its uv stays the shape's own: z and y in metres.
  g.computeVertexNormals();
  return g;
}

// ---------- shut lines (measured: docs/REFERENCE-fit.md, line ends) ----------
// A shut line is a curve, not a number: x as a function of height, sampled where the
// line actually crosses the surface.
function lineX(pts, y) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (y <= y1 || i === pts.length - 2) return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
  }
  return pts[pts.length - 1][0];
}
const DOOR_FRONT_LINE = [[0.780, 0.308], [0.855, 0.705]];
const DOOR_REAR_LINE = [[-0.205, 0.315], [-0.351, 0.768], [-0.372, 0.873]];
const B_LINE = [[-0.372, 0.873], [-0.490, 1.121]];
// Door skin front edge: the measured line up to the shoulder crease (the pod), then raking
// back over the shoulder band to the base of the glass at 0.740 (side frame t6.75: from the pod's
// rear end up and back to the belt; the aerial puts that end at 0.73).
const DOOR_F4 = lineX(DOOR_FRONT_LINE, yAt(0.82, 4));
const DOOR_F = (u) => (u <= 4 ? lineX(DOOR_FRONT_LINE, yAt(0.82, u)) : lerp(DOOR_F4, 0.740, u - 4));
// Door rear edge: the rear shut line to the belt, then the glass B line to the roof rail.
const DOOR_R = (u) => (u <= 5 ? lineX(DOOR_REAR_LINE, yAt(-0.28, u)) : lineX(B_LINE, yAt(-0.43, u)));
// The wing is the whole tail top behind the deck shut line, which is also where the rear
// glass ends (aerial: both at x -1.78; side: the end plate's line meets the haunch at -1.76).
const WING_X0 = -1.775;
const GLASS_END = WING_X0;
// The quarter glass fills the band behind the B line only up to QG_TOP (aerial: its inner edge at 0.616
// against the rear-glass edge at 0.48, x -0.69); above it a white strip runs back as the top of the sail
// (the bright band over the quarter glass in the side frame). It ends in a point: its rear edge rakes
// from the belt at -0.92 to (-1.00, QG_TOP), the aerial's tip at (-1.02, 0.545).
const QG_TOP = 5.41;
const QTIP = (u) => -0.92 - ((u - 5) / (QG_TOP - 5)) * 0.08;
// Each gull-wing door also carries a panel of roof glass up to near the centre spine.
const DOOR_TOP = 6.72;      // u of the door's top edge (the hinge line)
const DOOR_ROOF_F = 0.38;   // roof-glass panel of the door, front edge (x)
const DOOR_ROOF_R = -0.48;  // and rear edge, on the B line
// Windscreen base (cowl): 1.558 at the hood crease, 1.575 on the centreline (aerial). Its outer
// corner is the u6 line itself, which runs diagonally from the hood crease to the A-pillar root.
const COWL = (u) => 1.558 + 0.017 * (1 - (7 - u) ** 2);
// A-pillar root: the side glass starts at the belt's front tip.
const APIL = (u) => 1.24 - Math.max(0, u - 5) * 0.02;
// Front corners: the hood crease, the fender ridge and the plan outline meet at x 2.164 (aerial).
const X_CORNER = 2.164;
// The hood's front edge (the light bar) is curved in plan: 2.272 on the centreline, the corners at 2.164.
const XEND_HOOD = (u) => X_CORNER + (XEND_F - X_CORNER) * (1 - (7 - u) ** 2);
// The shut line across the hood: 1.745 at the crease, 1.768 on the centreline (aerial).
const HOOD_SL = (u) => 1.745 + 0.023 * (1 - (7 - u) ** 2);
// Lamp pocket: the triangle between the ridge (u5) and the hood crease (u6) ahead of this line
// (aerial: rear corners (1.921, 0.704) on the ridge and (1.938, 0.540) on the crease).
const X_TRI = (u) => 1.921 + (u - 5) * 0.017;
const LAMP_DEPTH = 0.032;
// The tail face rakes: the lip at the lamp band, the bottom 0.14 m further forward.
const XR_END = (u) => {
  if (u >= 4) return XEND_R;
  const y = yAt(XEND_R, u);
  return XEND_R + Math.max(0, 0.83 - y) * 0.2035;
};
const faceX = (y) => XEND_R + Math.max(0, 0.83 - y) * 0.2035;
/** u in [k, k + 1] (the body side, u3..u4, by default) where the surface reaches height y at x (bisection; the side rises with u). */
function uAtY(x, y, k = 3) {
  let a = k, b = k + 1;
  for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (yAt(x, m) < y) a = m; else b = m; }
  return (a + b) / 2;
}
// The wing's end plates are the tail block's side panels behind a diagonal shut line: from the
// haunch top at the deck line down to (-1.877, 0.649), then back to the tail face at 0.73 (side frame).
const EP_U0 = uAtY(-1.877, 0.649);
const EP_U1 = uAtY(XEND_R + 0.02, 0.73);
const EP_F = (u) => -1.877 + ((u - EP_U0) / (4 - EP_U0)) * (WING_X0 + 1.877);
const EP_R = (u) => (u < EP_U1 ? lerp(-1.877, XR_END(EP_U1), (u - EP_U0) / (EP_U1 - EP_U0)) : XR_END(u));
const WING_SKIN = 0.012;    // blade and end-plate thickness
const DECK_DROP = 0.030;    // the fixed deck under the wing, along the normal

// The door glass's front edge, a glass-to-glass seal raking from the belt at 0.650 up to the
// windscreen header (side frame t6.75 0.59-0.62, aerial 0.62-0.71). Ahead of it the side glass is
// fixed: the A-pillar glass, wrapping down from the windscreen to the belt.
const ADIAG = (u) => lerp(0.650, DOOR_ROOF_F, u - 5);
// The door glass is two panes: a second seal runs 0.135 m ahead of the B line and parallel to it
// (side frame and aerial both show the pair of lines).
const B2 = (u) => DOOR_R(u) + 0.135;

// The cabin, seen with the doors up: its floor laid on the pack (whose top is 0.295), its side trim
// the skin pulled CAB.side in, the sills' tops rising from the door's bottom shut line to a ridge at
// (sillZ, sillY) and dropping to the floor; the kick panels reach forward to the A-pillars' base and a
// front wall at CAB.front closes the footwells under the dash.
const CAB = { floor: 0.300, side: 0.06, sillY: 0.33, sillZ: 0.80, floorZ: 0.86, kick: 1.265, front: 1.27 };
// The rear bulkhead, x by height: just behind the seat backs and ahead of the tank (whose front is at
// -0.41, at 0.75), meeting the roof behind the B line (plan x-ray: the bay's bulkhead at -0.34/-0.39).
const XBULK = (y) => lineX([[-0.335, 0.300], [-0.380, 0.750], [-0.400, 0.870], [-0.500, 1.130]], y);
const XWELL = S.XF - WELL_HALF.F;              // the front wells' rear faces

// ---------- shut lines and seals: real gaps over dark channels ----------
// Every panel stops half a gap short of each shut line, and a channel under the line (a flange
// just under each panel's edge, a wall down each edge and a floor) closes the view into the car,
// so a hairline between patches sampled differently shows the channel, not the background. The
// channels are meshes of their own (one-sided, drawn from both sides by their material): the
// Garage's blueprint inks them as lines, and the rendered views show a dark recessed line, as on
// the car. Glass panels are framed the same way by shallow black seals. Along a shut line of
// constant u the gap is a step in u (the gap's width over the surface's rate along u at a typical
// station, so it narrows where the surface section does).
const GAP = 0.004;          // every shut line and glass seal
const CHANNEL = 0.008;      // depth of a body shut line's channel
const SEAL = 0.003;         // depth of a glass seal
const RAIL = 0.028;         // the roof rail over the door's side glass, across the surface
const FILLET = { 4: 0.008, 5: 0.012 };  // each side of a rounded crease: the shoulder (u4), the fender's ridge (u5)
const U3_DOOR = 3 + uStep(0, 3, GAP, 1);                // door bottom, over the sill (the sill keeps u3)
const U5_AGLASS = 5 + uStep(0.9, 5, GAP, 1);            // A-pillar glass bottom, over the belt
const U6_LO = 6 - uStep(0, 6, GAP / 2, -1);             // tops of the panels under u6
const U6_HI = 6 + uStep(0, 6, GAP / 2, 1);              // bottoms of the panels over u6
const RAIL_LO = U6_LO - uStep(0, U6_LO, RAIL, -1);      // the rail, on the door: RAIL_LO..U6_LO
const SIDE_TOP = RAIL_LO - uStep(0, RAIL_LO, GAP, -1);  // top of the door's side glass
const SPINE_LO = DOOR_TOP - uStep(0, DOOR_TOP, GAP / 2, -1);
const SPINE_HI = DOOR_TOP + uStep(0, DOOR_TOP, GAP / 2, 1);
const IN = 0.0012;          // a channel's flanges sit this far under the skin (clear of a coarse panel's chords)
const DOOR_T = 0.035;       // a door's thickness: its card sits this far in from the skin
/** The skin's outward normal at (x, u) on side sg, in the section plane. */
function outward(x, u, sg) {
  const [za, ya] = surface(x, Math.min(u + 1e-3, 7)), [zb, yb] = surface(x, Math.max(u - 1e-3, 0));
  return new THREE.Vector3(0, -(za - zb), sg * (ya - yb)).normalize();
}
/**
 * The rows of a channel's section (flange, wall, floor, wall, flange) as [offset along the line, depth].
 * The walls stand a quarter of the gap in from the panels' ends (1 mm in a 4 mm gap), with the
 * flanges running under the panels and out to them: where a panel has an edge of its own (a door's
 * or an end plate's, in the body colour), the dark wall stands in front of it instead of in the
 * same place, so the two never fight for the same pixels.
 */
const channelSection = (lo, hi, fl, depth) => {
  const a = lo + (hi - lo) / 4, b = hi - (hi - lo) / 4;
  return [[lo - fl, -IN], [a, -IN], [a, -depth], [b, -depth], [b, -IN], [hi + fl, -IN]];
};

/**
 * The channel under a gap across constant u: the panels end at u = ua and start again at u = ub,
 * from x = xa to xb.
 */
function seamU(ua, ub, xa, xb, { depth = CHANNEL, side = 0 } = {}) {
  const n = Math.max(4, Math.ceil(Math.abs(xb - xa) / 0.02));
  const fl = Math.max(0.006, 1.5 * (ub - ua));
  const geoms = [];
  for (const sg of side ? [side] : [1, -1]) {
    const rows = channelSection(ua, ub, fl, depth).map(([u, o]) => Array.from({ length: n + 1 }, (_, i) => {
      const x = xa + ((xb - xa) * i) / n, [z, y] = surfOff(x, u, o);
      return [x, y, sg * z];
    }));
    geoms.push(orient(gridMesh(rows), outward((xa + xb) / 2, (ua + ub) / 2, sg)));
  }
  return merge(geoms);
}

/**
 * The channel under a gap along a shut line x = X(u) from u0 to u1: the panels end at X(u) - w/2
 * and start again at X(u) + w/2. Sampled through every crease it crosses.
 */
function seamX(X, u0, u1, { depth = CHANNEL, side = 0, w = GAP } = {}) {
  const us = [];
  for (let k = Math.floor(u0); k < u1; k++) {
    const a = Math.max(u0, k), b = Math.min(u1, k + 1);
    if (b - a < 1e-6) continue;
    const m = Math.max(2, Math.ceil((b - a) * 16));
    for (let i = us.length ? 1 : 0; i <= m; i++) us.push(a + ((b - a) * i) / m);
  }
  const geoms = [];
  for (const sg of side ? [side] : [1, -1]) {
    const rows = channelSection(-w / 2, w / 2, 0.006, depth).map(([dx, o]) => us.map((u) => {
      const x = X(u) + dx, [z, y] = surfOff(x, u, o);
      return [x, y, sg * z];
    }));
    const um = (u0 + u1) / 2;
    geoms.push(orient(gridMesh(rows), outward(X(um), um, sg)));
  }
  return merge(geoms);
}

/**
 * A ribbon of skin just under a crease (u = k, x from xa to xb), for creases where two panels
 * meet with different sampling: a hairline between them shows the ribbon, which is the same
 * paint at nearly the same angle, instead of the background.
 */
function creaseBacking(k, xa, xb, { w = 0.006, side = 0 } = {}) {
  const n = Math.max(4, Math.ceil(Math.abs(xb - xa) / 0.02));
  const geoms = [];
  for (const sg of side ? [side] : [1, -1]) {
    const rows = [-1, 0, 1].map((d) => Array.from({ length: n + 1 }, (_, i) => {
      const x = xa + ((xb - xa) * i) / n, u = k + (d ? d * uStep(x, k, w, d) : 0), [z, y] = surfOff(x, u, -0.0008);
      return [x, y, sg * z];
    }));
    geoms.push(orient(gridMesh(rows), outward((xa + xb) / 2, k, sg)));
  }
  return merge(geoms);
}

/** Height of the underside (floor and the sill's underside corner, u0..u2) at x and half-width z. */
function underY(x, z) {
  let prev = surface(x, 0);
  for (let i = 1; i <= 48; i++) {
    const p = surface(x, (2 * i) / 48);
    if (p[0] >= z) return lerp(prev[1], p[1], Math.max(0, Math.min(1, (z - prev[0]) / (p[0] - prev[0] || 1))));
    prev = p;
  }
  return prev[1];
}

/** Where the plan lines p + s d and q + t e meet ([x, z] each). */
function meetLines(p, d, q, e) {
  const den = d[0] * e[1] - d[1] * e[0];
  const s = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + s * d[0], p[1] + s * d[1]];
}

// The front lip's section, as [a, y]: a is along the nose line's plan normal (forward and out,
// 0 at the nose), walked from the nose over the top, down the back and forward underneath. Under
// the intake it is a deep chin whose top ramps up into the intake (absolute heights, side outline);
// at the sides a 34 mm blade on the floor's height (y above ZB). The two have the same points, so a
// section part way between is a blend of them.
const LIP_CHIN = [[0, 0.218], [-0.0035, 0.228], [-0.0115, 0.238], [-0.026, 0.250], [-0.045, 0.272], [-0.066, 0.290], [-0.160, 0.290],
  [-0.160, 0.184], [-0.1315, 0.186], [-0.0765, 0.198], [-0.0315, 0.205], [-0.012, 0.206], [-0.0045, 0.208], [-0.001, 0.212]];
const LIP_BLADE = [[0, 0.017], [-0.003, 0.026], [-0.009, 0.031], [-0.018, 0.033], [-0.030, 0.034], [-0.045, 0.034], [-0.065, 0.034],
  [-0.065, 0], [-0.050, 0], [-0.035, 0], [-0.020, 0], [-0.010, 0.001], [-0.004, 0.004], [-0.001, 0.009]];

/**
 * A closed section swept along a path in plan. `path` is [[x, z], ...]; `ring(x, z)` gives the
 * section there as [[a, y], ...], counter-clockwise with a along the path's plan normal (the
 * walking direction turned to the right: forward for a path walked toward +z, rearward for one
 * walked toward -z). Both ends are capped; the section's seam is smoothed.
 */
function sweep(path, ring) {
  const rings = path.map(([x, z], i) => {
    const [xa, za] = path[Math.max(0, i - 1)], [xb, zb] = path[Math.min(path.length - 1, i + 1)];
    const L = Math.hypot(xb - xa, zb - za), nx = (zb - za) / L, nz = -(xb - xa) / L;
    const r = ring(x, z).map(([a, y]) => [x + nx * a, y, z + nz * a]);
    return [...r, r[0]];
  });
  const g = gridMesh(rings, { flip: true });
  // The ring is closed: average the normals of the seam's two copies.
  const nm = g.getAttribute('normal'), m = rings[0].length, v = new THREE.Vector3();
  for (let i = 0; i < rings.length; i++) {
    const a = i * m, b = a + m - 1;
    v.set(nm.getX(a) + nm.getX(b), nm.getY(a) + nm.getY(b), nm.getZ(a) + nm.getZ(b)).normalize();
    nm.setXYZ(a, v.x, v.y, v.z); nm.setXYZ(b, v.x, v.y, v.z);
  }
  const caps = [[rings[0], path[0], path[1]], [rings[rings.length - 1], path[path.length - 1], path[path.length - 2]]].map(([r, [x0, z0], [x1, z1]]) => {
    const c = r.slice(0, -1).reduce((acc, p) => acc.map((v, k) => v + p[k] / (r.length - 1)), [0, 0, 0]);
    const pos = [];
    for (let j = 0; j < r.length - 1; j++) pos.push(...c, ...r[j], ...r[j + 1]);
    const cap = new THREE.BufferGeometry();
    cap.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cap.computeVertexNormals();
    return orient(cap, new THREE.Vector3(x0 - x1, 0, z0 - z1));
  });
  return merge([g, ...caps]);
}

/** The lip along its nose line `path` (walked from the car's left end to its right), the section blended from chin (w 0) to blade (w 1) by w(x, z). */
function lipGeometry(path, w) {
  return sweep(path, (x, z) => {
    const k = w(x, z), yb = ZB(x) + 0.003;
    return LIP_CHIN.map(([a0, y0], j) => [lerp(a0, LIP_BLADE[j][0], k), lerp(y0, yb + LIP_BLADE[j][1], k)]);
  });
}

/** A path in plan along x = x0 for |z| <= z1, whose ends turn forward (+x) round radius r to x0 + r; walked from +z to -z (so the section's a points rearward). */
function wrapPath(x0, z1, r, n = 40, nr = 8) {
  const out = [];
  for (let i = 0; i <= nr; i++) { const t = (Math.PI / 2) * (1 - i / nr); out.push([x0 + r - r * Math.cos(t), z1 - r + r * Math.sin(t)]); }
  for (let i = 1; i < n; i++) out.push([x0, lerp(z1 - r, -(z1 - r), i / n)]);
  for (let i = 0; i <= nr; i++) { const t = (Math.PI / 2) * (i / nr); out.push([x0 + r - r * Math.cos(t), -(z1 - r) - r * Math.sin(t)]); }
  return out;
}

/** Thin bars along each segment of each stroke ([[a, b], ...] in a unit box), `w` wide and `t` thick, in a plane (a, b) scaled by (sx, sy): raised letters. */
function strokes(list, sx, sy, w, t) {
  const bars = [], h = w / 2;
  for (const line of list) {
    for (let i = 0; i < line.length - 1; i++) {
      const [a0, b0] = [line[i][0] * sx, line[i][1] * sy], [a1, b1] = [line[i + 1][0] * sx, line[i + 1][1] * sy];
      const L = Math.hypot(a1 - a0, b1 - b0) || 1, ua = (a1 - a0) / L, ub = (b1 - b0) / L;
      bars.push(prism([[a0 - ub * h, b0 + ua * h], [a1 - ub * h, b1 + ua * h], [a1 + ub * h, b1 - ua * h], [a0 + ub * h, b0 - ua * h]], t));
    }
    // Round joints and ends (a bar run on past its ends shows its square corners at every joint).
    for (const [a, b] of line) bars.push(prism(Array.from({ length: 12 }, (_, k) => [a * sx + h * Math.cos((k * Math.PI) / 6), b * sy + h * Math.sin((k * Math.PI) / 6)]), t));
  }
  return bars;
}
// RDSTR in a plain rounded sans, as strokes.
const GLYPHS = {
  R: [[[0, 0], [0, 1], [0.6, 1], [0.85, 0.88], [0.85, 0.62], [0.6, 0.5], [0, 0.5]], [[0.45, 0.5], [0.88, 0]]],
  D: [[[0, 0], [0, 1], [0.5, 1], [0.8, 0.85], [0.9, 0.5], [0.8, 0.15], [0.5, 0], [0, 0]]],
  S: [[[0.9, 0.85], [0.7, 1], [0.25, 1], [0.05, 0.85], [0.05, 0.65], [0.25, 0.52], [0.75, 0.48], [0.95, 0.35], [0.95, 0.15], [0.75, 0], [0.25, 0], [0.05, 0.15]]],
  T: [[[0, 1], [1, 1]], [[0.5, 1], [0.5, 0]]],
};

// ---------- cabin helpers ----------
/**
 * A solid lofted through `rings` (each a loop of [x, y, z] points, every loop the same length and
 * walked the same way): one strip per range of loop indices ([j0, j1], j1 may run past the loop's
 * end and wrap), so one section can carry several materials. All strips face outward (decided once
 * on the whole loop); a strip that is the whole loop has its seam smoothed. `caps` closes both ends
 * and adds the two caps to the strip with that index (or none, given null).
 */
function loft(rings, ranges = null, { caps = 0 } = {}) {
  const n = rings[0].length;
  const centre = (r) => r.reduce((c, p) => c.map((v, k) => v + p[k] / r.length), [0, 0, 0]);
  // Winding: a loop that turns counter-clockwise about the loft's direction (its polygon normal, by
  // Newell's sum, points along the way the rings advance) would face inward unflipped. (Testing a
  // face against the ring's centre fails where a section's points crowd to one side, as a seat's
  // bolsters do.)
  const V = (p) => new THREE.Vector3(...p);
  const i = Math.floor((rings.length - 1) / 2), turn = new THREE.Vector3();
  for (let k = 0; k < n; k++) turn.add(V(rings[i][k]).cross(V(rings[i][(k + 1) % n])));
  const flip = turn.dot(V(centre(rings[i + 1])).sub(V(centre(rings[i])))) > 0;
  const out = (ranges || [[0, n]]).map(([j0, j1]) => {
    const rows = rings.map((r) => Array.from({ length: j1 - j0 + 1 }, (_, k) => r[(j0 + k) % n]));
    const g = gridMesh(rows, { flip });
    if (j1 - j0 === n) {
      const nm = g.getAttribute('normal'), m = n + 1, v = new THREE.Vector3();
      for (let r = 0; r < rings.length; r++) {
        const p = r * m, q = p + m - 1;
        v.set(nm.getX(p) + nm.getX(q), nm.getY(p) + nm.getY(q), nm.getZ(p) + nm.getZ(q)).normalize();
        nm.setXYZ(p, v.x, v.y, v.z); nm.setXYZ(q, v.x, v.y, v.z);
      }
    }
    return g;
  });
  if (caps !== null) {
    const ends = [[rings[0], rings[1]], [rings[rings.length - 1], rings[rings.length - 2]]].map(([r, next]) => {
      const c0 = centre(r), c1 = centre(next), pos = [];
      for (let k = 0; k < n; k++) pos.push(...c0, ...r[k], ...r[(k + 1) % n]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      return orient(g, V(c0).sub(V(c1)));
    });
    out[caps] = merge([out[caps], ...ends]);
  }
  return out;
}

/** A round tube of radius r along a path of [x, y, z] points; `up` (a vector per point) keeps its section from twisting. */
function pipe(path, up, r, n = 8) {
  const rings = path.map((p, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const T = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const N = up[i].clone().addScaledVector(T, -up[i].dot(T)).normalize(), B = T.clone().cross(N);
    return Array.from({ length: n }, (_, k) => {
      const t = (2 * Math.PI * k) / n, cs = r * Math.cos(t), sn = r * Math.sin(t);
      return [p[0] + cs * N.x + sn * B.x, p[1] + cs * N.y + sn * B.y, p[2] + cs * N.z + sn * B.z];
    });
  });
  return loft(rings)[0];
}

/** A rounded rectangle about the origin, half-sizes a and b, corner radius r: k + 1 points per corner, counter-clockwise from the +a side. */
function roundRect(a, b, r, k = 4) {
  const pts = [];
  for (const [ca, cb, a0] of [[a - r, b - r, 0], [-a + r, b - r, 90], [-a + r, -b + r, 180], [a - r, -b + r, 270]]) {
    for (let i = 0; i <= k; i++) { const t = ((a0 + (i * 90) / k) * Math.PI) / 180; pts.push([ca + r * Math.cos(t), cb + r * Math.sin(t)]); }
  }
  return pts;
}

/** A cylinder of radius r from point p to point q. */
function rodBetween(p, q, r, seg = 12) {
  const a = new THREE.Vector3(...p), d = new THREE.Vector3(...q).sub(a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate(a.x + d.x / 2, a.y + d.y / 2, a.z + d.z / 2);
  return g;
}

/** The skin at (x, u) pulled straight in (toward the centreline) by d, on side sg: trim that follows the body's own section without folding at its creases. */
function inset(x, u, d, sg) {
  const [z, y] = surface(x, u);
  return [x, y, sg * (z - d)];
}

/** Half-width of the skin at height y on the station x, over the cabin's sides and roof (u 3..7, where y rises with u). */
function skinZ(x, y) {
  let a = 3, b = 7;
  for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (yAt(x, m) < y) a = m; else b = m; }
  return surface(x, (a + b) / 2)[0];
}

const linspace = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));

/** A door jamb on side sg: the body side's edge along the shut line x = X(u), from the line's channel in to the cabin's side trim, u0 to u1. */
function jamb(X, u0, u1, sg) {
  const us = u0 < 4 ? linspace(u0, Math.min(4, u1), 6).concat(u1 > 4 ? linspace(4, u1, 6).slice(1) : []) : linspace(u0, u1, 6);
  return gridMesh(us.map((u) => {
    const [z, y] = surfOff(X(u), u, -CHANNEL);
    return [[X(u), y, sg * z], inset(X(u), u, CAB.side, sg)];
  }));
}

// ---------- wheels ----------
// Built in each wheel's own frame: the axle is z, and q is the distance outboard of the wheel's
// centre plane, mirrored to the car's left by sg.

/**
 * A surface of revolution about the axle through `profile` [[radius, q], ...], from angle a0 to a1.
 * Walking the profile outward faces it outboard; walking it outboard faces it toward the axle.
 */
function revolve(profile, sg, n = 96, a0 = 0, a1 = 2 * Math.PI) {
  const rows = profile.map(([r, q]) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [r * Math.cos(a), r * Math.sin(a), sg * q]; }));
  const g = gridMesh(rows, { flip: sg < 0 });
  if (Math.abs(a1 - a0 - 2 * Math.PI) < 1e-9) {
    // A full turn: average the normals of the seam's two copies, so the join does not show.
    const nm = g.getAttribute('normal'), v = new THREE.Vector3();
    for (let i = 0; i < rows.length; i++) {
      const a = i * (n + 1), b = a + n;
      v.set(nm.getX(a) + nm.getX(b), nm.getY(a) + nm.getY(b), nm.getZ(a) + nm.getZ(b)).normalize();
      nm.setXYZ(a, v.x, v.y, v.z);
      nm.setXYZ(b, v.x, v.y, v.z);
    }
  }
  return g;
}

/** Flat-shaded convex polygons, given as [x, y, q] points, each turned to face `dir` ([x, y, q]), mirrored by sg. */
function facetSet(sg) {
  const pos = [];
  const V = ([x, y, q]) => new THREE.Vector3(x, y, sg * q);
  return {
    poly(pts, dir) {
      const P = pts.map(V), n = new THREE.Vector3();
      for (let i = 1; i < P.length - 1; i++) n.add(P[i].clone().sub(P[0]).cross(P[i + 1].clone().sub(P[0])));
      if (n.dot(V(dir)) < 0) P.reverse();
      for (let i = 1; i < P.length - 1; i++) pos.push(...P[0].toArray(), ...P[i].toArray(), ...P[i + 1].toArray());
    },
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      return g;
    },
  };
}

/**
 * The face of one wheel (rim radius rimR, to the top of the rim's flange, where the tyre comes out;
 * tyre width w) on side sg, as { disc, spokes, machined, slot } (front-wheel closeup; side frame
 * t6.75, sampled round circles about each wheel centre): six broad spokes, each a pair of gunmetal
 * blades with a deep slot between them that opens toward the rim, bright machined chamfers along
 * the blades' edges; a light aero disc between the spokes out to the flange, dished 28 mm toward the
 * hub and flat from 33 mm inside the flange's top (the frame reads it in two tones: light to 0.238 m
 * on the front wheel, a little darker to 0.268, the tyre from 0.274); a thin dark lip on the flange;
 * a hub ring the blades rise into, and a domed cap with a raised T. Inside: the barrel (on the bead
 * seat, `seat`) and the back of the face, so the wheel is closed seen from the arch.
 */
function wheelFace(rimR, w, sg, seat = rimR) {
  const hw = w / 2, F = hw * 0.92;                 // F: the face's plane, where the rim's lip sits
  const sc = rimR / 0.2715;                        // the spokes scale with the wheel (the 20-inch front is 1)
  const rCap = 0.060, rHub = 0.078, rEdge = rimR - 0.005, rDish = rimR - 0.033;
  const r0 = rHub - 0.004, r1 = rEdge + 0.001, NR = 10; // the blades run from under the hub ring into the lip
  const t = (a) => (a - r0) / (r1 - r0);
  const qDisc = (rho) => F - 0.006 - 0.028 * Math.max(0, Math.min(1, (rDish - rho) / (rDish - rHub))) ** 1.4;
  const qTop = (a) => lerp(F - 0.008, F, t(a));    // blade tops: 6 mm proud of the disc at the rim, 26 at the hub
  const qSlot = F - 0.040;                         // floor of the slot between a spoke's two blades
  // Side frame t6.75 (near square-on, sampled round circles about the wheel centre): a spoke spans
  // 39 deg of the circle 100 and 140 mm out, then 95 mm across at 180, 85 at 220 and 78 at 250; the
  // slot opens from 10 mm at the hub to 28 at the rim (closeup), so a blade is 25 mm wide at the rim.
  const slotHalf = (a) => sc * lerp(0.005, 0.014, t(a));
  const softMin = (p, q, r = 0.006) => (p + q - Math.hypot(p - q, r)) / 2;            // rounds the elbow
  const edge = (a) => softMin(sc * (0.047 - 0.12 * (a / sc - 0.18)), a * 0.35);  // a blade's outer edge
  const CI = 0.0015, CH = 0.004;                   // inner and outer chamfer widths
  const spokeF = facetSet(sg), machF = facetSet(sg), slotF = facetSet(sg), disc = [];
  const as = Array.from({ length: NR + 1 }, (_, i) => r0 + ((r1 - r0) * i) / NR);
  for (let k = 0; k < 6; k++) {
    const th = (k / 6) * Math.PI * 2 + 0.26, c = Math.cos(th), s = Math.sin(th);
    const pt = (a, p, q) => [a * c - p * s, a * s + p * c, q];
    // Blade b's section at a: slot floor, top of the slot wall, inner chamfer, top, outer chamfer, foot in the disc.
    const sec = (a, b) => {
      const sl = slotHalf(a), e = edge(a), qt = qTop(a);
      return [pt(a, b * sl, qSlot), pt(a, b * sl, qt - CI), pt(a, b * (sl + CI), qt), pt(a, b * (e - CH), qt - 0.0015),
        pt(a, b * e, qt - 0.0035), pt(a, b * e, qDisc(Math.hypot(a, e)) - 0.002)];
    };
    for (const b of [-1, 1]) {
      const L = (m, up) => [-s * m, c * m, up];   // across the spoke (toward +p for m > 0), tilted up by `up`
      const faces = [[slotF, L(-b, 0)], [machF, L(-b, 1)], [spokeF, [0, 0, 1]], [machF, L(b, 1)], [spokeF, L(b, 0)]];
      for (let i = 0; i < NR; i++) {
        const A = sec(as[i], b), B = sec(as[i + 1], b);
        faces.forEach(([set, dir], f) => set.poly([A[f], A[f + 1], B[f + 1], B[f]], dir));
      }
      spokeF.poly(sec(r0, b), [-c, -s, 0]);
      spokeF.poly(sec(r1, b), [c, s, 0]);
    }
    for (let i = 0; i < NR; i++) slotF.poly([sec(as[i], -1)[0], sec(as[i], 1)[0], sec(as[i + 1], 1)[0], sec(as[i + 1], -1)[0]], [0, 0, 1]);
    for (const [a, dir] of [[r1, [-c, -s, 0]], [r0, [c, s, 0]]]) {
      const m = sec(a, -1), p = sec(a, 1);
      slotF.poly([m[0], p[0], p[1], m[1]], dir);
    }
    // The disc from this spoke to the next, out to both blades' outer edges at the same stations
    // (its first row on the hub's wall, where the broad spokes leave a sliver of disc).
    const rows = as.map((a, i) => {
      const e = edge(a), rho = i ? Math.hypot(a, e) : rHub, d = Math.atan2(e, a), q = qDisc(rho);
      const t0 = th + d, t1 = th + Math.PI / 3 - d;
      return Array.from({ length: 13 }, (_, j) => { const an = t0 + ((t1 - t0) * j) / 12; return [rho * Math.cos(an), rho * Math.sin(an), sg * q]; });
    });
    disc.push(orient(gridMesh(rows), new THREE.Vector3(0, 0, sg)));
  }
  // The T: a curved bar over a tapering stem, standing up to 2 mm off the cap's crown.
  const T = [[-0.019, 0.0125], [-0.010, 0.0168], [0, 0.0182], [0.010, 0.0168], [0.019, 0.0125], [0.0175, 0.0102], [0.0045, 0.0110],
    [0.0028, -0.0185], [0, -0.0215], [-0.0028, -0.0185], [-0.0045, 0.0110], [-0.0175, 0.0102]];
  const logo = prism(T, 0.0024);
  logo.translate(0, 0, sg * (F + 0.0057));
  return {
    disc: merge(disc),
    spokes: merge([
      spokeF.geometry(),
      revolve([[0, F + 0.006], [0.03, F + 0.0045], [0.05, F + 0.002], [rCap - 0.003, F + 0.0005], [rCap, F - 0.001]], sg, 64), // cap
      revolve([[rCap, F - 0.001], [rCap, F - 0.005]], sg, 64),
      revolve([[rCap, F - 0.005], [rHub - 0.006, F - 0.006]], sg, 64),                                  // hub ring
      revolve([[rHub - 0.006, F - 0.006], [rHub, F - 0.012]], sg, 64),
      revolve([[rHub, F - 0.012], [rHub, qDisc(rHub) - 0.003]], sg, 64),
      revolve([[rEdge, qDisc(rEdge) - 0.002], [rEdge, F]], sg),                                          // lip on the flange
      revolve([[rEdge + 0.002, F + 0.002], [rimR - 0.002, F + 0.002]], sg),
      revolve([[rimR - 0.002, F + 0.002], [rimR + 0.001, F + 0.0005], [rimR + 0.004, F - 0.005]], sg),
      revolve([[seat - 0.002, -hw * 0.905], [seat - 0.002, F - 0.045]], sg, 64),                       // barrel
      revolve([[seat - 0.002, F - 0.045], [0.072, F - 0.045]], sg, 64),                                 // back of the face
    ]),
    machined: merge([machF.geometry(), logo, revolve([[rEdge, F], [rEdge + 0.002, F + 0.002]], sg)]),
    slot: slotF.geometry(),
  };
}

/** One brake on side sg: a carbon-ceramic disc on its hat, and a caliper over the disc's edge centred at angle `at`. */
function brakeGeometry(rimR, sg, at) {
  const ro = rimR * 0.80, ri = 0.105, q0 = -0.048, q1 = -0.016;
  const rotor = merge([
    revolve([[ri, q1], [ro - 0.003, q1]], sg, 64),
    revolve([[ro - 0.003, q1], [ro, q1 - 0.003], [ro, q0 + 0.003], [ro - 0.003, q0]], sg, 64),
    revolve([[ro - 0.003, q0], [ri, q0]], sg, 64),
    revolve([[ri, q0], [ri, q1]], sg, 64),
    revolve([[0.072, 0.002], [0.100, 0.002], [0.104, -0.002], [0.104, q1]], sg, 64),   // hat
  ]);
  // Caliper: a rounded block straddling the disc, 46 deg of arc, deeper than the disc's swept face.
  const c0 = ro - 0.050, c1 = ro + 0.016, z0 = -0.062, z1 = 0.002, k = 0.006;
  const sect = [[c0 + k, z1], [c1 - k, z1], [c1, z1 - k], [c1, z0 + k], [c1 - k, z0], [c0 + k, z0], [c0, z0 + k], [c0, z1 - k]];
  const ends = facetSet(sg);
  for (const [a, m] of [[at - 0.4, -1], [at + 0.4, 1]]) ends.poly(sect.map(([r, q]) => [r * Math.cos(a), r * Math.sin(a), q]), [-Math.sin(a) * m, Math.cos(a) * m, 0]);
  const caliper = merge([revolve([...sect, sect[0]], sg, 16, at - 0.4, at + 0.4), ends.geometry()]);
  return { rotor, caliper };
}

// ---------- parts ----------
let nextId = 1;
class Part {
  constructor(name, label, desc, category) {
    this.name = name; this.label = label; this.desc = desc; this.category = category;
    this.id = nextId++;
    this.group = new THREE.Group();
    this.group.name = name;
    this.meshes = [];
    this.rest = new THREE.Vector3();
    this.explode = new THREE.Vector3();
  }
  add(geo, mat, opts = {}) {
    const m = new THREE.Mesh(geo, mat);
    if (opts.pos) m.position.set(...opts.pos);
    if (opts.rot) m.rotation.set(...opts.rot);
    m.castShadow = opts.shadow ?? true;
    m.receiveShadow = true;
    m.userData.part = this;
    m.userData.subId = opts.sub ?? this.meshes.length;
    m.name = `${this.name}:${m.userData.subId}`;
    this.meshes.push(m);
    (opts.parent || this.group).add(m);
    return m;
  }
}

// Carbon twill (2x2) as DataTextures, no DOM, so the engine can build them in Node. A tile is
// 8 tows square (`tow` pixels each); the meshes' uv is in metres, so each tow is `width` wide.
// Where the warp lies on top it runs one way, where the weft does the other: the colour gives each
// tow a rounded sheen, and the roughness map (green) makes the two directions reflect differently,
// so the twill shows in steps as the light moves. (An anisotropic highlight did this better close
// up, but sparkled on the sills and corners seen from a few metres.)
const WEAVE = { N: 64, tow: 8, width: 0.003 };
function weaveTextures() {
  const { N, tow } = WEAVE;
  const col = new Uint8Array(N * N * 4), rough = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = Math.floor(x / tow), j = Math.floor(y / tow);
    const warp = (((i - j) % 4) + 4) % 4 < 2;
    const across = warp ? (x % tow + 0.5) / tow : (y % tow + 0.5) / tow;   // across the tow on top
    const along = warp ? (y % (2 * tow) + 0.5) / (2 * tow) : (x % (2 * tow) + 0.5) / (2 * tow);
    const crown = Math.sin(across * Math.PI);
    const v = (warp ? 40 : 27) + 24 * crown * (0.75 + 0.25 * Math.sin(along * Math.PI));
    const k = (y * N + x) * 4;
    col[k] = v; col[k + 1] = v + 2; col[k + 2] = v + 5; col[k + 3] = 255;
    rough[k] = rough[k + 1] = rough[k + 2] = Math.round(255 * (warp ? 0.62 : 0.9) * (1.1 - 0.2 * crown)); rough[k + 3] = 255;
  }
  return [col, rough].map((data, n) => {
    const t = new THREE.DataTexture(data, N, N);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const tiles = 1 / ((N / tow) * WEAVE.width);   // per metre
    t.repeat.set(tiles, tiles);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 2;
    if (n === 0) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  });
}

// Perforated seat leather (cabin photo and yoke closeup: white leather pricked with small dark holes
// in a broken, scattered pattern), as a DataTexture: a 16 x 16 grid of hole sites per tile, a little
// under half of them punched, chosen by a fixed hash, so the pattern is the same on every build. The
// sites are 6 mm apart.
const PERF = { N: 64, site: 4, pitch: 0.006 };
function perforationTexture() {
  const { N, site } = PERF;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = Math.floor(x / site), j = Math.floor(y / site);
    const h = (((i * 73856093) ^ (j * 19349663)) >>> 0) % 97;
    const hole = h < 46 && (x % site) > 0 && (x % site) < 3 && (y % site) > 0 && (y % site) < 3;
    const k = (y * N + x) * 4;
    const v = hole ? [96, 98, 101] : [226, 227, 224];
    data[k] = v[0]; data[k + 1] = v[1]; data[k + 2] = v[2]; data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const tiles = 1 / ((N / site) * PERF.pitch);   // per metre
  t.repeat.set(tiles, tiles);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function materials() {
  const [weave, weaveRough] = weaveTextures();
  return {
    // Satin white: a soft base under a thin, slightly hazy clearcoat, so the panels carry broad
    // gradients and a dull sheen rather than a mirror (studio shots: lit about 0.8, shade 0.3).
    paint: new THREE.MeshPhysicalMaterial({ color: 0xdfe1de, roughness: 0.5, metalness: 0.0, clearcoat: 0.55, clearcoatRoughness: 0.22, name: 'paint' }),
    // Gold-glazed glass: near black seen through, reflecting through a bronze coating (aerial: roof
    // (63,46,30), brighter where it mirrors the sky, still bronze). No clearcoat: a second, untinted
    // reflection over the first turned it grey chrome. The coating is the reflectance of an index
    // of 2.0 (about 11 %), tinted bronze.
    glass: new THREE.MeshPhysicalMaterial({ color: 0x050403, roughness: 0.035, metalness: 0, ior: 2.0, specularIntensity: 1, specularColor: 0xffcfa0, name: 'glass' }),
    // Black plastic trim, satin: dark, but it still mirrors the room softly (the lip's nose catches a
    // broad highlight in the End photo).
    trim: new THREE.MeshPhysicalMaterial({ color: 0x0d0e0f, roughness: 0.46, metalness: 0, clearcoat: 0.1, clearcoatRoughness: 0.4, name: 'trim' }),
    // Shut-line channels and glass seals: drawn from both sides (a channel is one sheet).
    seam: new THREE.MeshStandardMaterial({ color: 0x070708, roughness: 0.7, side: THREE.DoubleSide, name: 'shut line' }),
    // Piano black: a sharp lacquer over black, which is all reflection.
    gloss: new THREE.MeshPhysicalMaterial({ color: 0x060607, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, name: 'gloss black' }),
    // Carbon: the twill under a thin coat. A full gloss coat mirrored the room so brightly that
    // the sill read light grey; the reference sill is near black (End photo: about 26/255).
    carbon: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: weave, roughness: 0.5, roughnessMap: weaveRough, clearcoat: 0.25, clearcoatRoughness: 0.12, name: 'carbon' }),
    floor: new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.8, name: 'floor' }),
    underbody: new THREE.MeshStandardMaterial({ color: 0x2c2e31, roughness: 0.55, metalness: 0.35, name: 'underbody panel' }),
    liner: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9, side: THREE.DoubleSide, name: 'liner' }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8, name: 'tyre' }),
    disc: new THREE.MeshStandardMaterial({ color: 0xd9dbda, roughness: 0.45, metalness: 0.1, name: 'wheel disc' }),
    // Wheel face: gunmetal blades, hub and rim lip; bright machined chamfers along the blade
    // edges (and the T on the cap); dark bronze inside the slot between each spoke's two blades.
    spoke: new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.36, metalness: 0.7, name: 'spoke' }),
    machined: new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.2, metalness: 1.0, name: 'spoke machined' }),
    slot: new THREE.MeshStandardMaterial({ color: 0x2a1e12, roughness: 0.35, metalness: 0.9, name: 'spoke slot' }),
    // Thruster nozzles: a brushed bronze bore (lakebed and studio rear photos), a polished lip.
    nozzle: new THREE.MeshStandardMaterial({ color: 0xa47e4a, roughness: 0.3, metalness: 1.0, side: THREE.DoubleSide, name: 'nozzle' }),
    nozzleRim: new THREE.MeshStandardMaterial({ color: 0xe4e4e2, roughness: 0.1, metalness: 1.0, name: 'nozzle rim' }),
    brake: new THREE.MeshStandardMaterial({ color: 0x5a5b5e, roughness: 0.55, metalness: 0.6, name: 'brake' }),
    caliper: new THREE.MeshStandardMaterial({ color: 0x232325, roughness: 0.4, metalness: 0.4, name: 'caliper' }),
    plate: new THREE.MeshStandardMaterial({ color: 0xe6e7e4, roughness: 0.45, metalness: 0.2, name: 'plate' }),
    // The tail light guide: saturated red. ACES pushes a bright red toward salmon, so it is drawn
    // without tone mapping and at an intensity that stays red where a composer tone-maps it anyway.
    tail: new THREE.MeshStandardMaterial({ color: 0x300004, emissive: 0xff0814, emissiveIntensity: 1.0, roughness: 0.3, toneMapped: false, name: 'tail lamp' }),
    head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.5, roughness: 0.2, name: 'head lamp' }),
    amber: new THREE.MeshStandardMaterial({ color: 0x402000, emissive: 0xff8a1a, emissiveIntensity: 1.6, name: 'repeater' }),
    marker: new THREE.MeshStandardMaterial({ color: 0x400008, emissive: 0xff1430, emissiveIntensity: 1.4, name: 'side marker' }),
    plateLamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e6, emissiveIntensity: 1.2, name: 'plate lamp' }),
    // The lamp pockets: dark and glossy, so the LED row is what you see.
    lampBay: new THREE.MeshPhysicalMaterial({ color: 0x17181b, roughness: 0.22, metalness: 0.5, clearcoat: 0.6, name: 'lamp bay' }),
    // The cabin, seen with the doors up (cabin photo, yoke closeup): dark trim on the sides and the
    // bulkhead (sheets, drawn from both sides), grey alcantara on the dash, the door tops and the yoke,
    // a lighter alcantara loop on each door card with a red ambient strip under its edges, white
    // leather seats with perforated inserts in carbon shells, black rubber door seals, a dark screen.
    interior: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.75, side: THREE.DoubleSide, name: 'interior' }),
    alcantara: new THREE.MeshStandardMaterial({ color: 0x424347, roughness: 0.95, side: THREE.DoubleSide, name: 'alcantara' }),
    alcantaraLight: new THREE.MeshStandardMaterial({ color: 0x75777b, roughness: 0.92, name: 'alcantara light' }),
    card: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.7, name: 'door card' }),
    cardInset: new THREE.MeshPhysicalMaterial({ color: 0x060607, roughness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.1, name: 'door card inset' }),
    ambient: new THREE.MeshStandardMaterial({ color: 0x300004, emissive: 0xff1426, emissiveIntensity: 1.2, toneMapped: false, name: 'ambient light' }),
    seal: new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.85, name: 'door seal' }),
    leather: new THREE.MeshPhysicalMaterial({ color: 0xd9dad8, roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.5, name: 'seat leather' }),
    perforated: new THREE.MeshStandardMaterial({ color: 0xffffff, map: perforationTexture(), roughness: 0.6, name: 'seat perforated' }),
    screen: new THREE.MeshPhysicalMaterial({ color: 0x050608, roughness: 0.08, clearcoat: 1, emissive: 0x0b1118, emissiveIntensity: 1, name: 'screen' }),
    accent: new THREE.MeshStandardMaterial({ color: 0x8c6b47, roughness: 0.3, metalness: 1.0, name: 'yoke accent' }),
    fan: new THREE.MeshStandardMaterial({ color: 0x202224, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide, name: 'fan' }),
  };
}

// Wing poses: [rise, forward, pitch] of the blade's leading edge; pitch < 0 lifts the
// trailing edge (high-downforce: trailing edge up and well behind the tail, side frame t17.5).
const WING_POSE = { road: [0, 0, 0], lowDrag: [0.065, -0.04, -0.05], highDownforce: [0.115, -0.13, -0.30] };

export function buildVehicle() {
  nextId = 1;
  const M = materials();
  const root = new THREE.Group();
  root.name = 'roadster';
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);
  const parts = {}, order = [];
  const P = (name, label, desc, category, parent = body) => {
    const p = new Part(name, label, desc, category);
    parts[name] = p; order.push(p); parent.add(p.group);
    return p;
  };

  // --- shell: everything white outside the doors ---
  const shellP = P('body', 'BODY', 'Satin white shell: fenders, hood, haunches, sails and tail, one lofted surface', 'shell');
  const half = GAP / 2;
  const white = [], fillets = [];
  const take = (list) => { const [panels, strips] = unfillet(list); white.push(...panels); fillets.push(...strips); };
  const round = (...at) => ({ fillet: { at, w: FILLET } });
  // Body side behind the door (u3..u4), around the wing's end plate; the haunch top ahead of the
  // wing, in one band with the side below it so the shoulder (u4) is sampled alike on both sides.
  white.push(...archBand(3, EP_U0, (u) => XR_END(u), (u) => DOOR_R(u) - half));
  white.push(...band(EP_U0, EP_U1, (u) => XR_END(u), (u) => EP_R(u) - half));
  take(archBand(EP_U0, 5, (u) => (u < 4 ? EP_F(u) : WING_X0) + half, (u) => DOOR_R(u) - half, round(4)));
  // Body side and fender ahead of the door, to the front corner: shoulder and ridge rounded.
  take(archBand(3, 5, (u) => DOOR_F(u) + half, X_CORNER, round(4, 5)));
  // Fender inner facet: from the A-pillar glass to the lamp pocket.
  take(band(5, U6_LO, (u) => APIL(u) + half, (u) => X_TRI(u), { ...round(5), nu: 5 }));
  // Sails behind the quarter glass, ahead of the wing, and the strip over the quarter glass.
  white.push(...band(5, QG_TOP, WING_X0 + half, (u) => QTIP(u)));
  white.push(...band(QG_TOP, U6_LO, WING_X0 + half, (u) => DOOR_R(u) - half, { nu: 4 }));
  // Hood: cowl panel and front lid either side of the shut line.
  white.push(...band(U6_HI, 7, (u) => COWL(u) + half, (u) => HOOD_SL(u) - half, { nu: 10, nx: 16 }));
  white.push(...band(U6_HI, 7, (u) => HOOD_SL(u) + half, (u) => XEND_HOOD(u), { nu: 12, nx: 40 }));
  // Under the lines where two differently sampled panels meet: the ridge, the haunch top's inner
  // edge, the sail under the strip over the quarter glass, the side under the end plate's foot.
  white.push(
    creaseBacking(5, APIL(5), X_TRI(5)), creaseBacking(5, WING_X0, QTIP(5)),
    creaseBacking(QG_TOP, WING_X0, QTIP(QG_TOP)), creaseBacking(EP_U0, XR_END(EP_U0), DOOR_R(EP_U0)),
  );
  shellP.add(merge(white), M.paint, { sub: 0 });
  // The shut lines' channels: hood, hood/fender (and the fender facet under the windscreen's
  // corner), the door's front, rear and bottom, the deck line, the end plate's front and its foot.
  shellP.add(merge([
    seamX(HOOD_SL, 6, 7),
    seamU(U6_LO, U6_HI, APIL(6), X_CORNER),
    seamX(DOOR_F, 3, 5),
    seamX(DOOR_R, 3, 6),
    seamU(3, U3_DOOR, DOOR_R(3), DOOR_F(3)),
    seamX(() => WING_X0, 4, 7, { depth: 0.002 }),   // shallow: it crosses the side outline's top, and the deck beneath is dark anyway
    seamX(EP_F, EP_U0, 4),
    seamX(EP_R, EP_U0, EP_U1),
  ]), M.seam, { sub: 1 });
  // Rounded creases: narrow strips whose normals turn through the crease (a highlight, not a knife edge).
  shellP.add(merge(fillets), M.paint, { sub: 5 });

  // --- black lower body: sills (u2..u3) and the carbon behind the rear wheels ---
  const clad = P('cladding', 'SILL AND LOWER BODY', 'Black sill band, taller toward the rear; carbon behind the rear wheels', 'shell');
  // The carbon runs from the tail round the rear arch to the arch's front end, the black sill from there on.
  // Both carbon (front-wheel closeup: the twill runs the length of the sill).
  clad.add(merge(archBand(2, 3, ARCH_CUTS[1], X_CORNER, { nu: 3 })), M.carbon, { sub: 0 });
  clad.add(merge(archBand(2, 3, (u) => XR_END(u), ARCH_CUTS[1], { nu: 3 })), M.carbon, { sub: 1 });
  // Behind each rear wheel, just under the crease: a red side marker at the carbon's top front
  // corner (side frame: (-1.78, 0.62)) and a short vent behind it along the top edge, dark with
  // three louvres (rear-wheel closeup). Laid on the carbon a hair proud of it.
  const onClad = (x, y, off, sg) => { const [z, yy] = surfOff(x, uAtY(x, y, 2), off); return [x, yy, sg * z]; };
  const crease = (x) => yAt(x, 3);
  const VENT = { x0: -1.866, x1: -1.806, lo: 0.030, hi: 0.009, n: 8 };
  const ventRows = (d0, d1, o0, o1, sg) => [[d0, o0], [d1, o1]].map(([d, o]) => Array.from({ length: VENT.n + 1 }, (_, i) => {
    const x = lerp(VENT.x0, VENT.x1, i / VENT.n);
    return onClad(x, crease(x) - d, o, sg);
  }));
  for (const sg of [1, -1]) {
    const mx = -1.78, my = crease(mx) - 0.012, [mz, myy] = surfOff(mx, uAtY(mx, my, 2), 0.003);
    clad.add(new THREE.BoxGeometry(0.040, 0.010, 0.006), M.marker, { pos: [mx, myy, sg * mz], sub: sg > 0 ? 2 : 3, shadow: false });
    clad.add(orient(gridMesh(ventRows(VENT.lo, VENT.hi, 0.0008, 0.0008, sg)), new THREE.Vector3(0, 0, sg)), M.seam, { sub: sg > 0 ? 4 : 5, shadow: false });
    const louvres = [0, 1, 2].map((k) => {
      const d = lerp(VENT.hi + 0.003, VENT.lo - 0.002, k / 2);
      return orient(gridMesh(ventRows(d, d - 0.004, 0.004, 0.0012, sg)), new THREE.Vector3(0, -1, sg));   // tipped out at the bottom
    });
    clad.add(merge(louvres), M.trim, { sub: sg > 0 ? 6 : 7, shadow: false });
  }
  // The sills' tops, seen with the doors up: carbon, from the lower crease (in the door's bottom shut
  // line's channel) in and up to a ridge, then down to the cabin floor, from the bulkhead to the front
  // wells; and the front jamb's foot, where the door's bottom corner is lowest (under the pack's top,
  // so not the interior's).
  const sillXs = linspace(XBULK(CAB.floor) - 0.01, XWELL - 0.002, 24);
  clad.add(merge([1, -1].flatMap((sg) => [
    orient(gridMesh(sillXs.map((x) => { const [z, y] = surfOff(x, 3, -CHANNEL); return [[x, y, sg * z], [x, CAB.sillY, sg * CAB.sillZ], [x, CAB.floor, sg * CAB.sillZ]]; })), new THREE.Vector3(0, 1, -sg)),
    orient(jamb((u) => DOOR_F(u) + GAP / 4, 3, 3.06, sg), new THREE.Vector3(-1, 0, 0)),
  ])), M.carbon, { sub: 8 });

  // --- floor ---
  // Flat at the u0 height between the sills (underside footage: a panel grid, a centre rib, straight
  // sills): a satin battery cover over the pack's plan with a rib down its middle, framed by darker
  // cross panels and sill strips, its seams recessed 1 mm so nothing hangs below the floor; narrower
  // floor between each pair of wheel wells, with a subframe under the axle (above the tyres' outline
  // in side view); undertrays ahead of the front wells and behind the rear ones. The u1..u2 band is
  // the sill's underside corner and, round each arch, the arch's inward flange. It casts a shadow:
  // the shell's single-sided panels mostly do not, so without it the ground shadow has lit holes.
  const floor = P('floor', 'UNDERBODY', 'Flat underbody: satin battery cover with a centre rib in a darker frame, floor between the wheel wells with a subframe under each axle, undertrays at both ends', 'chassis');
  const XC0 = -0.94, XC1 = 0.99, ZCV = 0.66;     // battery cover (pack plan: x -0.92..1.04, half width 0.685)
  const floorEdge = (x) => HWB(x) - 0.07;         // u1
  floor.add(merge([
    ...archBand(1, 2, (u) => XR_END(u), X_CORNER, { nu: 3 }),
    ...band(0, 1, (u) => XR_END(u), S.XR - WELL_HALF.R, { nu: 3, nx: 12 }),
    ...band(0, 1, S.XF + WELL_HALF.F, X_CORNER, { nu: 3, nx: 16 }),
    ...floorPanel(S.XR - WELL_HALF.R, S.XR + WELL_HALF.R, 0, WELL_IN.R, { nx: 16 }),
    ...floorPanel(S.XF - WELL_HALF.F, S.XF + WELL_HALF.F, 0, WELL_IN.F, { nx: 16 }),
    ...floorPanel(S.XR + WELL_HALF.R, XC0, 0, floorEdge, { nx: 2, nz: 6 }),
    ...floorPanel(XC1, S.XF - WELL_HALF.F, 0, floorEdge, { nx: 2, nz: 6 }),
    ...floorPanel(XC0, XC1, ZCV + 0.008, floorEdge, { nx: 24 }),
  ]), M.floor, { sub: 0 });
  floor.add(merge([
    ...floorPanel(XC0 + 0.008, XC1 - 0.008, 0.022, ZCV, { nx: 8 }),
    ...floorPanel(XC0 + 0.008, XC1 - 0.008, -0.014, 0.014, { nx: 8, nz: 1, sides: [1] }),
  ]), M.underbody, { sub: 1 });
  const seams = [
    ...floorPanel(XC0 - 0.002, XC0 + 0.010, 0, ZCV + 0.010, { dy: 0.001, nx: 1 }),
    ...floorPanel(XC1 - 0.010, XC1 + 0.002, 0, ZCV + 0.010, { dy: 0.001, nx: 1 }),
    ...floorPanel(XC0, XC1, ZCV - 0.002, ZCV + 0.010, { dy: 0.001, nx: 4, nz: 1 }),
    ...floorPanel(XC0, XC1, 0.012, 0.024, { dy: 0.001, nx: 4, nz: 1 }),
  ];
  for (const [xc, hz] of [[S.XF + 0.03, 0.42], [S.XR - 0.03, 0.50]]) {
    const g = new THREE.BoxGeometry(0.44, 0.018, 2 * hz);
    g.translate(xc, ZB(xc) - 0.007, 0);
    seams.push(g);
  }
  floor.add(merge(seams), M.trim, { sub: 2 });

  // --- greenhouse: canopy, quarter glass, rear glass ---
  const gh = P('greenhouse', 'GLASS CANOPY', 'Dark bronze glazed canopy: windscreen, A-pillar glass, centre spine, roof and rear glass, framed by black seals', 'shell');
  // Fixed glass: the windscreen ahead of the header, the centre spine between the doors' roof
  // panels, the roof and rear glass behind the B line, and the A-pillar glass ahead of each door.
  gh.add(merge([
    ...band(U6_HI, 7, DOOR_ROOF_F + half, (u) => COWL(u) - half, { nu: 10, nx: 40 }),
    ...band(SPINE_HI, 7, DOOR_ROOF_R + half, DOOR_ROOF_F - half, { nu: 4, nx: 24 }),
    ...band(U6_HI, 7, GLASS_END + half, DOOR_ROOF_R - half, { nu: 10, nx: 36 }),
    ...band(U5_AGLASS, U6_LO, (u) => ADIAG(u) + half, (u) => APIL(u) - half, { nu: 6, nx: 24 }),
  ]), M.glass, { sub: 0 });
  // Quarter glass: behind the B line to its point.
  gh.add(merge(band(5, QG_TOP, (u) => QTIP(u), (u) => DOOR_R(u) - half, { nu: 4, nx: 24 })), M.glass, { sub: 1 });
  // Black seals between the panes (aerial): the windscreen's header, base and sides, the B line
  // over the roof, the spine's two edges, the A-pillar glass's edges, the rear glass's sides.
  gh.add(merge([
    seamX(() => DOOR_ROOF_F, 6, 7, { depth: SEAL }),
    seamX(() => DOOR_ROOF_R, 6, 7, { depth: SEAL }),
    seamX(COWL, 6, 7, { depth: SEAL }),
    seamU(SPINE_LO, SPINE_HI, DOOR_ROOF_R, DOOR_ROOF_F, { depth: SEAL }),
    seamU(U6_LO, U6_HI, DOOR_ROOF_F, APIL(6), { depth: SEAL }),
    seamU(U6_LO, U6_HI, GLASS_END, DOOR_ROOF_R, { depth: SEAL }),
    seamX(ADIAG, 5, 6, { depth: SEAL }),
    seamX(APIL, 5, 6, { depth: SEAL }),
    seamU(5, U5_AGLASS, ADIAG(5), APIL(5), { depth: SEAL }),
  ]), M.seam, { sub: 2 });

  // --- doors (gull-wing): body side + side glass between the shut lines ---
  // Skin, the roof rail along the top of the side glass, the side glass in two panes, the panel of
  // roof glass up to the spine; seals between them; the shoulder rounded.
  const doors = [];
  const SIDE_GLASS = [[(u) => DOOR_R(u) + half, (u) => B2(u) - half], [(u) => B2(u) + half, (u) => ADIAG(u) - half]];
  const ROOF_GLASS = [SPINE_LO, DOOR_ROOF_R + half, DOOR_ROOF_F - half];
  for (const [name, sg] of [['doorFL', -1], ['doorFR', 1]]) {
    const dp = P(name, sg < 0 ? 'LEFT DOOR' : 'RIGHT DOOR', 'Gull-wing door: skin, roof rail and frameless glass, hinged near the roof centre', 'shell');
    // The hinge runs along the door's own top edge, near the roof centre, so the
    // door swings up about the line it already shares with the fixed roof.
    const xm = (DOOR_ROOF_F + DOOR_ROOF_R) / 2;
    const [hz, hy] = surface(xm, DOOR_TOP);
    const hinge = new THREE.Vector3(xm, hy, sg * hz);
    dp.hinge = hinge;
    dp.group.position.copy(hinge);
    const toHinge = (g) => g.translate(-hinge.x, -hinge.y, -hinge.z);
    const DR = (u) => DOOR_R(u) + half, DF = (u) => DOOR_F(u) - half;
    const [skinPanels, skinRound] = unfillet(band(U3_DOOR, 5, DR, DF, { side: sg, nx: 28, ...round(4) }));
    const rail = band(RAIL_LO, U6_LO, DR, (u) => ADIAG(u) - half, { side: sg, nu: 2, nx: 28 });
    dp.add(toHinge(merge([...skinPanels, ...rail])), M.paint, { sub: 0 });
    const glass = merge([
      ...SIDE_GLASS.flatMap(([a, b]) => band(5, SIDE_TOP, a, b, { side: sg, nx: 14 })),
      ...band(U6_HI, ROOF_GLASS[0], ROOF_GLASS[1], ROOF_GLASS[2], { side: sg, nu: 6, nx: 24 }),
    ]);
    dp.add(toHinge(glass), M.glass, { sub: 1 });
    // The door's inside: the door card DOOR_T in from the skin and the rail's underside (the card's
    // trim, seals and window frame are the interior's, hung on this door below); the glass seen from
    // within; the door's edges, in the body colour, so a raised door reads as a door, not a sheet.
    const DT = DOOR_T;
    const inner = merge([
      ...band(U3_DOOR, 5, DR, DF, { side: sg, nx: 28, off: -DT, flip: true }),
      ...band(RAIL_LO, U6_LO, DR, (u) => ADIAG(u) - half, { side: sg, nu: 2, nx: 28, off: -0.004, flip: true }),
    ]);
    dp.add(toHinge(inner), M.card, { sub: 2 });
    const glassIn = merge([
      ...SIDE_GLASS.flatMap(([a, b]) => band(5, SIDE_TOP, a, b, { side: sg, nx: 14, off: -0.004, flip: true })),
      ...band(U6_HI, ROOF_GLASS[0], ROOF_GLASS[1], ROOF_GLASS[2], { side: sg, nu: 6, nx: 24, off: -0.004, flip: true }),
    ]);
    dp.add(toHinge(glassIn), M.glass, { sub: 3 });
    // Seals on the door: under the rail's two edges and between the panes; a dark ribbon under
    // the belt, where the skin and the glass meet with different sampling.
    const xs = (u) => [DOOR_R(u), ADIAG(u)];
    dp.add(toHinge(merge([
      seamU(SIDE_TOP, RAIL_LO, ...xs((SIDE_TOP + RAIL_LO) / 2), { depth: SEAL, side: sg }),
      seamU(U6_LO, U6_HI, DOOR_ROOF_R, DOOR_ROOF_F, { depth: SEAL, side: sg }),
      seamX(B2, 5, SIDE_TOP, { depth: SEAL, side: sg }),
      creaseBacking(5, DR(5), ADIAG(5) - half, { side: sg }),
    ])), M.seam, { sub: 4 });
    dp.add(toHinge(merge(skinRound)), M.paint, { sub: 5 });
    dp.add(toHinge(merge([
      wall(pathX(DR, U3_DOOR, 5, 16), 0, -DT, { side: sg, face: new THREE.Vector3(-1, 0, 0) }),
      wall(pathX(DF, U3_DOOR, 5, 16), 0, -DT, { side: sg, face: new THREE.Vector3(1, 0, 0) }),
      wall(pathU(U3_DOOR, DR(U3_DOOR), DF(U3_DOOR), 20), 0, -DT, { side: sg, face: new THREE.Vector3(0, -1, 0) }),
    ])), M.paint, { sub: 6 });
    doors.push({ part: dp, sg });
  }

  // --- front fascia: light bar on the hood's curved front edge, the face, the lip, lamp pockets ---
  // Front studio photos (Carousel 1, End): under the light bar a carbon panel down to a horizontal
  // ledge; under the ledge the intake, open and dark, with a sensor hanging at its centre and two
  // dividers inside; at the bottom a thick lip with a rounded nose that runs the full width and
  // wraps back under the fender corners. Side outline (nose face): the face rakes from 2.268 at
  // 0.49 to 2.243 at 0.30, the lip's nose reaches 2.281 at 0.21 and its top ramps back up into the
  // intake; underneath it rises from 0.187 at x 2.15 to 0.198 at 2.20.
  const ff = P('fasciaFront', 'FRONT FASCIA', 'Light bar along the curved nose edge, carbon face over an open intake with a centre sensor, a full-width lip wrapping under the corners, triangular pop-up lamp pockets with LED rows', 'shell');
  // The hood's front edge, sampled across the full width (u 6 -> 7 -> 6 mirrored).
  const NE = 40, edge = [];
  for (let i = -NE; i <= NE; i++) {
    const u = 7 - Math.abs(i) / NE, x = XEND_HOOD(u), [z, y] = surface(x, u);
    edge.push([x, y, Math.sign(i) * z]);
  }
  // Out past the corners under the fender front edges, so the face meets them with overlap.
  const zc = edge[0][2], xc = edge[0][0], yc = edge[0][1];
  const faceEdge = [[xc - 0.006, yc, zc - 0.006], ...edge, [xc - 0.006, yc, -zc + 0.006]];
  const FACE_BOT = 0.200, FACE_RAKE = 0.045;
  // The face is ruled down from the hood edge, raked back FACE_RAKE by FACE_BOT: the point under
  // edge point p at height y, and the edge point at half-width z (the edge is curved in plan).
  const onFace = ([x, y0, z], y) => [x - (FACE_RAKE * (y0 - 0.001 - y)) / (y0 - 0.001 - FACE_BOT), y, z];
  const edgeAt = (z) => {
    let a = 6, b = 7;
    for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (surface(XEND_HOOD(m), m)[0] > Math.abs(z)) a = m; else b = m; }
    const u = (a + b) / 2, [, y] = surface(XEND_HOOD(u), u);
    return [XEND_HOOD(u), y, z];
  };
  const Y_LEDGE = 0.375, LEDGE = 0.014;   // the carbon panel's bottom edge and its thickness there
  const INTAKE_HW = 0.54, X_BACK = 2.125;  // the intake's half-width and its back wall
  const LIP_TOP = 0.255;                   // the lip's top where it passes under the face
  const zs = (z0, z1, n) => Array.from({ length: n + 1 }, (_, i) => lerp(z0, z1, i / n));
  // Light bar: a thin emissive line just under the hood edge, 2 mm proud of the face.
  const barRow = (dy) => edge.map((p) => { const [x, y, z] = onFace(p, p[1] - 0.001 - dy); return [x + 0.002, y, z]; });
  ff.add(gridMesh([barRow(0.006), barRow(0.020)], { flip: true }), M.head, { sub: 0, shadow: false });
  // Carbon: the panel from the light bar to the ledge, its underside back to the ledge's depth,
  // and the pillars either side of the intake down to the lip.
  const ledge = faceEdge.map((p) => onFace(p, Y_LEDGE));
  const FACE_HW = Math.abs(zc) + 0.006;
  const pillar = (sg) => {
    const z4 = zs(sg * INTAKE_HW, sg * FACE_HW, 4);
    return gridMesh([0, 0.5, 1].map((k) => z4.map((z) => onFace(edgeAt(z), lerp(Y_LEDGE, LIP_TOP - 0.03, k)))), { flip: sg > 0 });
  };
  ff.add(merge([
    gridMesh([0, 0.25, 0.5, 0.75, 1].map((k) => faceEdge.map((p) => onFace(p, lerp(p[1] - 0.001, Y_LEDGE, k)))), { flip: true }),
    gridMesh([ledge, ledge.map(([x, y, z]) => [x - LEDGE, y, z])], { flip: true }),
    pillar(1), pillar(-1),
  ]), M.carbon, { sub: 1 });
  // The intake, dark inside: its ceiling behind the ledge, the back wall, the side walls and two
  // dividers standing back from the face.
  const zIn = zs(-INTAKE_HW, INTAKE_HW, 24);
  const frontX = (z, y) => onFace(edgeAt(z), y)[0];
  const intake = [
    orient(gridMesh([zIn.map((z) => [frontX(z, Y_LEDGE) - LEDGE, Y_LEDGE, z]), zIn.map((z) => [X_BACK, Y_LEDGE, z])]), new THREE.Vector3(0, -1, 0)),
    orient(gridMesh([zIn.map((z) => [X_BACK, Y_LEDGE, z]), zIn.map((z) => [X_BACK, LIP_TOP - 0.01, z])]), new THREE.Vector3(1, 0, 0)),
    // Its floor, where the lip thins toward the corners.
    orient(gridMesh([zIn.map((z) => [X_BACK, LIP_TOP - 0.01, z]), zIn.map((z) => [frontX(z, LIP_TOP), LIP_TOP - 0.01, z])]), new THREE.Vector3(0, 1, 0)),
  ];
  for (const sg of [1, -1]) {
    const z = sg * INTAKE_HW, ys = [Y_LEDGE, LIP_TOP];
    intake.push(gridMesh(ys.map((y) => [[X_BACK, y, z], [frontX(z, y), y, z]]), { both: true }));
    const d = prism([[X_BACK, 0.27], [frontX(sg * 0.30, 0.27) - 0.03, 0.27], [frontX(sg * 0.30, Y_LEDGE) - 0.03, Y_LEDGE], [X_BACK, Y_LEDGE]], 0.008);
    d.translate(0, 0, sg * 0.30);
    intake.push(d);
  }
  ff.add(merge(intake), M.trim, { sub: 2 });
  // The lip: one section swept along its nose line in plan, which follows the light bar's curve
  // to the face's corners and then bends back under each fender corner, just outboard of the
  // sill's bottom corner, to 1.87. Full depth under the intake, it thins to a blade at the sides.
  const lipX = (z) => S.NOSE - 0.108 * (z / 0.591) ** 2;   // the nose tip is the front overhang's end
  const sideZ = (x) => HWB(x) + 0.006;     // 6 mm outboard of the sill's bottom corner
  const P0 = [lipX(0.50), 0.50], d0 = [-2 * 0.108 * 0.50 / 0.591 ** 2, 1];
  const P2 = [2.02, sideZ(2.02)], d2 = [1, (sideZ(2.021) - sideZ(2.019)) / 0.002];
  const C = meetLines(P0, d0, P2, d2);
  const lipHalf = [
    ...zs(0, P0[1], 24).map((z) => [lipX(z), z]),
    ...Array.from({ length: 20 }, (_, i) => { const t = (i + 1) / 20; return [0, 1].map((k) => (1 - t) ** 2 * P0[k] + 2 * t * (1 - t) * C[k] + t * t * P2[k]); }),
    ...zs(2.02, 1.87, 8).slice(1).map((x) => [x, sideZ(x)]),
  ];
  const lipPath = [...lipHalf.slice(1).reverse().map(([x, z]) => [x, -z]), ...lipHalf];
  ff.add(lipGeometry(lipPath, (x, z) => smooth(0.40, 0.70, Math.abs(z))), M.trim, { sub: 3 });
  // Lamp pockets: the triangle of the fender's inner facet ahead of X_TRI is sunk LAMP_DEPTH
  // (the pop-up cover retracted into it): a dark gloss bay, and across the top of its rear wall a
  // row of seven LED emitters facing forward (front studio photo), one mesh per side.
  const tri = (u) => X_TRI(u);
  ff.add(merge(band(5, 6, tri, X_CORNER, { off: -LAMP_DEPTH, nx: 16, spread: uniform })), M.lampBay, { sub: 4 });
  ff.add(merge([
    wall(pathX(tri, 5, 6), 0, -LAMP_DEPTH),
    wall(pathU(5, X_TRI(5), X_CORNER, 16), 0, -LAMP_DEPTH),
    wall(pathU(6, X_TRI(6), X_CORNER, 16), 0, -LAMP_DEPTH),
  ]), M.lampBay, { sub: 5 });
  for (const sg of [1, -1]) {
    const leds = [];
    for (let k = 0; k < 7; k++) {
      const uc = lerp(5.16, 5.84, k / 6), du = 0.035;
      leds.push(wall(pathX((u) => X_TRI(u) + 0.0015, uc - du, uc + du, 2), -0.005, -0.013, { side: sg }));
    }
    ff.add(merge(leds), M.head, { sub: sg > 0 ? 6 : 7, shadow: false });
  }
  // The sensor under the ledge at the centre: a small gloss pod with its lens facing forward.
  const sx = frontX(0, Y_LEDGE) - 0.012;
  const pod = prism([[-0.034, 0], [0.034, 0], [0.038, -0.012], [0.030, -0.024], [-0.030, -0.024], [-0.038, -0.012]], 0.030);
  pod.rotateY(Math.PI / 2);
  pod.translate(sx - 0.015, Y_LEDGE - 0.0005, 0);
  const lens = new THREE.CylinderGeometry(0.0075, 0.0085, 0.006, 20);
  lens.rotateZ(Math.PI / 2);
  lens.translate(sx + 0.002, Y_LEDGE - 0.0125, 0);
  ff.add(merge([pod, lens]), M.gloss, { sub: 8 });

  // --- rear fascia: lamp band, bumper blade, plate pocket, diffuser, nozzles, fans ---
  // Studio and lakebed rear photos: under the deck's thin white lip, a gloss-black band carrying one
  // thick red light guide whose ends wrap round the corners; a white bumper blade; the plate (raised
  // rim, RDSTR) in its pocket with two lamps and a camera above it; then the diffuser, recessed: a
  // carbon beam over the nozzle row, round ducts between the nozzles, a shelf, the fan bays between
  // strakes, and big carbon end-plate legs down to the ground.
  const fr = P('fasciaRear', 'REAR FASCIA', 'Gloss-black lamp band with a red light guide under the deck lip, white bumper blade, RDSTR plate with lamps and camera, carbon diffuser: beam, ducts, strakes and end-plate legs', 'shell');
  const tx = XEND_R;
  const bumperY = 0.53; // nozzles (0.47) sit in the dark diffuser below this line
  // Plate pocket: a concave pill-shaped recess in the tail face around the plate.
  const PK = { y: 0.632, r: 0.082, a: 0.47, depth: 0.040 };
  const stadium = [];
  const NS = 40;
  for (let i = 0; i < NS; i++) {
    // boundary walked counter-clockwise in (z, y): right end cap, top, left end cap, bottom
    const t = i / NS, ang = t * 2 * Math.PI;
    const zz = Math.cos(ang) >= 0 ? PK.a + PK.r * Math.cos(ang) : -PK.a + PK.r * Math.cos(ang);
    stadium.push([zz, PK.y + PK.r * Math.sin(ang)]);
  }
  const pocketAt = (k) => [...stadium, stadium[0]].map(([zz, yy]) => {
    const cz = Math.max(-PK.a, Math.min(PK.a, zz));
    const z = cz + (zz - cz) * (1 - k), y = PK.y + (yy - PK.y) * (1 - k);
    return [faceX(y) + PK.depth * (1 - (1 - k) ** 2), y, z];
  });
  fr.add(gridMesh([0, 1, 2, 3, 4, 5, 6].map((j) => pocketAt(j / 6)), { flip: true }), M.paint, { sub: 9 });
  // The tail face above the diffuser, with the pocket cut out of it.
  shellP.add(endCap((u) => XR_END(u), -1, 7, ([, y]) => y - bumperY, [stadium.slice().reverse()], faceX), M.paint, { sub: 3 });
  // The plate: a 305 x 152 panel with a raised rim and raised RDSTR, at the pocket's floor.
  const xp = faceX(PK.y) + PK.depth - 0.008, PW = 0.1525, PH = 0.076, rc = 0.012;
  const rounded = (w, h, r) => {
    const pts = [];
    for (const [cx, cy, a0] of [[w - r, h - r, 0], [-w + r, h - r, 90], [-w + r, -h + r, 180], [w - r, -h + r, 270]]) {
      for (let k = 0; k <= 4; k++) { const t = ((a0 + (k * 90) / 4) * Math.PI) / 180; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
    }
    return pts;
  };
  // The letters are dark on the white plate (Social, studio rear: a grey RDSTR), so the legend
  // reads by colour, not only by its shading.
  const plateParts = [prism(rounded(PW, PH, rc), 0.006)], legend = [];
  const rim = new THREE.Shape(rounded(PW, PH, rc).map(([a, c]) => new THREE.Vector2(a, c)));
  rim.holes.push(new THREE.Path(rounded(PW - 0.006, PH - 0.006, rc - 0.005).reverse().map(([a, c]) => new THREE.Vector2(a, c))));
  const rimG = new THREE.ExtrudeGeometry(rim, { depth: 0.0018, bevelEnabled: false });
  rimG.clearGroups();
  rimG.translate(0, 0, 0.003);
  plateParts.push(rimG);
  const word = 'RDSTR', LW = 0.040, LH = 0.064, GAPW = 0.016;
  word.split('').forEach((ch, i) => {
    const x0 = -((word.length * LW + (word.length - 1) * GAPW) / 2) + i * (LW + GAPW);
    for (const bar of strokes(GLYPHS[ch], LW, LH, 0.0085, 0.0014)) { bar.translate(x0, -LH / 2, 0.0037); legend.push(bar); }
  });
  const toTail = (g) => { g.rotateY(-Math.PI / 2); g.translate(xp, PK.y, 0); return g; };   // its face (local +z) toward the rear (-x)
  fr.add(toTail(merge(plateParts)), M.plate, { sub: 6 });
  fr.add(toTail(merge(legend)), M.trim, { sub: 13 });
  // Over the plate, under the pocket's top edge: the camera, and a lamp either side of it.
  const kTop = 0.16, [cx, cy] = pocketAt(kTop).find(([, , z]) => Math.abs(z) < 1e-9) || [faceX(0.70) + 0.01, 0.70];
  const cam = prism([[-0.017, 0.006], [0.017, 0.006], [0.020, -0.006], [0.014, -0.012], [-0.014, -0.012], [-0.020, -0.006]], 0.026);
  cam.rotateY(-Math.PI / 2);
  cam.translate(cx - 0.004, cy - 0.006, 0);
  const camLens = new THREE.CylinderGeometry(0.0055, 0.0065, 0.004, 18);
  camLens.rotateZ(Math.PI / 2);
  camLens.translate(cx - 0.0185, cy - 0.009, 0);
  fr.add(merge([cam, camLens]), M.gloss, { sub: 12 });
  const plateLamps = [-1, 1].map((sg) => { const g = new THREE.BoxGeometry(0.018, 0.004, 0.024); g.translate(cx - 0.006, cy + 0.001, sg * 0.058); return g; });
  fr.add(merge(plateLamps), M.plateLamp, { sub: 11, shadow: false });
  // The diffuser is recessed 100 mm under the bumper: a carbon back face, with the fan wells and
  // the ducts cut through it.
  const REC = 0.10, FAN_Y = 0.30, FAN_Z = [-0.43, -0.145, 0.145, 0.43], FAN_R = 0.09;
  const NOZ_Y = 0.47, DUCT_Z = [-0.48, -0.24, 0, 0.24, 0.48], DUCT_R = 0.028;
  const circle = (zc0, yc0, r, n = 28) => Array.from({ length: n }, (_, i) => { const t = (-i / n) * 2 * Math.PI; return [zc0 + r * Math.cos(t), yc0 + r * Math.sin(t)]; });
  const holes = [...FAN_Z.map((z) => circle(z, FAN_Y, FAN_R + 0.004, 40)), ...DUCT_Z.map((z) => circle(z, NOZ_Y, DUCT_R - 0.0005))];   // each closed by its bell or tube
  fr.add(endCap(tx + REC, -1, 7, ([, y]) => bumperY - y, holes), M.carbon, { sub: 0 });
  // Carbon: the beam over the nozzle row (proud of the white face above it), the shelf under the
  // nozzle row, the strakes between the fan bays.
  const DW = 0.63;   // the diffuser's half-width, inside the legs
  const slab = (sec, z0, z1) => { const g = prism(sec, z1 - z0); g.translate(0, 0, (z0 + z1) / 2); return g; };
  const beam = slab([[tx + REC, 0.506], [tx + 0.018, 0.506], [tx + 0.010, 0.514], [tx + 0.010, 0.532], [tx + 0.016, 0.538], [tx + REC, 0.538]], -DW, DW);
  const shelf = slab([[tx + REC, 0.404], [tx + 0.04, 0.404], [tx + 0.032, 0.410], [tx + 0.04, 0.416], [tx + REC, 0.416]], -DW, DW);
  const strk = [-0.575, -0.2875, 0, 0.2875, 0.575].map((z) => slab([[tx + REC, 0.405], [tx + 0.035, 0.405], [tx + 0.012, ZB(tx) + 0.012], [tx + REC, ZB(tx + REC) + 0.004]], z - 0.005, z + 0.005));
  fr.add(merge([beam, shelf, ...strk]), M.carbon, { sub: 8 });
  // The ducts between the nozzles: dark round tubes into the body, each closed at its far end.
  const ducts = DUCT_Z.flatMap((z) => {
    const tube = revolve([[DUCT_R, 0], [DUCT_R, 0.07]], 1, 24), end = revolve([[DUCT_R, 0.07], [0, 0.07]], 1, 24);
    return [tube, end].map((g) => g.rotateY(Math.PI / 2).translate(tx + REC, NOZ_Y, z));   // q runs forward, into the body
  });
  fr.add(merge(ducts), M.liner, { sub: 7 });
  // End-plate legs: thick carbon plates either side of the diffuser, from the beam's ends down
  // along the raked tail line to the ground, their bottom edge on the measured rear-overhang
  // underside (side frame: 0.16-0.20 at x -1.79..-1.92); behind the tyre they bow outward at the
  // foot (lakebed rear photo).
  const legs = [];
  const legFront = (y) => (y < 0.24 ? tx + 0.32 : lerp(tx + 0.32, tx + 0.12, (y - 0.24) / (0.52 - 0.24)));
  const legRear = (y) => (y >= 0.22 ? faceX(y) : y >= 0.192 ? lerp(faceX(0.22) + 0.05, faceX(0.22), (y - 0.192) / 0.028) : lerp(tx + 0.32, faceX(0.22) + 0.05, (y - 0.165) / 0.027));
  const legZ = (x, y) => 0.647 + 0.03 * smooth(0.36, 0.18, y) * smooth(-1.84, -1.94, x);
  const LT = 0.009, LN = 26, LM = 10;
  for (const sg of [-1, 1]) {
    // Rows of constant height, with one at each corner of the outline so its edges stay straight.
    const ys = [...new Set([...Array.from({ length: LN + 1 }, (_, i) => lerp(0.165, bumperY - 0.006, i / LN)), 0.192, 0.22, 0.24].map((y) => +y.toFixed(6)))].sort((p, q) => p - q);
    const rowsAt = (side) => ys.map((y) => {
      const xf = legFront(y), xr = Math.min(legRear(y), xf);
      return Array.from({ length: LM + 1 }, (_, j) => { const x = lerp(xf, xr, j / LM); return [x, y, sg * (legZ(x, y) + side * LT)]; });
    });
    const out = rowsAt(1), inn = rowsAt(-1);
    legs.push(orient(gridMesh(out), new THREE.Vector3(0, 0, sg)), orient(gridMesh(inn), new THREE.Vector3(0, 0, -sg)));
    legs.push(orient(gridMesh([out.map((r) => r[0]), inn.map((r) => r[0])]), new THREE.Vector3(1, -0.3, 0)));
    legs.push(orient(gridMesh([out.map((r) => r[LM]), inn.map((r) => r[LM])]), new THREE.Vector3(-1, -0.6, 0)));
    legs.push(orient(gridMesh([out[out.length - 1], inn[inn.length - 1]]), new THREE.Vector3(0, 1, 0)));
  }
  fr.add(merge(legs), M.carbon, { sub: 10 });
  // The lamp band, set under the deck's lip (the wing's trailing edge, which reaches the tail):
  // a gloss-black housing standing 19 mm proud of the tail face, and on it the light guide, one
  // red bar 26 mm tall whose ends turn forward round the corners onto the housing's ends.
  const LB = { y0: 0.760, y1: 0.829, x: S.TAIL + 0.006, hw: 0.815 };   // its top clears the lip's underside, lowest (0.837) at the haunch's inner crease
  fr.add(prism([[tx + 0.016, -LB.hw], [LB.x, -LB.hw], [LB.x, LB.hw], [tx + 0.016, LB.hw]], LB.y1 - LB.y0).rotateX(Math.PI / 2).translate(0, (LB.y0 + LB.y1) / 2, 0), M.gloss, { sub: 1 });
  const GUIDE = [[0, 0.774], [0, 0.796], [-0.0015, 0.799], [-0.0035, 0.799], [-0.005, 0.796], [-0.005, 0.774], [-0.0035, 0.771], [-0.0015, 0.771]];
  fr.add(sweep(wrapPath(LB.x - 0.004, LB.hw + 0.004, 0.012), () => GUIDE), M.tail, { sub: 2, shadow: false });
  // Bumper blade: a white blade under the band, its edge at the tail line (side outline: -2.100 at
  // 0.73-0.745, stepping in to -2.079 at 0.712), the ends turning forward.
  // Its two outer edges are crisp (each corner point given twice, so the normals split there).
  const BLADE = [[0, 0.731], [0, 0.745], [0, 0.745], [-0.052, 0.749], [-0.052, 0.712], [-0.024, 0.712], [0, 0.731]];
  fr.add(sweep(wrapPath(S.TAIL + 0.0012, 0.80, 0.03), () => BLADE), M.paint, { sub: 5 });

  const thrusters = P('thrusters', 'THRUSTER NOZZLES', 'Four rear cold-gas nozzles above the diffuser (Thrust package): brushed bronze bores with polished lips', 'chassis');
  const nozzles = [];
  // Each nozzle about its own axis (q runs rearward, the exit at q 0.048 = the anchor): a bronze
  // shell from the diffuser face, a polished lip round the exit, the bore narrowing to a dark throat.
  const along = (g) => g.rotateY(-Math.PI / 2);   // revolve's axle (z) onto the car's -x
  const shellN = revolve([[0.0445, 0.046], [0.046, 0.030], [0.046, -0.0475]], 1, 32);
  const boreN = revolve([[0.025, -0.030], [0.030, 0.0], [0.035, 0.025], [0.0385, 0.046]], 1, 32);
  const lipN = revolve([[0.0385, 0.046], [0.0395, 0.0485], [0.0415, 0.0495], [0.0435, 0.0485], [0.0445, 0.046]], 1, 32);
  const throatN = revolve([[0, -0.030], [0.025, -0.030]], 1, 24);
  for (let i = 0; i < 4; i++) {
    const z = (i - 1.5) * 0.24;
    thrusters.add(along(merge([shellN, boreN])), M.nozzle, { pos: [tx + 0.05, NOZ_Y, z], sub: i });
    thrusters.add(along(throatN.clone()), M.trim, { pos: [tx + 0.05, NOZ_Y, z], sub: 4 + i });
    thrusters.add(along(lipN.clone()), M.nozzleRim, { pos: [tx + 0.05, NOZ_Y, z], sub: 8 + i });
    nozzles.push(new THREE.Vector3(tx + 0.002, NOZ_Y, z));
  }
  const fansP = P('fans', 'DOWNFORCE FANS', 'Four ~20 kW fans in the diffuser bays, each a nine-blade rotor in a bell; suction holds the car to the ramp', 'chassis');
  const fanSpin = [];
  // Fan centres from Tesla's plan-view x-ray (docs/INTERNALS.md): z +-0.145 and +-0.43,
  // a 0.29 m pitch, wider than the nozzles' 0.24 m. Each rotor: nine swept, pitched blades and a
  // spinner (about the hub's x axis); each bell: a flared lip proud of the back face, its barrel
  // running into the body to the motor's dark face.
  const rotor = [];
  for (let b = 0; b < 9; b++) {
    const th0 = (b / 9) * Math.PI * 2, rows = [];
    for (let i = 0; i <= 6; i++) {
      const r = lerp(0.028, 0.084, i / 6), sweepA = 0.55 * ((r - 0.028) / 0.056) ** 1.3, chord = lerp(0.42, 0.30, i / 6);
      rows.push(Array.from({ length: 5 }, (_, j) => {
        const f = j / 4, a = th0 + sweepA + (f - 0.5) * chord;
        return [lerp(0.009, -0.009, f) * lerp(1, 0.6, i / 6), r * Math.cos(a), r * Math.sin(a)];
      }));
    }
    rotor.push(gridMesh(rows));
  }
  const spinner = revolve([[0, 0.017], [0.012, 0.015], [0.020, 0.011], [0.026, 0.005], [0.028, -0.010]], 1, 24).rotateY(-Math.PI / 2);
  rotor.push(spinner);
  const rotorG = merge(rotor);
  const bells = [];
  for (const z of FAN_Z) {
    bells.push(revolve([[FAN_R + 0.002, -0.14], [FAN_R + 0.002, 0.0], [FAN_R - 0.002, 0.03], [FAN_R + 0.004, 0.052], [FAN_R + 0.012, 0.058]], 1, 40).rotateY(-Math.PI / 2).translate(tx + REC, FAN_Y, z));
    bells.push(revolve([[FAN_R + 0.012, 0.058], [FAN_R + 0.014, 0.052], [FAN_R + 0.008, 0.0]], 1, 40).rotateY(-Math.PI / 2).translate(tx + REC, FAN_Y, z));
    bells.push(revolve([[0, -0.14], [FAN_R + 0.002, -0.14]], 1, 40).rotateY(-Math.PI / 2).translate(tx + REC, FAN_Y, z));
  }
  fansP.add(merge(bells), M.trim, { sub: 4 });
  for (let i = 0; i < 4; i++) {
    const hub = new THREE.Group();
    hub.position.set(tx + 0.06, FAN_Y, FAN_Z[i]);
    fansP.group.add(hub);
    fansP.add(rotorG.clone(), M.fan, { parent: hub, sub: i });
    fanSpin.push(hub);
  }

  // --- active wing: the tail top behind the deck line, with the tail block's side panels as end plates ---
  const wingP = P('wing', 'ACTIVE WING', 'The tail top behind the rear glass with its side end plates: flush in Road mode, raised in Low-Drag, raised, back and tilted in High-Downforce', 'shell');
  const wingRoot = new THREE.Group();
  wingP.group.add(wingRoot);
  const pivot = new THREE.Vector3(WING_X0, ZC(WING_X0), 0);
  const toPivot = (g) => { g.translate(-pivot.x, -pivot.y, 0); return g; };
  // The blade is the deck surface itself from the haunch edges to the centre, so stowed
  // it is flush; it has a skin of its own beneath, and its edges are closed.
  // Both stop half a gap short of the deck line and of the end plate's front and foot lines.
  // Behind the tail face the blade runs on to the tail line as a thin lip over the lamp band,
  // tapering from the blade's thickness to 4 mm at its edge (studio rear photo: a knife-edge lip).
  const LIP_X = S.TAIL, LIP_EDGE = 0.004;   // the lip's edge is the rear overhang's end
  const lipTh = (x) => lerp(LIP_EDGE, WING_SKIN, (x - LIP_X) / (XEND_R - LIP_X));
  const deckX = (j) => lerp(LIP_X, XEND_R, j / 4);
  const deckLip = [...band(4, 7, LIP_X, XEND_R, { nu: 6, nx: 4 })];
  for (const sg of [1, -1]) {
    for (const k of [4, 5, 6]) {
      const rows = Array.from({ length: 7 }, (_, i) => Array.from({ length: 5 }, (_, j) => { const x = deckX(j), [z, y] = surfOff(x, k + i / 6, -lipTh(x)); return [x, y, sg * z]; }));
      deckLip.push(orient(gridMesh(rows), new THREE.Vector3(0, -1, 0)));
    }
    deckLip.push(wall(pathX(() => LIP_X, 4, 7, 24), 0, -LIP_EDGE, { side: sg }));
    deckLip.push(gridMesh([0, 1].map((e) => Array.from({ length: 5 }, (_, j) => { const x = deckX(j), [z, y] = surfOff(x, 4, e ? -lipTh(x) : 0); return [x, y, sg * z]; })), { both: true }));
  }
  wingP.add(toPivot(merge([...shell(4, 7, XEND_R, WING_X0 - half, WING_SKIN, { nu: 6, nx: 14 }), ...deckLip])), M.paint, { parent: wingRoot, sub: 0 });
  // At the tail corner the end plate stops a gap short of the tail face, which is the body's; at
  // its top it runs back under the lip's corner, so the lip turns down into it there.
  const EP_BACK = (u) => (u < EP_U1 ? EP_R(u) + half : lerp(XR_END(u) + GAP, LIP_X + 0.002, smooth(3.80, 4, u)));
  // In two pieces split at EP_U1, so the plate's lower rear corner (where its foot line meets the
  // tail corner) is a row of both and comes out square instead of cut off by a chord.
  wingP.add(toPivot(merge([
    ...shell(EP_U0, EP_U1, EP_BACK, (u) => EP_F(u) - half, WING_SKIN, { nu: 3, nx: 12 }),
    ...shell(EP_U1, 4, EP_BACK, (u) => EP_F(u) - half, WING_SKIN, { nu: 6, nx: 12 }),
  ])), M.paint, { parent: wingRoot, sub: 1 });
  // Red lamps on the end plates' rear edges, beside the lamp band (night reveal frame: the wing's
  // end plates glow red at the corners); they rise with the wing.
  wingP.add(toPivot(wall(pathX((u) => XR_END(u) + GAP - 0.0008, EP_U1 + 0.06, 3.78, 12), -0.0015, -0.0105)), M.tail, { parent: wingRoot, sub: 3, shadow: false });
  // Swan-neck struts: inside the tail when stowed, carrying the blade when raised.
  const struts = [];
  for (const sg of [-1, 1]) {
    const g = prism([[-0.10, -0.045], [-0.20, -0.045], [-0.22, -0.30], [-0.15, -0.30]], 0.016);
    g.translate(0, 0, sg * 0.34);
    struts.push(g);
  }
  wingP.add(merge(struts), M.carbon, { parent: wingRoot, sub: 2 });
  wingRoot.position.copy(pivot);
  // Under the wing: the fixed deck and the inner side panels, sunk along the normal and
  // closed at their edges, so a raised wing shows bodywork beneath it rather than a hole.
  shellP.add(merge([
    ...band(4, 7, XEND_R, WING_X0, { nu: 6, nx: 10, off: -DECK_DROP }),
    wall(pathX(() => WING_X0, 4, 7, 21), 0, -DECK_DROP),
    ...band(EP_U0, 4, (u) => EP_R(u), (u) => EP_F(u), { nu: 6, nx: 10, off: -DECK_DROP }),
    wall(pathX((u) => EP_F(u), EP_U0, 4), 0, -DECK_DROP),
    wall(pathX((u) => EP_R(u), EP_U0, EP_U1), 0, -DECK_DROP),
  ]), M.trim, { sub: 4 });

  // --- wheels ---
  const wheels = [];
  const brakes = P('brakes', 'BRAKES', 'Carbon-ceramic discs on their hats, and a caliper over each disc', 'running', root);
  for (const [name, xa, sg, front] of [['wheelFL', S.XF, -1, true], ['wheelFR', S.XF, 1, true], ['wheelRL', S.XR, -1, false], ['wheelRR', S.XR, 1, false]]) {
    const r = front ? S.tireRF : S.tireRR, w = front ? S.tireWF : S.tireWR;
    const tr = front ? S.trackF : S.trackR;
    const wp = P(name, name.replace('wheel', 'WHEEL '), `${front ? '295/30R20' : '335/30R21'} tyre on a six twin-blade spoke wheel over a light aero disc`, 'running', root);
    wp.group.position.set(xa, r, sg * tr / 2);
    const steer = new THREE.Group();
    wp.group.add(steer);
    const spin = new THREE.Group();
    steer.add(spin);
    // The rim's flange stands 17.5 mm over the bead seat (a J flange); the wheel's face runs out to
    // its top and the tyre comes out from behind it there (side frame: light to 0.268 m, tyre from 0.274).
    const sidewall = front ? 0.0885 : 0.1005, FLANGE = 0.0175;
    wp.add(tyreGeometry({ radius: r, width: w, sidewall, flange: FLANGE }), M.tyre, { parent: spin, sub: 0 });
    const face = wheelFace(r - sidewall + FLANGE, w, sg, r - sidewall);
    wp.add(face.disc, M.disc, { parent: spin, sub: 1 });
    wp.add(face.spokes, M.spoke, { parent: spin, sub: 2 });
    wp.add(face.machined, M.machined, { parent: spin, sub: 3 });
    wp.add(face.slot, M.slot, { parent: spin, sub: 4 });
    // brakes live with the wheel but belong to the brakes part (engine reads world space);
    // the caliper trails the front axle and leads the rear one, a little above the axle line
    const br = brakeGeometry(r - sidewall, sg, front ? 2.83 : 0.30);
    brakes.add(br.rotor, M.brake, { parent: steer });
    brakes.add(br.caliper, M.caliper, { parent: steer });
    wheels.push({ part: wp, steer, spin, sg, front, r });
  }

  // --- wheel tubs: a well behind each arch ---
  // The liner runs round the arch 8 mm behind the body's arch edge and drops straight down to the
  // floor at both ends; across, it reaches from the well's inboard wall out to 3 mm inside the sill
  // corner (u2), so none of it shows outside the body, and its feet follow the floor and the sill's
  // underside corner, so no slot opens under it. The inboard wall closes the well down to the floor.
  const tubs = P('tubs', 'WHEEL ARCH LINERS', 'Black liners round the four arches and down to the floor, each well closed by an inboard wall; the four downward hover-thruster nozzles hang in the wells', 'chassis');
  for (const [xa, r, R, zIn] of [[S.XF, S.tireRF, WELL_HALF.F, WELL_IN.F], [S.XR, S.tireRR, WELL_HALF.R, WELL_IN.R]]) {
    const arc = Array.from({ length: 73 }, (_, i) => { const th = Math.PI - (i / 72) * Math.PI; return [xa + R * Math.cos(th), r + R * Math.sin(th)]; });
    const zOut = (x) => HWB(x) - 0.003;
    // Rows across the liner, given by their distance in from its outer edge; the outer rows
    // follow the sill's underside corner (u1 is 67 mm in).
    const IN = [null, 0.067, 0.05, 0.035, 0.02, 0.008, 0];
    for (const sg of [-1, 1]) {
      const rows = IN.map((d) => {
        const zAt = (x) => (d === null ? zIn : zOut(x) - d);
        const foot = (x) => [x, underY(x, zAt(x)), sg * zAt(x)];
        return [foot(xa - R), ...arc.map(([x, y]) => [x, y, sg * zAt(x)]), foot(xa + R)];
      });
      tubs.add(gridMesh(rows), M.liner);
      tubs.add(gridMesh([arc.map(([x]) => [x, ZB(x), sg * zIn]), arc.map(([x, y]) => [x, y, sg * zIn])]), M.liner);
    }
  }

  // Hover-thruster nozzles at the hover-jet anchors, firing down (World photo: bronze bodies with a
  // polished collar, hanging in the wells): a bronze body flaring to its exit at the anchor, a
  // polished collar and lip, a dark throat, and a bracket to the well's inboard wall.
  const HJ = [[S.XF + 0.25, 0.2, WELL_IN.F], [S.XR - 0.25, 0.2, WELL_IN.R]];
  const down = (g, x, y, z) => g.rotateX(Math.PI / 2).translate(x, y, z);   // revolve's axle (z) onto -y
  const hjBody = [], hjBright = [], hjDark = [];
  for (const [hx, hy, wallZ] of HJ) for (const sg of [1, -1]) {
    const hz = sg * 0.62;
    hjBody.push(down(revolve([[0.024, 0], [0.022, -0.02], [0.020, -0.05], [0.020, -0.11]], 1, 28), hx, hy, hz));   // outside
    hjBody.push(down(revolve([[0.012, -0.03], [0.016, -0.012], [0.0205, 0]], 1, 28), hx, hy, hz));               // bore
    hjBright.push(down(revolve([[0.0205, 0], [0.0215, 0.0015], [0.023, 0.0015], [0.024, 0]], 1, 28), hx, hy, hz));
    hjBright.push(down(revolve([[0.0235, -0.06], [0.0235, -0.075]], 1, 28), hx, hy, hz));
    hjBright.push(down(revolve([[0.020, -0.06], [0.0235, -0.06]], 1, 28), hx, hy, hz));
    hjBright.push(down(revolve([[0.0235, -0.075], [0.020, -0.075]], 1, 28), hx, hy, hz));
    hjDark.push(down(revolve([[0, -0.03], [0.012, -0.03]], 1, 20), hx, hy, hz));
    const z0 = Math.min(Math.abs(hz), wallZ) - 0.004, z1 = Math.abs(hz);
    const br = new THREE.BoxGeometry(0.03, 0.012, z1 - z0 + 0.02);
    br.translate(hx, hy + 0.10, sg * (z0 + z1) / 2);
    hjDark.push(br);
  }
  tubs.add(merge(hjBody), M.nozzle);
  tubs.add(merge(hjBright), M.nozzleRim);
  tubs.add(merge(hjDark), M.trim);

  // --- camera pods: on each front fender, just ahead of the door's front shut line ---
  // A dark gloss wedge just under the shoulder crease (side frame: x 0.86 to 1.06, top ~0.70 at
  // the rear, tapering to the front), never across the door line; a red triangle at its front end
  // and the amber repeater at its rear (front-wheel closeup).
  const pods = P('pods', 'CAMERA PODS', 'Side cameras in dark gloss wedges with a red reflector ahead and an amber repeater behind (no mirrors)', 'shell');
  const POD = { x0: 0.866, x1: 1.062, n: 10 };
  const podAt = (x) => { const k = (x - POD.x0) / (POD.x1 - POD.x0); return { top: lerp(0.700, 0.711, k), bot: lerp(0.676, 0.7065, k), out: lerp(0.011, 0.004, k * k) }; };
  const onPod = (x, y, off, sg) => { const [z, yy] = surfOff(x, uAtY(x, y), off); return [x, yy, sg * z]; };
  for (const sg of [1, -1]) {
    const xs = Array.from({ length: POD.n + 1 }, (_, i) => POD.x0 + ((POD.x1 - POD.x0) * i) / POD.n);
    // Section at x: inner bottom, outer bottom, outer middle, outer top, inner top.
    const sec = (x) => { const p = podAt(x), mid = (p.top + p.bot) / 2; return [onPod(x, p.bot, -0.004, sg), onPod(x, p.bot, p.out, sg), onPod(x, mid, p.out, sg), onPod(x, p.top, p.out, sg), onPod(x, p.top, -0.004, sg)]; };
    const S5 = xs.map(sec);
    const strip = (i0, i1, dir) => orient(gridMesh(S5.map((r) => r.slice(i0, i1 + 1))), dir);
    const ends = [S5[0], S5[POD.n]].map((r, e) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, 2, 0, 2, 3, 0, 3, 4].flatMap((i) => r[i]), 3));
      g.computeVertexNormals();
      return orient(g, new THREE.Vector3(e ? 1 : -1, 0, 0));
    });
    pods.add(merge([strip(0, 1, new THREE.Vector3(0, -1, 0)), strip(1, 3, new THREE.Vector3(0, 0, sg)), strip(3, 4, new THREE.Vector3(0, 1, 0)), ...ends]), M.gloss, { sub: sg > 0 ? 0 : 2 });
    const face = (x, y, f = 0.0007) => onPod(x, y, podAt(x).out + f, sg);
    // Amber repeater at the rear end; red triangle at the front, pointing forward.
    const ax = [0.884, 0.900, 0.917, 0.934];
    const amber = orient(gridMesh(ax.map((x) => { const p = podAt(x), m = (p.top + p.bot) / 2; return [face(x, m - 0.0035), face(x, m + 0.0035)]; })), new THREE.Vector3(0, 0, sg));
    pods.add(amber, M.amber, { sub: sg > 0 ? 1 : 3, shadow: false });
    const b = podAt(0.994), tip = podAt(1.050);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([...face(0.994, b.bot + 0.003), ...face(0.994, b.top - 0.003), ...face(1.050, (tip.top + tip.bot) / 2)], 3));
    tri.computeVertexNormals();
    pods.add(orient(tri, new THREE.Vector3(0, 0, sg)), M.marker, { sub: sg > 0 ? 4 : 5, shadow: false });
  }

  // --- interior: the cabin, seen with the doors up ---
  // Laid out on the cockpit the drivetrain measured (drivetrain.js, cockpit: the dash at x 0.95-1.26
  // under the windscreen, door to door at its rear edge and narrowing forward where the steered tyres
  // sweep; the yoke at (0.74, 0.665, -0.38), tilted back; the screen to its right, turned toward the
  // driver; the console back from under the screen) and the plan x-ray's seat bay (x 0.28 back to the
  // bulkhead at -0.34/-0.39). All of it stands on the pack (its top is 0.295): the cabin floor is laid
  // on it. Trim that belongs to a panel (the door cards, seals and window frames; the jambs; the pillar
  // faces and the glass seen from inside) hangs in that panel's group, so it opens, explodes and
  // dissolves with the panel, while the x-ray and the HUD, which leave this part out, are unchanged.
  const cabin = P('interior', 'INTERIOR', 'Cabin: two carbon-shelled buckets in white perforated leather, a console between them, a grey alcantara dash with a floating centre screen, an open yoke; door cards with red ambient strips, seals and window frames; jambs, pillar faces, trimmed sides and a rear bulkhead', 'interior');
  const XA_F = S.XF - S.tireRF - ARCH_GAP;       // the front arch's rear end
  const linerTop = (x) => S.tireRF + Math.sqrt(Math.max(0, WELL_HALF.F ** 2 - (x - S.XF) ** 2));
  const IN_DIR = (sg) => new THREE.Vector3(0, 0, -sg);
  const UP = new THREE.Vector3(0, 1, 0);

  // Floor: dark, flat on the pack, from the bulkhead to the front wells and on between them into
  // the footwells.
  const floorRows = (x0, x1, hw, n) => linspace(x0, x1, n).map((x) => [-hw, 0, hw].map((z) => [x, CAB.floor, z]));
  cabin.add(merge([
    orient(gridMesh(floorRows(XBULK(CAB.floor) - 0.01, XWELL, CAB.floorZ, 8)), UP),
    orient(gridMesh(floorRows(XWELL - 0.005, CAB.front, WELL_IN.F, 4)), UP),
  ]), M.interior);

  // The cabin's sides: the skin pulled in CAB.side, from the floor to the belt. Ahead of the door (the
  // kick panel) on to the A-pillar's base, its foot riding over the front arch; behind the door to the
  // bulkhead. A ledge at the belt closes each up to the A-pillar glass; under the windscreen's sides,
  // the fender's inner facet seen from inside.
  const sides = [];
  for (const sg of [1, -1]) {
    const usK = [...linspace(3.07, 4, 6), ...linspace(4, 5, 6).slice(1)];
    sides.push(orient(gridMesh(usK.map((u) => [...linspace(DOOR_F(u) + half, XA_F - 1e-4, 6), ...linspace(XA_F + 1e-4, CAB.kick, 10)].map((x) => inset(x, u, CAB.side, sg)))), IN_DIR(sg)));
    const usR = [...linspace(3, 4, 6), ...linspace(4, 5, 4).slice(1)];
    sides.push(orient(gridMesh(usR.map((u) => linspace(XBULK(yAt(-0.3, u)) - 0.02, DOOR_R(u) - half, 6).map((x) => inset(x, u, CAB.side, sg)))), IN_DIR(sg)));
    const xl = linspace(DOOR_F(5) + half, CAB.kick, 16);
    sides.push(orient(gridMesh([xl.map((x) => inset(x, 5, CAB.side, sg)), xl.map((x) => { const [z, y] = surfOff(x, U5_AGLASS, -0.006); return [x, y, sg * z]; })]), UP));
    sides.push(...band(5, U6_LO, (u) => APIL(u) + half, 1.57, { side: sg, off: -0.006, flip: true, nu: 4, nx: 10 }));
  }
  // Rear bulkhead, carbon (the tank photo: a carbon bay behind the seats): across the car at XBULK,
  // from the floor to the roof; its edges run just inside the side trim and, above the belt, the
  // quarter glass.
  const yRoof = ZC(XBULK(1.1)) - 0.012;
  const bulk = linspace(CAB.floor, yRoof, 24).map((y) => {
    const x = XBULK(y), w = skinZ(x, y) - (y < yAt(x, 5) ? 0.03 : 0.008);
    return linspace(-w, w, 16).map((z) => [x, y, z]);
  });
  // Front wall across the footwells and the A-pillar bases, under the dash: from the floor (outboard,
  // the top of the arch liner) up to the dash's underside (outboard, the deck's).
  const zw = skinZ(CAB.front, 0.72) - CAB.side;
  const fz = linspace(-zw, zw, 40);
  const fBot = (z) => lerp(CAB.floor, linerTop(CAB.front) - 0.004, smooth(WELL_IN.F, WELL_IN.F + 0.04, Math.abs(z)));
  const fTop = (z) => lerp(0.664, 0.728, smooth(0.50, 0.54, Math.abs(z)));
  cabin.add(merge([
    ...sides,
    orient(gridMesh([0, 0.5, 1].map((k) => fz.map((z) => [CAB.front, lerp(fBot(z), fTop(z), k), z]))), new THREE.Vector3(-1, 0, 0)),
  ]), M.interior);
  cabin.add(orient(gridMesh(bulk), new THREE.Vector3(1, 0, 0)), M.carbon);

  // Dash (cabin photo): a long slab of grey alcantara over a black lower face, door to door at its
  // rounded rear edge, narrowing forward over the arches (the cockpit's plan), and on as a thin deck
  // under the windscreen to the cowl. Each station: [x, bottom, top, half-width, corner radius].
  const deckHW = (x) => HWR(x) - 0.03;
  const DASH = [
    [0.926, 0.668, 0.688, 0.80, 0.009], [0.932, 0.652, 0.700, 0.84, 0.022], [0.945, 0.638, 0.708, 0.85, 0.03], [0.970, 0.628, 0.716, 0.855, 0.035],
    [1.020, 0.625, 0.728, 0.855, 0.035], [1.045, 0.626, 0.732, 0.76, 0.035], [1.100, 0.632, 0.738, 0.68, 0.035], [1.180, 0.645, 0.742, 0.60, 0.03],
    [1.270, 0.660, 0.745, 0.53, 0.03], [1.300, 0.726, 0.746, deckHW(1.30), 0.009], [1.400, 0.734, 0.748, deckHW(1.40), 0.006],
    [1.500, 0.739, 0.749, deckHW(1.50), 0.004], [1.545, 0.741, 0.750, deckHW(1.545), 0.004],
  ];
  const dashRings = DASH.map(([x, y0, y1, hw, r]) => { const hh = (y1 - y0) / 2; return roundRect(hw, hh, Math.min(r, hh - 1e-4), 4).map(([z, y]) => [x, y0 + hh + y, z]); });
  const [dashTop, dashLow] = loft(dashRings, [[0, 9], [9, 20]], { caps: 1 });
  cabin.add(dashTop, M.alcantara);
  cabin.add(dashLow, M.trim);

  // A local frame for a tilted part: a across the car, b up its face (leaning forward by `tilt`), c
  // out of its face toward the occupants; turned by `yaw` about the vertical.
  const frame = (tilt, yaw) => {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    return [new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.sin(tilt), Math.cos(tilt), 0), new THREE.Vector3(-Math.cos(tilt), Math.sin(tilt), 0)].map((v) => v.applyQuaternion(q));
  };
  const placeIn = (g, [A, B, C], at) => g.applyMatrix4(new THREE.Matrix4().makeBasis(A, B, C).setPosition(...at));
  // Centre screen: floating over the dash's rear edge on a stalk, tilted back and turned toward the
  // driver (the cockpit's 0.30 and 0.18 rad); a black frame round a dark glass face.
  const SCR = { at: [0.90, 0.735, -0.07], ax: frame(0.30, -0.18) };
  const scrFace = prism(roundRect(0.163, 0.098, 0.008), 0.002).translate(0, 0, 0.009);
  cabin.add(merge([
    placeIn(prism(roundRect(0.17, 0.105, 0.012), 0.016), SCR.ax, SCR.at),
    rodBetween([0.902, 0.705, -0.07], [0.955, 0.632, -0.07], 0.015),
  ]), M.trim);
  cabin.add(placeIn(scrFace, SCR.ax, SCR.at), M.screen);

  // Yoke (yoke closeup): open at the top, two grips joined by a bar along the bottom, light alcantara
  // outside and black inside; a black hexagonal hub on spokes, with bronze inlays; a column into the dash.
  const YK = { at: [0.74, 0.665, -0.38], ax: frame(0.35, 0) };
  const [YA, YB, YC] = YK.ax;
  const yk = (a, b, c) => [0, 1, 2].map((k) => YK.at[k] + a * YA.getComponent(k) + b * YB.getComponent(k) + c * YC.getComponent(k));
  const gripL = [[-0.138, 0.098], [-0.150, 0.078], [-0.157, 0.045], [-0.159, 0.0], [-0.156, -0.045], [-0.147, -0.078], [-0.127, -0.100], [-0.090, -0.110], [-0.045, -0.113]];
  const grip = [...gripL, [0, -0.114], ...gripL.slice().reverse().map(([a, b]) => [-a, b])];
  const gripSec = roundRect(0.016, 0.021, 0.009, 3);   // [across the grip, out of the face]
  const gripRings = grip.map(([a, b], i) => {
    const [a0, b0] = grip[Math.max(0, i - 1)], [a1, b1] = grip[Math.min(grip.length - 1, i + 1)];
    const L = Math.hypot(a1 - a0, b1 - b0), na = (b1 - b0) / L, nb = -(a1 - a0) / L;   // in the face, away from the hub
    return gripSec.map(([n, c]) => yk(a + n * na, b + n * nb, c));
  });
  const [gripOut, gripIn] = loft(gripRings, [[12, 19], [3, 12]], { caps: 0 });
  cabin.add(gripOut, M.alcantaraLight);
  const inYoke = (g, c = 0) => placeIn(g.translate(0, 0, c), YK.ax, YK.at);
  const hub = prism([[0.065, -0.005], [0.040, 0.051], [-0.040, 0.051], [-0.065, -0.005], [-0.040, -0.061], [0.040, -0.061]], 0.044);
  const spokes = [1, -1].flatMap((s) => [
    prism([[0.055, -0.012], [0.150, -0.008], [0.150, 0.016], [0.055, 0.020]].map(([a, b]) => [s * a, b]), 0.016),
    prism([[0.030, -0.045], [0.046, -0.052], [0.088, -0.106], [0.068, -0.108]].map(([a, b]) => [s * a, b]), 0.014),
  ]);
  cabin.add(merge([gripIn, inYoke(hub, 0.012), ...spokes.map((g) => inYoke(g)), rodBetween(yk(0, -0.01, -0.03), [0.975, 0.655, -0.38], 0.03, 16)]), M.trim);
  cabin.add(merge([1, -1].map((s) => inYoke(prism([[0.085, 0.016], [0.128, 0.016], [0.128, 0.021], [0.085, 0.021]].map(([a, b]) => [s * a, b]), 0.012), 0.004))), M.accent);

  // Console between the seats: a carbon tunnel from the bulkhead to the dash, low between the seats'
  // fronts and rising under the screen; a white leather armrest on its rear half and a dark pad ahead.
  // Each station: [x, top, half-width, corner radius], the bottom at y0.
  const pad = (st, y0) => st.map(([x, y1, hw, r]) => roundRect(hw, (y1 - y0) / 2, r, 4).map(([z, y]) => [x, (y0 + y1) / 2 + y, z]));
  const CON = [[-0.35, 0.470, 0.115, 0.03], [-0.30, 0.480, 0.118, 0.035], [0.10, 0.485, 0.120, 0.035], [0.22, 0.470, 0.118, 0.035], [0.32, 0.430, 0.112, 0.03],
    [0.70, 0.425, 0.108, 0.03], [0.84, 0.470, 0.100, 0.03], [0.92, 0.580, 0.095, 0.03], [0.975, 0.640, 0.095, 0.03]];
  cabin.add(loft(pad(CON, CAB.floor))[0], M.carbon);
  cabin.add(loft(pad([[-0.33, 0.500, 0.100, 0.011], [-0.31, 0.515, 0.112, 0.018], [0.17, 0.515, 0.112, 0.018], [0.20, 0.500, 0.100, 0.011]], 0.476))[0], M.leather);
  cabin.add(loft(pad([[0.36, 0.433, 0.07, 0.003], [0.38, 0.434, 0.085, 0.003], [0.76, 0.429, 0.085, 0.003], [0.78, 0.428, 0.07, 0.003]], 0.424))[0], M.alcantara);

  // Seats (cabin photo, yoke closeup, the tank photo behind them): a carbon shell, white leather
  // bolsters and a perforated insert. The cushion sits just above the floor and rises to a thigh roll at
  // its front edge; the back reclines 22 deg to an integrated headrest 4 cm short of the bulkhead. The
  // spine runs along the shell's outer face, from the cushion's front edge to the headrest's top; at
  // each station the padding is T thick at the middle and rises by Bh at the bolsters, W wide.
  const SEAT_Z = 0.385;
  // The spine: the cushion's underside, a bend of radius 0.14 (larger than the padding is thick, so
  // the padding does not fold in the bend), and the back, reclined 22 deg. Stations: [x, y, T, W, Bh].
  const BEND = { at: [-0.03, 0.448], r: 0.14 }, back = [-0.375, 0.927];
  const bendAt = (k) => { const a = (-90 - 68 * k) * (Math.PI / 180); return [BEND.at[0] + BEND.r * Math.cos(a), BEND.at[1] + BEND.r * Math.sin(a)]; };
  const B0 = bendAt(1);
  const SPINE = [
    [0.290, 0.318, 0.035, 0.44, 0.020], [0.270, 0.316, 0.060, 0.46, 0.030], [0.240, 0.314, 0.075, 0.47, 0.035], [0.120, 0.310, 0.065, 0.48, 0.050],
    [0.030, 0.308, 0.060, 0.48, 0.055], [-0.030, 0.308, 0.057, 0.48, 0.052],
    ...[0.25, 0.5, 0.75].map((k) => [...bendAt(k), 0.054, 0.48, 0.048]),
    ...[[0, 0.052, 0.48, 0.050], [0.07, 0.060, 0.49, 0.065], [0.14, 0.065, 0.50, 0.075], [0.21, 0.060, 0.51, 0.080], [0.28, 0.055, 0.52, 0.080],
      [0.35, 0.050, 0.50, 0.060], [0.385, 0.047, 0.44, 0.040], [0.42, 0.045, 0.34, 0.020], [0.49, 0.055, 0.29, 0.012], [0.55, 0.050, 0.28, 0.010], [0.58, 0.035, 0.26, 0.006],
      [0.595, 0.015, 0.24, 0.003]].map(([L, T, W, Bh]) => [B0[0] + L * back[0], B0[1] + L * back[1], T, W, Bh]),
  ];
  // The section, as [across, out of the shell] points: the top (the padding, bolsters rising toward
  // the edges), rolled over each edge, down the sides, and along the shell's back. Ranges: the insert,
  // the leather (right, then left, wrapping), the carbon shell. Thin stations take smaller rolls.
  const seatSection = (T, W, Bh) => {
    const hw = W / 2, e = Math.min(0.022, 0.35 * (T + Bh)), e2 = Math.min(0.012, 0.3 * T);
    const top = (w) => T + Bh * smooth(0.42, 0.95, Math.abs(w) / hw), ht = top(hw - e), split = Math.max(e2 + 0.002, Math.min(0.8 * T, ht - e - 0.002));
    const pts = linspace(-(hw - e), hw - e, 16).map((w) => [w, top(w)]);
    for (const k of [1, 2, 3]) { const f = (k * Math.PI) / 6; pts.push([hw - e + e * Math.sin(f), ht - e + e * Math.cos(f)]); }
    pts.push([hw, split], [hw, e2], [hw - e2 + e2 * Math.SQRT1_2, e2 - e2 * Math.SQRT1_2], [hw - e2, 0]);
    for (const w of linspace(hw - e2, -(hw - e2), 5).slice(1, -1)) pts.push([w, 0]);
    pts.push([-(hw - e2), 0], [-(hw - e2) - e2 * Math.SQRT1_2, e2 - e2 * Math.SQRT1_2], [-hw, e2], [-hw, split], [-hw, ht - e]);
    for (const k of [2, 1]) { const f = (k * Math.PI) / 6; pts.push([-(hw - e) - e * Math.sin(f), ht - e + e * Math.cos(f)]); }
    return pts;
  };
  const SEAT_RANGES = [[4, 12], [12, 20], [20, 31], [31, 39]];   // insert, leather, carbon, leather
  const seatParts = [[], [], []];
  for (const sg of [1, -1]) {
    const rings = SPINE.map(([x, y, T, W, Bh], i) => {
      const [xa, ya] = SPINE[Math.max(0, i - 1)], [xb, yb] = SPINE[Math.min(SPINE.length - 1, i + 1)];
      const L = Math.hypot(xb - xa, yb - ya), nx = (yb - ya) / L, ny = -(xb - xa) / L;   // toward the occupant
      return seatSection(T, W, Bh).map(([w, h]) => [x + h * nx, y + h * ny, sg * SEAT_Z + w]);
    });
    const [ins, legR, shell, legL] = loft(rings, SEAT_RANGES, { caps: 1 });
    seatParts[0].push(ins); seatParts[1].push(legR, legL); seatParts[2].push(shell);
  }
  cabin.add(merge(seatParts[0]), M.perforated);
  cabin.add(merge(seatParts[1]), M.leather);
  cabin.add(merge(seatParts[2]), M.carbon);

  // Jambs, in the body colour, hung on the body: the body side's edges along the door's front and
  // rear shut lines, from the shut line's channel in to the cabin's side trim (the door's bottom edge
  // closes on the sill's top, the cladding's, which also takes the front jamb's foot under 3.06).
  cabin.add(merge([1, -1].flatMap((sg) => [
    orient(jamb((u) => DOOR_F(u) + GAP / 4, 3.06, 5, sg), new THREE.Vector3(-1, 0, 0)),
    orient(jamb((u) => DOOR_R(u) - GAP / 4, 3.0, 5, sg), new THREE.Vector3(1, 0, 0)),
  ])), M.paint, { parent: shellP.group });

  // The glass seen from inside, and the pillars' faces round the door opening, in black, hung on the
  // canopy: the A-pillar glass's rear edge and its foot over the door's front corner, the windscreen
  // header, the spine, the rear roof glass's front edge, the B-pillar.
  const glassIn = (u0, u1, xa, xb, o) => band(u0, u1, xa, xb, { off: -0.004, flip: true, ...o });
  cabin.add(merge([
    ...glassIn(U6_HI, 7, DOOR_ROOF_F + half, (u) => COWL(u) - half, { nu: 10, nx: 40 }),
    ...glassIn(SPINE_HI, 7, DOOR_ROOF_R + half, DOOR_ROOF_F - half, { nu: 4, nx: 24 }),
    ...glassIn(U6_HI, 7, GLASS_END + half, DOOR_ROOF_R - half, { nu: 10, nx: 36 }),
    ...glassIn(U5_AGLASS, U6_LO, (u) => ADIAG(u) + half, (u) => APIL(u) - half, { nu: 6, nx: 24 }),
    ...glassIn(5, QG_TOP, (u) => QTIP(u), (u) => DOOR_R(u) - half, { nu: 4, nx: 24 }),
  ]), M.glass, { parent: gh.group });
  const PF = -0.03;   // the pillars' depth under the glass
  cabin.add(merge([
    wall(pathX((u) => ADIAG(u) + half, U5_AGLASS, U6_HI, 8), -SEAL, PF, { face: new THREE.Vector3(-1, 0, 0) }),
    wall(pathU(U5_AGLASS, ADIAG(5) + half, DOOR_F(5) + half, 4), -SEAL, PF, { face: new THREE.Vector3(0, -1, 0) }),
    wall(pathX(() => DOOR_ROOF_F + half, U6_LO, SPINE_HI, 8), -SEAL, PF, { face: new THREE.Vector3(-1, 0, 0) }),
    wall(pathU(SPINE_HI, DOOR_ROOF_R - half, DOOR_ROOF_F + half, 16), -SEAL, PF, { face: (sg) => new THREE.Vector3(0, -0.5, sg) }),
    wall(pathX(() => DOOR_ROOF_R - half, U6_LO, SPINE_HI, 8), -SEAL, PF, { face: new THREE.Vector3(1, 0, 0) }),
    wall(pathX((u) => DOOR_R(u) - half, 5, U6_HI, 8), -SEAL, PF, { face: new THREE.Vector3(1, 0, 0) }),
  ]), M.trim, { parent: gh.group });

  // Each door's inside, hung on the door: a ledge of alcantara at the belt from the glass to the card,
  // the card's upper roll in dark alcantara, a loop of light alcantara standing proud of the card
  // (cabin photo: long, rounded at the rear, tapering to a point at the front) round a black gloss
  // inset, with a red ambient strip along the inset's lower and upper edges; a black frame round the
  // glass inside, the frame's edges in the body colour; rubber seals round the card and the window.
  for (const { part: dp, sg } of doors) {
    const toHinge = (g) => g.translate(-dp.hinge.x, -dp.hinge.y, -dp.hinge.z);
    const on = { parent: dp.group };
    const DR = (u) => DOOR_R(u) + half, DF = (u) => DOOR_F(u) - half, AF = (u) => ADIAG(u) - half;
    const onCard = ([x, u], d) => { const [z, y] = surfOff(x, u, -DOOR_T - d); return [x, y, sg * z]; };
    const card = { side: sg, flip: true };
    // Belt ledge and upper roll.
    const ROLL = 4.40, RD = 0.006;
    cabin.add(toHinge(merge([
      wall(pathU(5, DR(5), DF(5), 24), -0.004, -DOOR_T - RD, { side: sg, face: UP }),
      ...band(ROLL, 5, (u) => DR(u) + 0.006, (u) => DF(u) - 0.006, { ...card, off: -DOOR_T - RD, nu: 4, nx: 24, spread: uniform }),
      wall(pathU(ROLL, DR(ROLL) + 0.006, DF(ROLL) - 0.006, 24), -DOOR_T, -DOOR_T - RD, { side: sg, face: new THREE.Vector3(0, -1, 0) }),
      wall(pathX((u) => DR(u) + 0.006, ROLL, 5, 4), -DOOR_T, -DOOR_T - RD, { side: sg, face: new THREE.Vector3(-1, 0, 0) }),
      wall(pathX((u) => DF(u) - 0.006, ROLL, 5, 4), -DOOR_T, -DOOR_T - RD, { side: sg, face: new THREE.Vector3(1, 0, 0) }),
    ])), M.alcantara, on);
    // The loop: t runs from its rear end (0) to its front tip (1), s across it from bottom to top.
    const LOOP = { xr: -0.17, xf: 0.66, ub: 3.42, ut0: 3.97, ut1: 4.0, h: 0.012 };
    const ut = (t) => lerp(LOOP.ut0, LOOP.ut1, t), ub = (t) => LOOP.ub + (ut(1) - 0.012 - LOOP.ub) * t ** 1.6;
    const rnd = (t) => (t < 0.06 ? 0.10 * (1 - Math.sqrt(1 - (1 - t / 0.06) ** 2)) : 0);   // the rear end's rounded corners
    const loopAt = (t, s) => [lerp(LOOP.xr, LOOP.xf, t), lerp(ub(t) + rnd(t), ut(t) - rnd(t), s)];
    const ts = [...linspace(0, 0.06, 6), ...linspace(0.06, 1, 26).slice(1)];
    const region = (t0, t1, s0, s1, d, n = 24) => orient(gridMesh(linspace(t0, t1, n).map((t) => linspace(s0, s1, 3).map((s) => onCard(loopAt(t, s), d)))), IN_DIR(sg));
    const outline = [...ts.map((t) => loopAt(t, 0)), ...ts.slice().reverse().map((t) => loopAt(t, 1)), loopAt(0, 0)];
    cabin.add(toHinge(merge([
      orient(gridMesh(ts.map((t) => linspace(0, 1, 4).map((s) => onCard(loopAt(t, s), LOOP.h)))), IN_DIR(sg)),
      wall(outline, -DOOR_T, -DOOR_T - LOOP.h, { side: sg, face: 'both' }),
    ])), M.alcantaraLight, on);
    cabin.add(toHinge(region(0.07, 0.86, 0.2, 0.8, LOOP.h + 0.0005)), M.cardInset, on);
    cabin.add(toHinge(merge([region(0.07, 0.86, 0.14, 0.2, LOOP.h + 0.0008), region(0.07, 0.86, 0.8, 0.86, LOOP.h + 0.0008)])), M.ambient, { ...on, shadow: false });
    // Window frame inside, FW wide, standing FO in from the skin (the glass's inner face is at 0.004).
    const FW = 0.022, FO = -0.009, fo = { side: sg, off: FO, flip: true, nu: 6, nx: 2, spread: uniform };
    const uw = (u, dir) => uStep(0.15, u, FW, dir);
    cabin.add(toHinge(merge([
      patch(5, SIDE_TOP, DR, (u) => DR(u) + FW, fo),
      patch(5, SIDE_TOP, (u) => AF(u) - FW, AF, fo),
      patch(5, SIDE_TOP, (u) => B2(u) - FW / 2, (u) => B2(u) + FW / 2, fo),
      patch(5, 5 + uw(5, 1), DR, AF, { ...fo, nx: 16 }),
      ...band(SIDE_TOP - uw(SIDE_TOP, -1), U6_HI + uw(U6_HI, 1), DR, AF, { ...fo, nu: 2, nx: 16 }),
      patch(U6_HI, SPINE_LO, DOOR_ROOF_R + half, DOOR_ROOF_R + half + FW, fo),
      patch(U6_HI, SPINE_LO, DOOR_ROOF_F - half - FW, DOOR_ROOF_F - half, fo),
      patch(SPINE_LO - uw(SPINE_LO, -1), SPINE_LO, DOOR_ROOF_R + half, DOOR_ROOF_F - half, { ...fo, nx: 16 }),
    ])), M.trim, on);
    cabin.add(toHinge(merge([
      wall(pathX(DR, 5, U6_LO, 12), 0, FO, { side: sg, face: new THREE.Vector3(-1, 0, 0) }),
      wall(pathX(AF, 5, U6_LO, 12), 0, FO, { side: sg, face: new THREE.Vector3(1, 0, 0) }),
      wall(pathX(() => DOOR_ROOF_R + half, U6_HI, SPINE_LO, 6), 0, FO, { side: sg, face: new THREE.Vector3(-1, 0, 0) }),
      wall(pathX(() => DOOR_ROOF_F - half, U6_HI, SPINE_LO, 6), 0, FO, { side: sg, face: new THREE.Vector3(1, 0, 0) }),
      wall(pathU(SPINE_LO, DOOR_ROOF_R + half, DOOR_ROOF_F - half, 16), 0, FO, { side: sg, face: new THREE.Vector3(0, 1, -sg) }),
    ])), M.paint, on);
    // Seals: round the card 10 mm in from its edges (its foot kept above the pack's top, as for all
    // of this part), and round the window over the frame.
    const R = 0.005, UB = 3.075;
    const cardPath = [
      ...pathX((u) => DR(u) + 0.010, 4.97, UB, 14),
      ...pathU(UB, DR(UB) + 0.010, DF(UB) - 0.010, 20).slice(1),
      ...pathX((u) => DF(u) - 0.010, UB, 4.97, 14).slice(1),
    ];
    const winPath = [
      ...pathX((u) => DR(u) + 0.005, 5.02, U6_LO, 10),
      ...pathX(() => DOOR_ROOF_R + half + 0.005, U6_HI, SPINE_LO - 0.01, 4),
      ...pathU(SPINE_LO - 0.01, DOOR_ROOF_R + half + 0.005, DOOR_ROOF_F - half - 0.005, 16).slice(1),
      ...pathX(() => DOOR_ROOF_F - half - 0.005, SPINE_LO - 0.01, U6_HI, 4).slice(1),
      ...pathX((u) => AF(u) - 0.005, U6_LO, 5.02, 10),
    ];
    const seal = (path, d) => pipe(path.map(([x, u]) => { const [z, y] = surfOff(x, u, d); return [x, y, sg * z]; }), path.map(([x, u]) => outward(x, u, sg)), R, 8);
    cabin.add(toHinge(merge([seal(cardPath, -DOOR_T - R), seal(winPath, FO - R)])), M.seal, on);
  }

  for (const p of order) p.rest.copy(p.group.position);

  // Explode directions for the viewer (the engine poses explodeT = 0).
  const ex = { body: [0, 0.35, 0], greenhouse: [0, 0.7, 0], doorFL: [0, 0.3, -0.5], doorFR: [0, 0.3, 0.5], fasciaFront: [0.6, 0, 0], fasciaRear: [-0.6, 0, 0], floor: [0, -0.4, 0], interior: [0, 0.2, 0], cladding: [0, -0.1, 0], wing: [-0.3, 0.5, 0] };
  for (const [n, v] of Object.entries(ex)) parts[n]?.explode.set(...v);

  // Front side jets: on the fender's front corner face, below the lamp pockets.
  const jetX = 1.98, jetU = 3.6, [jz, jy] = surface(jetX, jetU);
  const anchors = {
    nozzles,
    hoverJets: [[S.XF + 0.25, 0.2, 0.62], [S.XF + 0.25, 0.2, -0.62], [S.XR - 0.25, 0.2, 0.62], [S.XR - 0.25, 0.2, -0.62]].map((p) => new THREE.Vector3(...p)),
    frontJets: [[jetX, jy, jz], [jetX, jy, -jz]].map((p) => new THREE.Vector3(...p)),
    fans: fanSpin.map((h) => h.position.clone()),
  };

  const wingNow = [0, 0, 0];
  return {
    root, body, parts, order, wheels, doors, SPEC: S, anchors,
    lamps: { tail: M.tail, head: M.head, repeater: M.amber },
    aeroMode: 'road', wingT: 0,
    materials: M,
    explodeT: 0, openT: 0, panelsT: 1, spinAngle: 0, fanAngle: 0, fanLevel: 0,
    update(dt, st = {}) {
      const speed = st.speed ?? 0, steer = st.steer ?? 0;
      this.spinAngle -= (speed / 3.6 / S.tireRF) * dt;
      for (const w of this.wheels) {
        w.spin.rotation.z = this.spinAngle * (S.tireRF / w.r);
        w.steer.rotation.y = w.front ? (steer * Math.PI) / 180 : 0;
      }
      this.fanAngle += this.fanLevel * 90 * dt;
      for (const h of fanSpin) h.rotation.x = this.fanAngle;
      for (const p of this.order) p.group.position.copy(p.rest).addScaledVector(p.explode, this.explodeT);
      for (const d of this.doors) d.part.group.rotation.x = -d.sg * this.openT * 1.75;
      // Wing: road = flush; lowDrag = up 65 mm and back 40 mm; highDownforce = up 115 mm,
      // back 130 mm, trailing edge up 17 deg. dt = 0 snaps to the pose (deterministic seeks).
      const target = WING_POSE[this.aeroMode] || WING_POSE.road;
      const k = dt > 0 ? Math.min(1, dt * 3) : 1;
      for (let i = 0; i < 3; i++) wingNow[i] += (target[i] - wingNow[i]) * k;
      this.wingT = target[0] > 0 ? wingNow[0] / target[0] : 0;
      wingRoot.position.set(pivot.x + wingNow[1], pivot.y + wingNow[0], 0);
      wingRoot.rotation.z = wingNow[2];
    },
  };
}
