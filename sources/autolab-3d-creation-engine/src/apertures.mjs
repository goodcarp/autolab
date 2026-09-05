// No surviving surface from outside a panel's assembly may occupy its opening.
// The panel supplies the boundary; its material supplies any shader cuts.
import { Vector3 } from "three";
import { ConvexHull } from "three/addons/math/ConvexHull.js";
import { mm, round } from "./load.mjs";

export const OPEN_FRACTIONS = [0, 0.25, 0.5, 1];
const EPS = 1e-10;
const AXES = ["x", "y", "z"];
const state = { speed: 0, steer: 0, time: 0, run: false, drive: false };
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const box = (points) => ({ min: [0,1,2].map(i => Math.min(...points.map(p => p[i]))), max: [0,1,2].map(i => Math.max(...points.map(p => p[i]))) });
const intersects = (a, b) => a.min.every((v, i) => v <= b.max[i] + EPS && a.max[i] >= b.min[i] - EPS);
const changed = (a, b) => a.elements.some((v, i) => Math.abs(v - b.elements[i]) > 1e-8);

// The opening's footprint in the projection plane: the closed panel's projected
// skin triangles rasterised onto a fine grid, then an exact Euclidean distance
// transform to the nearest empty cell. inset(point) is therefore how far the
// point would have to move in the panel's plane to leave the panel's footprint:
// 0 on or outside it, large in the middle of the opening. A union of triangles
// needs no topology, so patch seams and concave notches (the door's window
// frame behind a raked pillar) are handled as they are.
export function footprint2(triangles2, cell = 0.002, close = 0.02) {
  const xs = triangles2.flat().map(p => p[0]), ys = triangles2.flat().map(p => p[1]);
  // Margin beyond the closing radius, so the outside is always on the grid.
  const margin = close + 2 * cell;
  const x0 = Math.min(...xs) - margin, y0 = Math.min(...ys) - margin;
  const w = Math.ceil((Math.max(...xs) + margin - x0) / cell) + 1, h = Math.ceil((Math.max(...ys) + margin - y0) / cell) + 1;
  if (w * h > 4e7) throw new Error("aperture footprint grid too large");
  const inside = new Uint8Array(w * h);
  for (const [a, b, c] of triangles2) {
    const minI = Math.max(0, Math.floor((Math.min(a[0],b[0],c[0]) - x0) / cell)), maxI = Math.min(w-1, Math.ceil((Math.max(a[0],b[0],c[0]) - x0) / cell));
    const minJ = Math.max(0, Math.floor((Math.min(a[1],b[1],c[1]) - y0) / cell)), maxJ = Math.min(h-1, Math.ceil((Math.max(a[1],b[1],c[1]) - y0) / cell));
    const area = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
    if (Math.abs(area) < 1e-14) continue;
    for (let j = minJ; j <= maxJ; j++) for (let i = minI; i <= maxI; i++) {
      const px = x0 + (i + 0.5) * cell, py = y0 + (j + 0.5) * cell;
      // Half a cell of slack so cell centres just off a triangle edge still count as covered.
      const e0 = ((b[0]-a[0])*(py-a[1]) - (b[1]-a[1])*(px-a[0])) / area;
      const e1 = ((c[0]-b[0])*(py-b[1]) - (c[1]-b[1])*(px-b[0])) / area;
      const e2 = ((a[0]-c[0])*(py-c[1]) - (a[1]-c[1])*(px-c[0])) / area;
      const slack = -0.75 * cell / Math.sqrt(Math.abs(area));
      if (e0 >= slack && e1 >= slack && e2 >= slack) inside[j*w+i] = 1;
    }
  }
  // 1e12 leaves room for q*q (grid sides are far below 1e6 cells) without float loss.
  const INF = 1e12;
  const dt1 = (src, n, stride, out) => {
    const v = new Int32Array(n), z = new Float64Array(n + 1);
    const g = (i) => src[i * stride];
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((g(q) + q * q) - (g(v[k]) + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((g(q) + q * q) - (g(v[k]) + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; out[q * stride] = (q - v[k]) * (q - v[k]) + g(v[k]); }
  };
  // Exact squared EDT (Felzenszwalb & Huttenlocher): each cell's squared distance,
  // in cells, to the nearest cell where mask is 1.
  const edt = (mask) => {
    const f = new Float64Array(w * h), tmp = new Float64Array(w * h);
    for (let k = 0; k < w*h; k++) f[k] = mask[k] ? 0 : INF;
    for (let j = 0; j < h; j++) dt1(f.subarray(j*w, (j+1)*w), w, 1, tmp.subarray(j*w, (j+1)*w));
    for (let i = 0; i < w; i++) dt1(tmp.subarray(i), h, w, f.subarray(i));
    return f;
  };
  // Morphological closing: patch seams between skin patches and slots narrower
  // than 2*close, so a gap between a door's lower skin and its window frame is
  // not mistaken for the opening's edge.
  const r2 = (close / cell) * (close / cell);
  const toInside = edt(inside);                          // every cell: distance to the footprint
  const dilated = new Uint8Array(w * h);
  for (let k = 0; k < w*h; k++) dilated[k] = toInside[k] <= r2 ? 1 : 0;
  const notDilated = new Uint8Array(w * h); for (let k = 0; k < w*h; k++) notDilated[k] = dilated[k] ? 0 : 1;
  const toOutside = edt(notDilated);                     // every cell: distance to the dilated footprint's outside
  const closed = new Uint8Array(w * h);
  for (let k = 0; k < w*h; k++) closed[k] = toOutside[k] > r2 ? 1 : 0;
  const notClosed = new Uint8Array(w * h); for (let k = 0; k < w*h; k++) notClosed[k] = closed[k] ? 0 : 1;
  const f = edt(notClosed);                              // inset: distance to the nearest cell outside the closed footprint
  return {
    cell, w, h, x0, y0, close, coverage: closed.reduce((s,v) => s+v, 0) * cell * cell,
    inset: (point) => {
      const i = Math.floor((point[0] - x0) / cell), j = Math.floor((point[1] - y0) / cell);
      if (i < 0 || j < 0 || i >= w || j >= h) return 0;
      return Math.sqrt(f[j*w+i]) * cell;
    },
  };
}

// A deliberately small reader for the model's emitted GLSL: scalar arithmetic,
// comparisons, boolean expressions, declarations and if/return true regions.
// No cut constants are copied here. Unsupported syntax refuses certification.
export function readCut(source) {
  const limitations = new Set();
  const clean = source.replace(/\/\/[^\n]*/g, "");
  const tokens = clean.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_]\w*(?:\.[xyz])?|&&|\|\||>=|<=|==|!=|[{}();,?:=+*/!<>-]/g) ?? [];
  if (tokens.join("") !== clean.replace(/\s/g, "")) throw new Error("unsupported aperture shader tokens");
  let at = 0;
  const take = (s) => { const t = tokens[at++]; if (s && t !== s) throw new Error(`unsupported aperture shader: expected ${s}, got ${t}`); return t; };
  const precedence = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, ">": 4, "<=": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6 };
  const literal = (n) => ({ value: n });
  function expr(env, level = 0) {
    let a; const t = take();
    if (t === "(" ) { a = expr(env); take(")"); }
    else if (["!", "-", "+"].includes(t)) a = { op: `unary${t}`, args: [expr(env, 7)] };
    else if (/^(?:\d|\.)/.test(t)) a = literal(Number(t));
    else if (t === "true" || t === "false") a = literal(t === "true" ? 1 : 0);
    else if (/^p\.[xyz]$/.test(t)) a = { axis: AXES.indexOf(t[2]) };
    else if (["abs", "min", "max", "clamp"].includes(t)) {
      take("("); const args = [expr(env)]; while (tokens[at] === ",") { take(); args.push(expr(env)); } take(")");
      if (args.length !== ({ abs: 1, min: 2, max: 2, clamp: 3 })[t]) throw new Error("unsupported shader arity");
      a = { op: t, args };
    } else { a = env[t]; if (!a) throw new Error(`unsupported shader variable ${t}`); }
    while ((precedence[tokens[at]] ?? -1) >= level) {
      const op = take(); a = { op, args: [a, expr(env, precedence[op] + 1)] };
    }
    if (level === 0 && tokens[at] === "?") { take(); const yes = expr(env); take(":"); a = { op: "?", args: [a, yes, expr(env)] }; }
    return a;
  }
  const regions = [];
  const and = (a,b) => ({ op: "&&", args: [a,b] });
  function statement(env, path) {
    const t = take();
    if (t === "{") { const scope = { ...env }; while (tokens[at] !== "}") statement(scope, path); take("}"); }
    else if (t === "float" || t === "bool") { const name = take(); take("="); env[name] = expr(env); take(";"); }
    else if (t === "if") { take("("); const c = expr(env); take(")"); statement({ ...env }, and(path, c)); }
    else if (t === "return") { take("true"); take(";"); regions.push(path); }
    else throw new Error(`unsupported aperture shader statement ${t}`);
  }
  take("bool"); take("inAperture"); take("("); take("vec3"); take("p"); take(")"); take("{");
  const env = {};
  while (!(tokens[at] === "return" && tokens[at+1] === "false")) statement(env, literal(1));
  take("return"); take("false"); take(";"); take("}");
  if (at !== tokens.length || !regions.length) throw new Error("unsupported aperture shader ending");
  // Interval arithmetic encloses every point, including a sliver between vertices.
  const truth = (a) => a[0] === 1 ? 1 : a[1] === 0 ? 0 : -1;
  function evaluate(n, bounds) {
    if (n.value !== undefined) return [n.value, n.value];
    if (n.axis !== undefined) return [bounds.min[n.axis], bounds.max[n.axis]];
    const a = evaluate(n.args[0], bounds);
    if (n.op === "&&" && truth(a) === 0) return [0,0];
    if (n.op === "||" && truth(a) === 1) return [1,1];
    if (n.op === "?" && truth(a) !== -1) return evaluate(n.args[truth(a) ? 1 : 2], bounds);
    const b = n.args[1] ? evaluate(n.args[1], bounds) : null;
    const c = n.args[2] ? evaluate(n.args[2], bounds) : null;
    const bool = (yes, no) => yes ? [1,1] : no ? [0,0] : [0,1];
    if (["+", "-", "*", "/"].includes(n.op) && ![...a,...b].every(Number.isFinite)) return [-Infinity,Infinity];
    switch (n.op) {
      case "unary+": return a;
      case "unary-": return [-a[1], -a[0]];
      case "unary!": return [1-a[1], 1-a[0]];
      case "+": return [a[0]+b[0], a[1]+b[1]];
      case "-": return [a[0]-b[1], a[1]-b[0]];
      case "*": { const v = [a[0]*b[0],a[0]*b[1],a[1]*b[0],a[1]*b[1]]; return [Math.min(...v),Math.max(...v)]; }
      case "/": { if (b[0] <= 0 && b[1] >= 0) throw new Error("shader division interval crosses zero"); const v = [a[0]/b[0],a[0]/b[1],a[1]/b[0],a[1]/b[1]]; return [Math.min(...v),Math.max(...v)]; }
      case "abs": return [a[0] <= 0 && a[1] >= 0 ? 0 : Math.min(Math.abs(a[0]),Math.abs(a[1])), Math.max(Math.abs(a[0]),Math.abs(a[1]))];
      case "min": return [Math.min(a[0],b[0]), Math.min(a[1],b[1])];
      case "max": return [Math.max(a[0],b[0]), Math.max(a[1],b[1])];
      case "clamp": {
        if (b[0] > c[1]) {
          limitations.add("emitted GLSL clamp has reversed bounds; its result is undefined");
          return [-Infinity,Infinity];
        }
        return [Math.min(Math.max(a[0],b[0]),c[0]),Math.min(Math.max(a[1],b[1]),c[1])];
      }
      case "<": return bool(a[1] < b[0], a[0] >= b[1]);
      case ">": return bool(a[0] > b[1], a[1] <= b[0]);
      case "<=": return bool(a[1] <= b[0], a[0] > b[1]);
      case ">=": return bool(a[0] >= b[1], a[1] < b[0]);
      case "==": return bool(a[0] === a[1] && b[0] === b[1] && a[0] === b[0], a[1] < b[0] || b[1] < a[0]);
      case "!=": return bool(a[1] < b[0] || b[1] < a[0], a[0] === a[1] && b[0] === b[1] && a[0] === b[0]);
      case "&&": return bool(truth(a) === 1 && truth(b) === 1, truth(a) === 0 || truth(b) === 0);
      case "||": return bool(truth(a) === 1 || truth(b) === 1, truth(a) === 0 && truth(b) === 0);
      case "?": return [Math.min(b[0],c[0]),Math.max(b[1],c[1])];
      default: throw new Error(`unsupported shader operation ${n.op}`);
    }
  }
  const cut = (bounds) => {
    let uncertain = false;
    for (const r of regions) { const t = truth(evaluate(r, bounds)); if (t === 1) return 1; if (t === -1) uncertain = true; }
    return uncertain ? -1 : 0;
  };
  cut.limitations = limitations;
  return cut;
}

