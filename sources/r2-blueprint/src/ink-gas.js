// The thruster gas on the sheet, cel-shaded like the rest of the drawing: the puffs of
// rd/drive/gas.js as round blobs, and a plume at every firing jet. Three flat tones from the
// sheet's own palette and a bold ink outline, no hatching (the composite's gas branch in
// blueprint.js does the shading; this module only fills the instance buffers).
//
//   const ink = createInkGas(bp, { max: 1500 });
//   ink.update(gas, run.state.jets, dt);   // once a frame: gas is createGas() (or its view())
//   ink.clear();                           // nothing drawn until the next update
//   ink.dispose();                         // off the sheet, buffers freed
//
// Puffs: one instance per live puff, its matrix the puff's centre and radius. A puff shrinks
// away over the last quarter of its life instead of fading (a drawing has no half-ink), and its
// tone (0 dense .. 1 thin) lifts its fill, so older gas reads paler.
// Plumes: one instance per jet that is firing. The boost nozzles and the nose jets get a
// tapered flame, longer and wider with the jet's level; the corner (hover) jets a column down to
// the ground that flares where it lands. Each has a paper-white core at the nozzle that takes on
// the shade toward its end, and its length flickers a little twelve times a second, the way a
// drawn flame is animated on twos.
import * as THREE from 'three';

/** Plume sizes per jet kind: nozzle radius (m) and the length (m) at the lowest and full level. */
export const PLUME = {
  nozzle: { shape: 'taper', r: 0.1, len: [0.7, 1.9] },
  front: { shape: 'taper', r: 0.07, len: [0.35, 0.9] },
  hover: { shape: 'column', r: 0.1, len: [0.4, 2.8] },
};
const SHAPES = {
  // a flame: swells past the nozzle, then tapers to a point (radius, height; both 0..~1)
  taper: [[0, 0], [0.85, 0], [1.1, 0.06], [1.3, 0.18], [1.32, 0.3], [1.18, 0.45], [0.9, 0.62], [0.58, 0.78], [0.26, 0.92], [0, 1]],
  // a column: from the nozzle, flaring toward the ground it hits
  column: [[0, 0], [0.9, 0], [1.05, 0.12], [1.35, 0.35], [1.85, 0.62], [2.5, 0.86], [2.9, 1], [0, 1]],
};
// Tone along a plume: the base is the core at the nozzle (below 0 = paper white), the end adds
// `along` (above 0 = shaded like a puff).
const PLUME_TONE = { taper: { base: -0.5, along: 0.75 }, column: { base: -0.35, along: 0.55 } };
const MAX_JETS = 16;
// A puff's G-buffer number (sub) is its base plus its instance index: puffs 1.., plumes past them.
const SUB = { puffs: 1, taper: 200000, column: 300000 };

function shapeGeometry(points) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 18);
}

// A small deterministic hash: the same step and jet always flicker the same way.
const flick = (step, j) => { const x = Math.sin(step * 12.9898 + j * 78.233) * 43758.5453; return x - Math.floor(x); };

/**
 * createInkGas(bp, { max, size }) → { update(gas, jets, dt), clear(), dispose(), puffs, plumes, counts() }.
 * bp is the sheet's Blueprint; max is the most puffs drawn (gas.js's own max is a good choice:
 * when there are more, the newest are drawn); size scales every puff's drawn radius (gas.js's
 * radius is how far the gas reaches; drawn a little smaller, a cloud reads as separate billows).
 */
