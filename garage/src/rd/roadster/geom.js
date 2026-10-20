// Synced from roadster-lab d92328a (src/roadster/geom.js) by tools/sync-garage.mjs.
// Edit it in the lab and re-sync; a hand edit here makes the next sync refuse.
// Geometry kernel for the Roadster.
//
// The body is a stack of lofted PANELS. Each station x has a half-section: an
// ordered list of [z, y] points from the underside to the top centreline, z >= 0.
// A panel is the strip between two point indices, lofted along x and mirrored
// across z = 0. Panels never share vertices, so the line where two meet is a
// hard crease by construction, and each panel can belong to its own part.
//
// Frame (same as r2-blueprint, so the Creation Engine measures both alike):
// x forward, y up, z to the car's left; metres; ground at y = 0.
import * as THREE from 'three';

/** Monotone cubic (Fritsch–Carlson) through [x, v] knots, clamped at both ends. */
export function interp(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const n = xs.length, ms = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) ms[i] = (ys[1] - ys[0]) / (xs[1] - xs[0]);
    else if (i === n - 1) ms[i] = (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2]);
    else {
      const d0 = (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1]);
      const d1 = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
      ms[i] = d0 * d1 <= 0 ? 0 : (d0 + d1) / 2;
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const d = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    if (d === 0) { ms[i] = 0; ms[i + 1] = 0; continue; }
    const a = ms[i] / d, b = ms[i + 1] / d, s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); ms[i] = t * a * d; ms[i + 1] = t * b * d; }
  }
  const f = (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    // The first segment whose right knot is at or past x (a binary search: the derived
    // curves have hundreds of knots, and the body evaluates them a few million times).
    let i = 0, hi = n - 2;
    while (i < hi) { const mid = (i + hi) >> 1; if (xs[mid + 1] < x) i = mid + 1; else hi = mid; }
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * ms[i]
      + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * ms[i + 1];
  };
  f.x0 = xs[0];
  f.x1 = xs[n - 1];
  return f;
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/** n+1 values from a to b, denser where `bias` says (1 = uniform). */
export function stations(a, b, n, ends = 0) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    let t = i / n;
    // Cluster stations at both ends, where the sections change fastest.
    if (ends) t = t - ends * Math.sin(2 * Math.PI * t) / (2 * Math.PI);
    out.push(lerp(a, b, t));
  }
  return out;
}

/**
 * Resample a polyline of [z, y] points to `n` segments by arc length, keeping
 * the points listed in `keep` (indices) exactly — those are the creases.
 */
export function resample(poly, perSpan) {
  const out = [poly[0]];
  for (let i = 0; i < poly.length - 1; i++) {
    const k = Array.isArray(perSpan) ? perSpan[i] : perSpan;
    const [z0, y0] = poly[i], [z1, y1] = poly[i + 1];
    for (let s = 1; s <= k; s++) out.push([lerp(z0, z1, s / k), lerp(y0, y1, s / k)]);
  }
  return out;
}

/**
 * Loft one panel along stations `xs`. `rowFn(x)` returns this panel's half-row:
 * an array of [z, y] points (same length at every station), ordered so that
 * walking the row and then stepping +x keeps the outward normal outward on the
 * +z side. The panel is mirrored to -z unless `mirror` is false; `center` joins
 * the two halves into one strip (for panels that cross the centreline).
 */