function materialCut(mesh, cache) {
  if (Array.isArray(mesh.material)) throw new Error("apertures does not yet support multi-material meshes");
  const material = mesh.material;
  if (cache.has(material)) return cache.get(material);
  const shader = { uniforms: {}, vertexShader: "#include <begin_vertex>", fragmentShader: "#include <clipping_planes_fragment>" };
  material.onBeforeCompile(shader, null);
  let cut = null;
  if (/if\s*\(inAperture\(vObjPos\)\)\s*discard;/.test(shader.fragmentShader)) {
    if (!/vObjPos\s*=\s*position\s*;/.test(shader.vertexShader)) throw new Error("unknown shader cut coordinate space");
    const start = shader.fragmentShader.indexOf("bool inAperture(");
    let end = shader.fragmentShader.indexOf("{", start), level = 1;
    while (level && ++end < shader.fragmentShader.length) { if (shader.fragmentShader[end] === "{") level++; if (shader.fragmentShader[end] === "}") level--; }
    cut = readCut(shader.fragmentShader.slice(start, end+1));
  } else if (mesh.userData.cut) throw new Error("cut mesh has no supported aperture discard");
  // Dissolve is disabled by panelsT=1. Any other discard needs its own reader.
  const residue = shader.fragmentShader.replace(/bool inAperture\([\s\S]*?return false;\s*}/, "")
    .replace(/if\s*\(inAperture\(vObjPos\)\)\s*discard;/, "")
    .replace(/if \(uDissolve < 1\.0\) \{[\s\S]*?if \(dn > uDissolve\) discard; }/, "");
  if (/discard|gl_Position|#define/.test(residue) || material.isShaderMaterial || material.clippingPlanes?.length || material.alphaTest > 0) {
    throw new Error("unsupported material clipping; aperture certification refused");
  }
  cache.set(material, cut); return cut;
}

