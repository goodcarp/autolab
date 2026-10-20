// The wall-ride ramp as drawn props for the run mode: the deck the physics drives on, a frame
// that holds it up, and a start line. Built from the drive's own world (rd/drive/world.js), so
// the drawing and the riding surface are the same curve; bp.addProp draws them like the car.
//
// The profile lies in the world x-y plane: the run-in is the ground along +x, the foot of the
// curl is at x = 0, the wall stands at x = 8.94 and the overhang reaches back over the run-in
// to its tip at x = -11.6, 21.6 m up. The deck is 3.2 m wide (z in [-1.6, 1.6]) and 0.45 m
// thick. Behind it: a rib every 1.6 m, posts under the lower arc, a tower behind the wall with
// ties and cross braces, and a girder over the top with hangers down to the overhang.
//
// Every face is written with its own normal (the riding surface follows the curve, the slab's
// sides and the beams are flat), so the composite inks the slab's edges and every beam's
// corners as creases. buildRampProps() returns the meshes to add and a dispose() for all of it.
import * as THREE from 'three';

export const PROP_IDS = Object.freeze({ deck: 200, frame: 201, line: 202 });

const RIB = { every: 1.6, depth: 0.4, along: 0.14 };
const BEAM = { post: 0.3, tie: 0.2, brace: 0.13, girder: 0.4, hanger: 0.18 };

// Triangles with a normal per vertex, gathered into one geometry.
class Faces {
  constructor() { this.p = []; this.n = []; }
  // A quad a b c d (in order round its edge) with one normal, or one per corner. The winding is
  // made to agree with the normal, so DoubleSide shading and the G-buffer's facing test agree.
  quad(a, b, c, d, na, nb = na, nc = na, nd = na) {
    const e1 = _v.subVectors(b, a), e2 = _w.subVectors(c, a), f = e1.cross(e2);
    const flip = f.dot(_u.copy(na).add(nb).add(nc).add(nd)) < 0;
    const tri = flip ? [[a, na], [c, nc], [b, nb], [a, na], [d, nd], [c, nc]] : [[a, na], [b, nb], [c, nc], [a, na], [c, nc], [d, nd]];
    for (const [p, n] of tri) { this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); }
  }
  // A box about centre c with unit axes ax, ay, az and full sizes sx, sy, sz: six flat faces.
  box(c, ax, ay, az, sx, sy, sz) {
    const X = ax.clone().multiplyScalar(sx / 2), Y = ay.clone().multiplyScalar(sy / 2), Z = az.clone().multiplyScalar(sz / 2);
    const P = (i, j, k) => c.clone().addScaledVector(X, i).addScaledVector(Y, j).addScaledVector(Z, k);
    for (const [axis, n] of [[0, ax], [1, ay], [2, az]]) for (const s of [-1, 1]) {
      const corner = (u, v) => (axis === 0 ? P(s, u, v) : axis === 1 ? P(u, s, v) : P(u, v, s));
      this.quad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), n.clone().multiplyScalar(s));
    }
  }
  // A beam of square section w from a to b.
  beam(a, b, w) {
    const d = _v.subVectors(b, a), len = d.length(); if (len < 1e-6) return;
    const u = d.clone().divideScalar(len);
    const ref = Math.abs(u.z) < 0.9 ? Z_AXIS : X_AXIS;
    const e1 = new THREE.Vector3().crossVectors(u, ref).normalize(), e2 = new THREE.Vector3().crossVectors(e1, u);
    this.box(a.clone().add(b).multiplyScalar(0.5), u, e1, e2, len, w, w);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.computeBoundingSphere();
    return g;
  }
}
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0), Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * buildRampProps(world, { startX }) → { props: [{ object, id }], meshes, dispose() }.
 * world is the drive's createWorld(); startX is where the car's origin starts (the start line
 * is drawn just ahead of its front wheels).
 */