export function createInkGas(bp, { max = 1500, size = 0.85 } = {}) {
  const placeholder = new THREE.MeshBasicMaterial();
  const make = (geometry, count) => {
    geometry.setAttribute('aTone', new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.InstancedMesh(geometry, placeholder, count);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    return m;
  };
  // a puff: a 2 x 2 square, which the gas shader turns to face the camera and finds the sphere on
  const puffs = make(new THREE.PlaneGeometry(2, 2), max);
  puffs.name = 'gas puffs';
  const plumes = {};
  for (const shape of Object.keys(SHAPES)) {
    plumes[shape] = make(shapeGeometry(SHAPES[shape]), MAX_JETS);
    plumes[shape].name = `gas plumes (${shape})`;
  }
  bp.addGas(puffs, { kind: 'puffs', subBase: SUB.puffs });
  for (const [shape, m] of Object.entries(plumes)) bp.addGas(m, { kind: 'plume', subBase: SUB[shape], toneAlong: PLUME_TONE[shape].along });

  let clock = 0, disposed = false;
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), d = new THREE.Vector3(), ref = new THREE.Vector3();

  function upload(mesh, n) {
    mesh.count = n;
    for (const a of [mesh.instanceMatrix, mesh.geometry.attributes.aTone]) {
      a.clearUpdateRanges?.();
      if (n > 0) { a.addUpdateRange?.(0, n * a.itemSize); a.needsUpdate = true; }
    }
  }

  // Nearest the camera first (the camera of the sheet's last frame, bp.gasEye): the GPU then
  // skips the puffs hidden behind them instead of shading every layer of a dense cloud.
  const order = new Uint32Array(max), dist = new Float32Array(max), rad = new Float32Array(max);
  function drawPuffs(v) {
    const live = Math.max(0, Math.min(v?.count ?? 0, max));
    const from = (v?.count ?? 0) - live;   // more than fit: the newest
    const M = puffs.instanceMatrix.array, T = puffs.geometry.attributes.aTone.array;
    const eye = bp.gasEye;
    let m = 0;
    for (let k = 0; k < live; k++) {
      const i = from + k;
      const age = v.age[i] / v.life[i];
      const fade = age < 0.75 ? 1 : Math.max(0, 1 - (age - 0.75) / 0.25);
      const r = v.radius[i] * size * (0.2 + 0.8 * Math.sqrt(fade));
      if (!(r > 1e-3)) continue;
      rad[k] = r; order[m++] = k;
      if (eye) { const dx = v.pos[3 * i] - eye.x, dy = v.pos[3 * i + 1] - eye.y, dz = v.pos[3 * i + 2] - eye.z; dist[k] = dx * dx + dy * dy + dz * dz; }
    }
    if (eye && m > 1) order.subarray(0, m).sort((a, b) => dist[a] - dist[b]);
    let n = 0;
    for (; n < m; n++) {
      const k = order[n], i = from + k, r = rad[k];
      const o = n * 16;
      M[o] = r; M[o + 1] = 0; M[o + 2] = 0; M[o + 3] = 0;
      M[o + 4] = 0; M[o + 5] = r; M[o + 6] = 0; M[o + 7] = 0;
      M[o + 8] = 0; M[o + 9] = 0; M[o + 10] = r; M[o + 11] = 0;
      M[o + 12] = v.pos[3 * i]; M[o + 13] = v.pos[3 * i + 1]; M[o + 14] = v.pos[3 * i + 2]; M[o + 15] = 1;
      T[n] = v.tone[i];
    }
    upload(puffs, n);
  }

  function drawPlumes(jets) {
    const n = { taper: 0, column: 0 };
    const step = Math.floor(clock * 12);
    (jets || []).forEach((j, idx) => {
      const spec = PLUME[j.kind];
      if (!spec || !j.on || !(j.level > 0.01)) return;
      const shape = spec.shape, mesh = plumes[shape];
      if (n[shape] >= MAX_JETS) return;
      d.set(j.dir[0], j.dir[1], j.dir[2]);
      if (d.lengthSq() < 1e-8) return;
      d.normalize();
      const lv = Math.min(1, j.level);
      let len = (spec.len[0] + (spec.len[1] - spec.len[0]) * lv) * (1 + 0.14 * (flick(step, idx) - 0.5));
      // a column reaches the ground and stops there (the gas shader cuts what is under it)
      if (shape === 'column' && d.y < -0.2) len = Math.min(len, j.pos[1] / -d.y + 0.25);
      if (len < 0.05) return;
      const w = spec.r * (0.75 + 0.25 * lv) * (1 + 0.08 * (flick(step + 7, idx) - 0.5));
      ref.set(Math.abs(d.x) < 0.9 ? 1 : 0, Math.abs(d.x) < 0.9 ? 0 : 1, 0);
      e1.crossVectors(d, ref).normalize(); e2.crossVectors(e1, d);
      const M = mesh.instanceMatrix.array, o = n[shape] * 16;
      M[o] = e1.x * w; M[o + 1] = e1.y * w; M[o + 2] = e1.z * w; M[o + 3] = 0;
      M[o + 4] = d.x * len; M[o + 5] = d.y * len; M[o + 6] = d.z * len; M[o + 7] = 0;
      M[o + 8] = e2.x * w; M[o + 9] = e2.y * w; M[o + 10] = e2.z * w; M[o + 11] = 0;
      M[o + 12] = j.pos[0]; M[o + 13] = j.pos[1]; M[o + 14] = j.pos[2]; M[o + 15] = 1;
      // a harder-firing jet has a longer white core
      mesh.geometry.attributes.aTone.array[n[shape]] = PLUME_TONE[shape].base - 0.2 * lv;
      n[shape]++;
    });
    for (const shape of Object.keys(plumes)) upload(plumes[shape], n[shape]);
  }

  return {
    puffs, plumes,
    /** Draw the gas as it is now: `gas` is gas.js's createGas() or its view(); `jets` is run.state.jets. */
    update(gas, jets, dt = 0) {
      if (disposed) return;
      clock += Math.max(0, +dt || 0);
      drawPuffs(typeof gas?.view === 'function' ? gas.view() : gas);
      drawPlumes(jets);
    },
    /** Nothing drawn (until the next update). */
    clear() {
      if (disposed) return;
      clock = 0;
      upload(puffs, 0);
      for (const m of Object.values(plumes)) upload(m, 0);
    },
    /** Off the sheet, with every buffer and material this made. */
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const m of [puffs, ...Object.values(plumes)]) { bp.removeGas(m); m.geometry.dispose(); m.dispose(); }
      placeholder.dispose();
    },
    /** How many puffs and plumes are drawn now. */
    counts: () => ({ puffs: puffs.count, plumes: Object.values(plumes).reduce((a, m) => a + m.count, 0) }),
  };
}