function pose(vehicle, fraction) {
  vehicle.openT = fraction; vehicle.explodeT = 0; vehicle.panelsT = 1;
  vehicle.update(0, { ...state }); vehicle.root.updateMatrixWorld(true);
}
function snapshot(vehicle, cache) {
  const meshes = new Map();
  for (const part of vehicle.order) for (const mesh of part.meshes) {
    if (meshes.has(mesh)) throw new Error("mesh registered to more than one part");
    const position = mesh.geometry.getAttribute("position"), index = mesh.geometry.getIndex();
    if (!position) continue;
    if (mesh.isInstancedMesh || mesh.isSkinnedMesh || Object.keys(mesh.geometry.morphAttributes).length) throw new Error("unsupported deformed/instanced mesh");
    const points = []; const v = new Vector3();
    for (let i = 0; i < position.count; i++) points.push(v.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld).toArray());
    const triangles = [];
    for (let i = 0; i < (index?.count ?? points.length); i += 3) {
      const p = [0,1,2].map(k => points[index ? index.getX(i+k) : i+k]);
      if (!p.flat().every(Number.isFinite)) throw new Error("non-finite model geometry");
      triangles.push({ points: p, bounds: box(p) });
    }
    meshes.set(mesh, { part: part.name, mesh, triangles, bounds: box(points), matrix: mesh.matrixWorld.clone(), inverse: mesh.matrixWorld.clone().invert(), cut: materialCut(mesh, cache) });
  }
  return meshes;
}