export function buildRampProps(world, { startX = -50, frontX = 1.8 } = {}) {
  const ramp = world.ramp, hw = world.halfWidth, T = world.thickness ?? 0.45;
  const s0 = world.sFoot, s1 = world.sLip;
  const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
  // the curve at s: point on the riding surface, inward normal (toward the inside of the curl), tangent
  const frame = (s) => { const [x, y] = ramp.at(s), [nx, ny] = ramp.normal(s), [tx, ty] = ramp.tangent(s); return { p: V(x, y), n: V(nx, ny), t: V(tx, ty) }; };
  const pitch = (s) => ramp.pitch(s) * 180 / Math.PI;

  // ---- the deck: riding surface, back, two sides, two ends ----
  const deck = new Faces();
  const n = Math.max(8, Math.ceil((s1 - s0) / 0.2));
  const st = Array.from({ length: n + 1 }, (_, i) => frame(s0 + (s1 - s0) * i / n));
  for (let i = 0; i < n; i++) {
    const a = st[i], b = st[i + 1];
    const backA = a.p.clone().addScaledVector(a.n, -T), backB = b.p.clone().addScaledVector(b.n, -T);
    deck.quad(V(a.p.x, a.p.y, -hw), V(a.p.x, a.p.y, hw), V(b.p.x, b.p.y, hw), V(b.p.x, b.p.y, -hw), a.n, a.n, b.n, b.n);
    const na = a.n.clone().negate(), nb = b.n.clone().negate();
    deck.quad(V(backA.x, backA.y, -hw), V(backA.x, backA.y, hw), V(backB.x, backB.y, hw), V(backB.x, backB.y, -hw), na, na, nb, nb);
    for (const side of [-1, 1]) deck.quad(V(a.p.x, a.p.y, side * hw), V(b.p.x, b.p.y, side * hw), V(backB.x, backB.y, side * hw), V(backA.x, backA.y, side * hw), V(0, 0, side));
  }
  for (const [f, sgn] of [[st[0], -1], [st[n], 1]]) {
    const back = f.p.clone().addScaledVector(f.n, -T);
    deck.quad(V(f.p.x, f.p.y, -hw), V(f.p.x, f.p.y, hw), V(back.x, back.y, hw), V(back.x, back.y, -hw), f.t.clone().multiplyScalar(sgn));
  }

  // ---- ribs across the back, wider than the deck so the frame lands on them ----
  const ribs = new Faces(), zFrame = hw + 0.15, ribHalf = zFrame + 0.12;
  const stations = [];
  for (let s = s0 + RIB.every / 2; s < s1 - 0.3; s += RIB.every) {
    const f = frame(s), outer = f.p.clone().addScaledVector(f.n, -(T + RIB.depth));
    ribs.box(f.p.clone().addScaledVector(f.n, -(T + RIB.depth / 2)), f.t, f.n, Z_AXIS, RIB.along, RIB.depth, 2 * ribHalf);
    stations.push({ s, pitch: pitch(s), outer });
  }

  // ---- the frame: posts under the lower arc, a tower behind the wall, a girder over the top ----
  const fr = new Faces();
  const xWall = Math.max(...ramp.points.map((q) => q[0]));
  const top = Math.max(...ramp.points.map((q) => q[1])) + T + RIB.depth + 1.0;
  const x1 = xWall + T + RIB.depth + 0.3, x2 = x1 + 2.6;
  const tip = frame(s1).p;
  const levels = [];
  for (let y = 4; y < top - 1; y += 4) levels.push(y);
  levels.push(top);
  for (const z of [-zFrame, zFrame]) {
    // under the lower arc: a post from the ground to every rib that stands clear of it
    for (const r of stations) if (r.pitch < 75 && r.outer.y > 0.6) fr.beam(V(r.outer.x, 0, z), V(r.outer.x, r.outer.y, z), BEAM.post * 0.8);
    // the tower: two posts, a tie at every level, a cross brace between levels
    for (const x of [x1, x2]) fr.beam(V(x, 0, z), V(x, top + BEAM.girder / 2, z), BEAM.post);
    let below = 0;
    for (const y of levels) {
      fr.beam(V(x1, y, z), V(x2, y, z), BEAM.tie);
      fr.beam(V(x1, below, z), V(x2, y, z), BEAM.brace);
      fr.beam(V(x2, below, z), V(x1, y, z), BEAM.brace);
      below = y;
    }
    // the wall to the tower: a strut from each rib on the steep part straight across to it
    for (const r of stations) if (r.pitch > 55 && r.pitch < 125 && r.outer.x < x1) fr.beam(V(r.outer.x, r.outer.y, z), V(x1, r.outer.y, z), BEAM.tie);
    // the girder over the top, out past the tip, and a hanger down to every rib under it
    fr.beam(V(x2 + BEAM.post / 2, top, z), V(tip.x - 0.6, top, z), BEAM.girder);
    for (const r of stations) if (r.pitch >= 125 && r.outer.y < top) fr.beam(V(r.outer.x, r.outer.y, z), V(r.outer.x, top, z), BEAM.hanger);
  }
  // across the frame: the tower's levels and the girder's ends
  for (const x of [x1, x2]) for (const y of levels) fr.beam(V(x, y, -zFrame), V(x, y, zFrame), BEAM.tie);
  for (const x of [tip.x - 0.4, (tip.x + x2) / 2]) fr.beam(V(x, top, -zFrame), V(x, top, zFrame), BEAM.tie);

  // ---- the start line: a checker strip on the ground just ahead of the car's front wheels ----
  const light = new Faces(), dark = new Faces();
  const lineX = startX + frontX + 0.25, cols = 12, rows = 2, cell = (2 * zFrame) / cols, deep = 0.22, h = 0.012;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    ((r + c) % 2 ? dark : light).box(V(lineX + (r + 0.5) * deep, h / 2, -zFrame + (c + 0.5) * cell), X_AXIS, new THREE.Vector3(0, 1, 0), Z_AXIS, deep, h, cell);
  }

  const white = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const grey = new THREE.MeshLambertMaterial({ color: 0x8a8a8a, side: THREE.DoubleSide });
  const mesh = (faces, mat, sub, name) => {
    const m = new THREE.Mesh(faces.geometry(), mat);
    m.name = name; m.userData.subId = sub; m.castShadow = true; m.receiveShadow = false; m.frustumCulled = true;
    return m;
  };
  const deckGroup = new THREE.Group(); deckGroup.name = 'ramp-deck';
  const deckMesh = mesh(deck, white, 0, 'deck'); deckMesh.receiveShadow = true;   // the car's shadow falls on it
  deckGroup.add(deckMesh, mesh(ribs, white, 1, 'ribs'));
  const frameGroup = new THREE.Group(); frameGroup.name = 'ramp-frame';
  frameGroup.add(mesh(fr, white, 0, 'frame'));
  const lineGroup = new THREE.Group(); lineGroup.name = 'start-line';
  const lineLight = mesh(light, white, 0, 'start-light'), lineDark = mesh(dark, grey, 1, 'start-dark');
  for (const m of [lineLight, lineDark]) { m.castShadow = false; m.receiveShadow = true; }
  lineGroup.add(lineLight, lineDark);

  const meshes = [...deckGroup.children, ...frameGroup.children, ...lineGroup.children];
  return {
    props: [{ object: deckGroup, id: PROP_IDS.deck }, { object: frameGroup, id: PROP_IDS.frame }, { object: lineGroup, id: PROP_IDS.line }],
    meshes,
    lineX,
    dispose() { for (const m of meshes) m.geometry.dispose(); white.dispose(); grey.dispose(); },
  };
}