export function loftPanel(xs, rowFn, { mirror = true, center = false, flip = false } = {}) {
  const rows = xs.map((x) => rowFn(x));
  const m = rows[0].length;
  const pos = [];
  const idx = [];
  const side = (sgn, flipWind) => {
    const base = pos.length / 3;
    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < m; j++) {
        const [z, y] = rows[i][j];
        pos.push(xs[i], y, sgn * z);
      }
    }
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < m - 1; j++) {
        const a = base + i * m + j, b = a + 1, c = a + m, d = c + 1;
        if (flipWind) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
  };
  if (center) {
    // One strip from -z through the centreline to +z: build the full row.
    const full = rows.map((r) => [...r.slice().reverse().map(([z, y]) => [-z, y]), ...r.slice(1)]);
    const mm = full[0].length;
    for (let i = 0; i < xs.length; i++) for (let j = 0; j < mm; j++) pos.push(xs[i], full[i][j][1], full[i][j][0]);
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < mm - 1; j++) {
        const a = i * mm + j, b = a + 1, c = a + mm, d = c + 1;
        if (flip) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
  } else {
    side(+1, flip);
    if (mirror) side(-1, !flip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Close the open end of a panel set with a flat cap built from a section outline. */
export function capFromOutline(x, outline, { facing = 1 } = {}) {
  // outline: half-section [z, y] from the underside centre to the top centre.
  const full = [...outline.map(([z, y]) => [z, y]), ...outline.slice(1, -1).reverse().map(([z, y]) => [-z, y])];
  const shape = new THREE.Shape(full.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ShapeGeometry(shape);
  // ShapeGeometry lies in XY; map (u, v) -> (x, y=v, z=u), facing +x or -x.
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i), v = p.getY(i);
    p.setXYZ(i, x, v, u);
  }
  if (facing > 0) {
    const ix = g.getIndex();
    for (let i = 0; i < ix.count; i += 3) { const t = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, t); }
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A tyre: a solid of revolution about the z axis. Profile in (r, z) from the inboard bead to the
 * outboard one: the bead on the rim's seat (radius - sidewall) and, when the rim has a `flange`, up
 * the back of it (hidden behind the wheel's lip); a rounded rim protector standing proud where the
 * tyre comes out from the rim, the sidewall easing out to the full width, rounded shoulders, and a
 * tread with `grooves` circumferential grooves. Each groove is eased in and out, so no two
 * neighbouring facets of the profile meet at more than 40 degrees (the HUD draws an edge at 40).
 */
export function tyreGeometry({ radius, width, sidewall, flange = 0, segments = 96, grooves = 4 }) {
  const rRim = radius - sidewall, hw = width / 2, sh = Math.min(0.035, sidewall * 0.45);
  const P = rRim + flange;   // where the tyre comes out from the rim
  // One side as [r, |z|], from the bead out to the edge of the tread.
  const side = flange > 0
    ? [[rRim - 0.003, hw * 0.86], [P - 0.007, hw * 0.86], [P - 0.001, hw * 0.885]]   // up the flange, behind the wheel's face
    : [[rRim - 0.003, hw * 0.90]];
  side.push([P + 0.005, hw * 0.935], [P + 0.010, hw * 0.956], [P + 0.015, hw * 0.958], [P + 0.020, hw * 0.950]);
  // The sidewall eases out from the protector to the full width, level at both ends.
  const rp = P + 0.020, rb = Math.min(Math.max(rRim + sidewall * 0.55, rp + 0.015), radius - sh - 0.004);
  for (const s of [0.25, 0.5, 0.75, 1]) side.push([lerp(rp, rb, s), hw * (0.950 + (0.050 * (1 - Math.cos(s * Math.PI))) / 2)]);
  for (let k = 0; k <= 4; k++) { const b = (k / 4) * (Math.PI / 2); side.push([radius - sh + Math.sin(b) * sh, hw - sh + Math.cos(b) * sh]); }
  // Tread: flat between the shoulders, with the grooves spread evenly across it.
  const tw = hw - sh, wg = 0.007, dg = 0.0045, tread = [];
  for (let g = 0; g < grooves; g++) {
    const hc = tw * (-0.68 + (1.36 * g) / Math.max(1, grooves - 1));
    for (let j = 0; j <= 7; j++) {
      const z = hc - wg + (2 * wg * j) / 7;
      tread.push([radius - (dg * (1 + Math.cos((Math.PI * (z - hc)) / wg))) / 2, z]);
    }
  }
  const prof = [...side.map(([r, z]) => [r, -z]), ...tread, ...side.slice().reverse().map(([r, z]) => [r, z])];
  const g = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), segments);
  // Lathe spins about y; turn it so the axle is z. Its own normals are smooth across the seam.
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * A triangle grid through rows of [x, y, z] points (every row the same length).
 * Walking a row and then stepping to the next row, the front face is on the
 * right-hand side; `flip` reverses it, `both` emits both windings (a thin part
 * seen from either side, such as a wall or a strip). Its uv is the distance in
 * metres along each row and across the rows (so a texture keeps one scale).
 */
export function gridMesh(rows, { flip = false, both = false } = {}) {
  const m = rows[0].length, pos = [], idx = [], uv = [];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const down = new Array(m).fill(0);
  rows.forEach((r, i) => {
    let along = 0;
    r.forEach((p, j) => {
      if (j) along += dist(p, r[j - 1]);
      if (i) down[j] += dist(p, rows[i - 1][j]);
      pos.push(p[0], p[1], p[2]);
      uv.push(along, down[j]);
    });
  });
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < m - 1; j++) {
      const a = i * m + j, b = a + 1, c = a + m, d = c + 1;
      if (both || !flip) idx.push(a, c, b, b, c, d);
      if (both || flip) idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A flat polygon ([a, b] points, either winding) extruded `depth` along its
 * normal and centred on it: a closed prism in the XY plane, extruded along z.
 * Groups are cleared so the mesh takes exactly one material. Its uv is the
 * extrusion's own, in the shape's units (metres).
 */
export function prism(points, depth) {
  const s = new THREE.Shape(points.map(([a, b]) => new THREE.Vector2(a, b)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, steps: 1 });
  g.clearGroups();
  g.translate(0, 0, -depth / 2);
  return g;
}

/**
 * Merge geometries (positions, normals, index and uv), dropping other attributes. The uv is
 * kept when any part has one; a part without takes its x and y (metres, seen from the side).
 */
export function merge(geoms) {
  const pos = [], nor = [], idx = [], uv = [];
  const withUv = geoms.some((g) => g.getAttribute('uv'));
  let off = 0;
  for (const g0 of geoms) {
    const g = g0; // indexed or a plain triangle list: both handled below
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), t = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i));
      if (withUv) uv.push(t ? t.getX(i) : p.getX(i), t ? t.getY(i) : p.getY(i));
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (withUv) out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}