/** Union of the closed panel's triangle prisms, preserving concavity and gaps.
 * Axis is the inward projection axis, sign is the outward direction.
 * Minkowski expansion is an exact 2 mm box, not mitres on skinny triangles.
 */
export function deriveAperture(triangles, { axis = 2, sign = 1, depth = 0.1, tolerance = 0.002 } = {}) {
  if (![0,1,2].includes(axis) || ![-1,1].includes(sign) || !(depth > 0) || !(tolerance >= 0) || !Number.isFinite(depth+tolerance)) throw new Error("invalid aperture volume options");
  const prisms = [];
  for (const points of triangles) {
    const normal = cross(sub(points[1],points[0]),sub(points[2],points[0]));
    if (Math.abs(normal[axis]) < 1e-12) continue; // zero projected area
    const hullPoints = [];
    for (const p of points) for (const d of [0,depth]) for (const a of [-1,1]) for (const b of [-1,1]) for (const c of [-1,1]) {
      const q = p.map((v,i) => v + [a,b,c][i]*tolerance - (i === axis ? sign*d : 0));
      hullPoints.push(new Vector3(...q));
    }
    const hull = new ConvexHull().setFromPoints(hullPoints);
    const planes = [];
    for (const f of hull.faces) {
      const plane = [...f.normal.toArray(), f.constant];
      if (!planes.some(p => p.every((v,i) => Math.abs(v-plane[i]) < 1e-9))) planes.push(plane);
    }
    prisms.push({ planes, bounds: box(hullPoints.map(p => p.toArray())), normal, constant: dot(normal,points[0]), axis, sign });
  }
  if (!prisms.length) throw new Error("panel has no projected skin triangles");
  const plane = [0,1,2].filter(i => i !== axis);
  const footprint = footprint2(triangles.map(t => t.map(p => plane.map(i => p[i]))));
  return { axis, sign, depth, tolerance, prisms, plane, footprint, bounds: box(prisms.flatMap(p => [p.bounds.min,p.bounds.max])) };
}

export function clipTriangle(points, prism) {
  let poly = points;
  for (const plane of prism.planes) {
    const out = []; const n = plane.slice(0,3);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i+1)%poly.length], da = dot(n,a)-plane[3], db = dot(n,b)-plane[3];
      if (da <= EPS) out.push(a);
      if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) out.push(mix(a,b,da/(da-db)));
    }
    poly = out; if (poly.length < 3) return [];
  }
  const area = poly.slice(1,-1).reduce((s,p,i) => s + Math.hypot(...cross(sub(p,poly[0]),sub(poly[i+2],poly[0]))),0);
  return area > 1e-14 ? poly : [];
}

// Uncut intersections are exact. Shader intersections use certified interval
// rejection; an unresolved region at 0.1 mm FAILs rather than becoming a PASS.
function surviving(poly, entry, resolution, budget = { left: 20000 }) {
  if (!entry.cut) return { points: poly, uncertain: false };
  const v = new Vector3();
  const local = poly.map(p => v.fromArray(p).applyMatrix4(entry.inverse).toArray());
  const classification = entry.cut(box(local));
  if (classification === 1) return null;
  if (classification === 0) return { points: poly, uncertain: false };
  const centre = poly[0].map((_,i) => poly.reduce((s,p) => s+p[i],0)/poly.length);
  const samples = [...poly, centre];
  const witnesses = samples.filter(p => { const q = v.fromArray(p).applyMatrix4(entry.inverse).toArray(); return entry.cut(box([q])) === 0; });
  if (witnesses.length) return { points: witnesses, uncertain: false };
  if (entry.cut.limitations.size) return { points: [centre], uncertain: true };
  const bounds = box(poly);
  if (--budget.left <= 0 || Math.max(...sub(bounds.max,bounds.min)) <= resolution) return { points: [centre], uncertain: true };
  let unknown = null;
  for (let i = 1; i < poly.length-1; i++) {
    const t = [poly[0],poly[i],poly[i+1]];
    const lengths = t.map((p,k) => Math.hypot(...sub(p,t[(k+1)%3])));
    const k = lengths.indexOf(Math.max(...lengths)), a = t[k], b = t[(k+1)%3], c = t[(k+2)%3], mid = mix(a,b,0.5);
    for (const half of [[a,mid,c],[mid,b,c]]) { const hit = surviving(half,entry,resolution,budget); if (hit && !hit.uncertain) return hit; if (hit) unknown = hit; }
  }
  return unknown;
}

const skinSubs = { doorFL: [0,1], doorFR: [0,1], doorRL: [0,1,7], doorRR: [0,1,7], hood: [0], tailgate: [0,1], chargePort: [0] };
const descendant = (mesh, group) => { for (let p = mesh; p; p = p.parent) if (p === group) return true; return false; };

// Index in the opening's projection plane. This only rejects disjoint boxes;
// every candidate still goes through triangle clipping.
function prismIndex(volume) {
  const axes = [0,1,2].filter(i => i !== volume.axis), cells = new Map();
  const keys = (bounds) => {
    const out = [], [u,v] = axes, step = 0.1;
    for (let i = Math.floor(bounds.min[u]/step); i <= Math.floor(bounds.max[u]/step); i++) {
      for (let j = Math.floor(bounds.min[v]/step); j <= Math.floor(bounds.max[v]/step); j++) out.push(`${i},${j}`);
    }
    return out;
  };
  for (const prism of volume.prisms) for (const key of keys(prism.bounds)) {
    if (!cells.has(key)) cells.set(key,[]);
    cells.get(key).push(prism);
  }
  return bounds => new Set(keys(bounds).flatMap(key => cells.get(key) ?? []));
}

export function apertures(model, { depth = 0.05, edge = 0.065, lidArea = 0.1, tolerance = 0.002, shaderResolution = 0.0001 } = {}) {
  if (!(shaderResolution > 0) || !Number.isFinite(shaderResolution)) throw new Error("invalid shader resolution");
  if (!(edge >= 0) || !Number.isFinite(edge)) throw new Error("invalid edge margin");
  const vehicle = model.vehicle;
  if (typeof vehicle?.update !== "function") throw new Error("apertures needs vehicle.update(dt, state)");
  const saved = { openT: vehicle.openT, explodeT: vehicle.explodeT, panelsT: vehicle.panelsT };
  const cache = new Map();
  try {
    pose(vehicle,0); const closed = snapshot(vehicle,cache);
    const groups = new Map(vehicle.order.map(p => [p, p.group.matrix.clone()]));
    pose(vehicle,1);
    const panels = vehicle.order.filter(p => changed(groups.get(p),p.group.matrix));
    if (!panels.length) throw new Error("no panel group responds to openT");
    for (const part of vehicle.order) if (skinSubs[part.name] && !panels.includes(part)) throw new Error(`${part.name} does not respond to openT`);
    const definitions = panels.map(part => {
      const known = skinSubs[part.name];
      const selected = [...closed.values()].filter(e => e.part === part.name && (!known || known.includes(e.mesh.userData.subId ?? 0)));
      const points = selected.flatMap(e => e.triangles.map(t => t.points));
      const bounds = box(points.flat());
      // Vehicle axes are the engine's existing x-forward / y-up / z-right convention.
      const axis = part.name === "hood" ? 1 : part.name === "tailgate" ? 0 : 2;
      const sign = axis === 1 ? 1 : Math.sign(bounds.min[axis]+bounds.max[axis]) || 1;
      const volume = deriveAperture(points,{axis,sign,depth,tolerance});
      const assembly = new Set([...closed.keys()].filter(mesh => descendant(mesh,part.group)));
      if (!assembly.size) throw new Error(`${part.name} has no moving assembly`);
      return { part, volume, candidates: prismIndex(volume), assembly, selected, poses: [] };
    });
    for (const fraction of OPEN_FRACTIONS) {
      pose(vehicle,fraction); const current = fraction === 0 ? closed : snapshot(vehicle,cache);
      for (const def of definitions) {
        const found = new Map(), touching = new Set();
        for (const [mesh,entry] of current) {
          if (def.assembly.has(mesh) || !intersects(def.volume.bounds,entry.bounds)) continue;
          for (const triangle of entry.triangles) {
            if (!intersects(def.volume.bounds,triangle.bounds)) continue;
            for (const prism of def.candidates(triangle.bounds)) {
              if (!intersects(prism.bounds,triangle.bounds)) continue;
              const poly = clipTriangle(triangle.points,prism); if (!poly.length) continue;
              const hit = surviving(poly,entry,shaderResolution); if (!hit) continue;
              for (const point of hit.points) {
                const inward = prism.sign * Math.sign(prism.normal[prism.axis]) * (prism.constant-dot(prism.normal,point))/Math.hypot(...prism.normal);
                if (inward > depth) continue;             // behind the band: not at the skin
                // Where in the opening: distance to the nearest point outside the panel's footprint, in its plane.
                const inset = def.volume.footprint.inset(def.volume.plane.map(i => point[i]));
                if (inset <= edge) { touching.add(entry.part); continue; }
                const depthNow = hit.uncertain ? null : mm(Math.max(0,inward));
                const candidate = { part: entry.part, inset_mm: mm(inset), intrusionDepth_mm: depthNow, at_m: Object.fromEntries(point.map((v,i) => [AXES[i],round(v,6)])), evidence: hit.uncertain ? "shader boundary unresolved" : "surface intersection", depthIsLowerBound: !!entry.cut };
                const old = found.get(entry.part);
                if (!old || (old.evidence !== "surface intersection" && !hit.uncertain)) found.set(entry.part,candidate);
                else if (old.evidence === candidate.evidence) {
                  // at_m follows the deepest inset; depth is the deepest seen anywhere for the part.
                  if (candidate.inset_mm > old.inset_mm) { old.inset_mm = candidate.inset_mm; old.at_m = candidate.at_m; }
                  if ((depthNow ?? -1) > (old.intrusionDepth_mm ?? -1)) old.intrusionDepth_mm = depthNow;
                }
              }
            }
          }
        }
        const offenders = [...found.values()].sort((a,b) => a.part.localeCompare(b.part));
        const lid = def.volume.footprint.coverage < lidArea;
        def.poses.push({ openT: fraction, status: offenders.length ? (lid ? "INFO" : "FAIL") : "PASS", offenders, edgeContacts: [...touching].filter(p => !found.has(p)).sort() });
      }
    }
    const rows = definitions.map(d => ({ aperture: d.part.name, status: d.poses.some(p => p.status === "FAIL") ? "FAIL" : d.poses.some(p => p.status === "INFO") ? "INFO" : "PASS",
      gated: d.volume.footprint.coverage >= lidArea, note: d.volume.footprint.coverage >= lidArea ? undefined : "lid over a recess (footprint under lidArea): what it covers is measured and listed, not judged", projection: AXES[d.volume.axis], outwardSign: d.volume.sign, skinMeshes: d.selected.length, skinTriangles: d.volume.prisms.length, footprintArea_m2: round(d.volume.footprint.coverage,4), assemblyParts: [...new Set([...d.assembly].map(m => closed.get(m).part))], bounds_m: d.volume.bounds, poses: d.poses }));
    return { status: rows.some(r => r.status === "FAIL") ? "FAIL" : "PASS", model: model.path, band_mm: mm(depth), edge_mm: mm(edge), lidArea_m2: lidArea, expansion_mm: mm(tolerance),
      gate: "FAIL when surviving geometry from outside the panel's assembly lies within band_mm behind the closed skin AND more than edge_mm inside the opening's outline; geometry within edge_mm of the outline is reported as an edge contact, not a failure", shaderResolution_mm: mm(shaderResolution), depthMeasurement: "normal distance inward from the closed skin facet; restricted to the inspected volume", shaderLimitations: [...new Set([...cache.values()].filter(Boolean).flatMap(c => [...c.limitations]))], openFractions: OPEN_FRACTIONS, apertures: rows };
  } finally {
    Object.assign(vehicle,saved); vehicle.update(0,{...state}); vehicle.root.updateMatrixWorld(true);
  }
}
