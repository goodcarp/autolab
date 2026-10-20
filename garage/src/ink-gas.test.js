import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './node-three.js';

// The run mode's drawing pieces under plain Node: the renderer is not needed to add and remove
// props and gas, only the scene, the materials and the instance buffers (blueprint.js addProp /
// removeProp / addGas / removeGas / setFocus / setPools, ink-gas.js).
const THREE = await import('three');
const { Blueprint, GAS_ID, PROP_ID_MIN, PROP_ID_MAX, projectionCentre } = await import('./blueprint.js');
const { createInkGas, PLUME } = await import('./ink-gas.js');

function sheet() {
  const bp = Object.create(Blueprint.prototype);
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(3.0, 9.0, 4.2);
  Object.assign(sun.shadow.camera, { left: -5.2, right: 5.2, top: 5.2, bottom: -5.2 });
  sun.shadow.mapSize.set(2048, 2048);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshLambertMaterial());
  Object.assign(bp, {
    scene: new THREE.Scene(), vehicleMeshes: [], sun, ground,
    gMatProto: new THREE.ShaderMaterial({ vertexShader: 'void main(){}', uniforms: { uId: { value: 0 }, uSub: { value: 0 }, uDissolve: { value: 1 }, uCut: { value: 0 }, uLamp: { value: 0 } } }),
    compMat: { uniforms: { uFocus: { value: new THREE.Vector2() }, uPools: { value: 1 } } },
  });
  bp.scene.add(sun, sun.target, ground);
  return bp;
}
// Count dispose events on every material and geometry under a root (and on extra objects).
function disposals(objects) {
  const seen = new Map();
  for (const o of objects) if (o && !seen.has(o)) { seen.set(o, 0); o.addEventListener('dispose', () => seen.set(o, seen.get(o) + 1)); }
  return seen;
}
function puffView(n, at = (i) => [i * 0.1, 1, 0]) {
  const v = { count: n, pos: new Float32Array(3 * n), radius: new Float32Array(n), age: new Float32Array(n), life: new Float32Array(n), tone: new Float32Array(n) };
  for (let i = 0; i < n; i++) { v.pos.set(at(i), 3 * i); v.radius[i] = 0.2 + 0.001 * i; v.age[i] = 0.1; v.life[i] = 1; v.tone[i] = i / Math.max(1, n); }
  return v;
}
const jet = (name, kind, level, pos = [0, 0.5, 0], dir = [-1, 0, 0]) => ({ name, kind, on: level > 0.01, level, pos, dir });

test('the reserved ids: props 200..239, the gas 250, and the composite branches on the same number', () => {
  assert.equal(PROP_ID_MIN, 200); assert.equal(PROP_ID_MAX, 239); assert.equal(GAS_ID, 250);
  const src = readFileSync(new URL('./blueprint.js', import.meta.url), 'utf8');
  assert.ok(src.includes(`abs(id0 - ${GAS_ID.toFixed(1)}) < 0.5`), 'the composite\'s gas branch tests the gas id');
  assert.ok(src.includes(`abs(da.y - ${GAS_ID.toFixed(1)}) < 0.5`), 'and so does its neighbour test');
});

test('addProp draws any Object3D like the car and removeProp gives it back as it came, freeing only its G-buffer clones', () => {
  const bp = sheet();
  const ramp = new THREE.Group(), holder = new THREE.Group(); holder.add(ramp);
  const ownMat = new THREE.MeshStandardMaterial(), beamMat = new THREE.MeshStandardMaterial();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3, 0.4, 10), ownMat);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 0.3), beamMat); frame.userData.subId = 3; frame.castShadow = true;
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 2, 0.2), beamMat, 6);
  const mark = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
  ramp.add(deck, frame, posts, mark);
  const watch = disposals([ownMat, beamMat, deck.geometry, frame.geometry, posts.geometry]);
  const childrenBefore = bp.scene.children.length;

  bp.addProp(ramp, { id: 205 });
  assert.equal(ramp.parent, bp.extras, 'on the sheet, in the run group');
  assert.equal(bp.extras.parent, bp.scene);
  assert.equal(bp.extras.visible, false, 'the group shows only while render() draws');
  assert.deepEqual(bp.propMeshes, [deck, frame, posts]);
  for (const m of bp.propMeshes) {
    const gm = m.userData.gMat;
    assert.ok(gm instanceof THREE.ShaderMaterial && gm !== bp.gMatProto);
    assert.equal(gm.uniforms.uId.value, 205);
    assert.equal(gm.uniforms.uSub.value, m === frame ? 3 : 0);
    assert.equal(gm.uniforms.uLamp.value, 0);
    assert.ok(m.material instanceof THREE.MeshLambertMaterial && m.material.side === THREE.DoubleSide && m.material.color.getHex() === 0xffffff, 'the RX2\'s white Lambert');
    assert.equal(m.userData.beautyMat, m.material);
    assert.equal(m.receiveShadow, true); assert.equal(m.castShadow, false);
  }
  assert.ok(posts.userData.gMat.vertexShader.includes('instanceMatrix'), 'an InstancedMesh prop gets the instanced G-buffer shader');
  assert.ok(!deck.userData.gMat.vertexShader.includes('instanceMatrix'));
  assert.equal(mark.visible, false, 'a line in a prop is hidden while it is on the sheet');
  const clones = bp.propMeshes.map((m) => m.userData.gMat);
  const cloneWatch = disposals(clones);
  const white = deck.material;
  const whiteWatch = disposals([white]);

  assert.throws(() => bp.addProp(new THREE.Mesh(), { id: 199 }), RangeError);
  assert.throws(() => bp.addProp(new THREE.Mesh(), { id: 240 }), RangeError);
  assert.throws(() => bp.addProp(new THREE.Mesh(), { id: GAS_ID }), RangeError);
  assert.throws(() => bp.addProp({}, { id: 200 }), TypeError);

  assert.equal(bp.removeProp(ramp), true);
  assert.equal(bp.removeProp(ramp), false, 'a second remove does nothing');
  for (const [, n] of cloneWatch) assert.equal(n, 1, 'each G-buffer clone disposed once');
  for (const [, n] of watch) assert.equal(n, 0, 'the prop\'s own materials and geometries are the caller\'s');
  assert.equal(whiteWatch.get(white), 0, 'the shared white Lambert stays for the next prop');
  assert.equal(deck.material, ownMat); assert.equal(frame.material, beamMat); assert.equal(posts.material, beamMat);
  assert.equal(frame.castShadow, true); assert.equal(deck.receiveShadow, false);
  assert.ok([deck, frame, posts].every((m) => !('gMat' in m.userData) && !('beautyMat' in m.userData)));
  assert.equal(mark.visible, true);
  assert.equal(ramp.parent, holder, 'back where it was');
  assert.deepEqual(bp.propMeshes, []); assert.equal(bp.props.size, 0); assert.equal(bp.extras.children.length, 0);
  assert.equal(bp.scene.children.length, childrenBefore + 1, 'only the (empty, hidden) run group stays');
});

test('props on and off a hundred times: nothing piles up and every clone is freed', () => {
  const bp = sheet();
  const made = [];
  const proto = bp.gMatProto, clone = proto.clone.bind(proto);
  const freed = new Set();
  bp.gMatProto.clone = () => { const m = clone(); made.push(m); m.addEventListener('dispose', () => freed.add(m)); return m; };
  const props = [0, 1, 2].map((i) => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()), new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())); return { g, id: 200 + i }; });
  for (let round = 0; round < 100; round++) {
    for (const p of props) bp.addProp(p.g, { id: p.id });
    if (round % 7 === 0) bp.addProp(props[0].g, { id: 200 });   // again while on the sheet: replaced, not doubled
    assert.equal(bp.propMeshes.length, 6);
    for (const p of props) bp.removeProp(p.g);
  }
  assert.equal(made.length, freed.size, `${made.length} G-buffer clones made, ${freed.size} freed`);
  assert.equal(bp.propMeshes.length, 0); assert.equal(bp.props.size, 0); assert.equal(bp.extras.children.length, 0);
});

test('setFocus follows the car (shadow snapped to the shadow map) and setFocus(null) / setPools(true) restore the sheet exactly', () => {
  const bp = sheet();
  bp.setFocus(-31.237, 4.2, 1.1);
  assert.deepEqual(bp.focus, { x: -31.237, y: 4.2, z: 1.1 });
  assert.deepEqual(bp.compMat.uniforms.uFocus.value.toArray(), [-31.237, 1.1]);
  bp._placeSun();
  const t = bp.sun.target.position, off = bp.sun.position.clone().sub(t);
  assert.ok(off.distanceTo(new THREE.Vector3(3, 9, 4.2)) < 1e-9, 'the sun keeps its direction');
  const texel = 10.4 / 2048;
  assert.ok(t.distanceTo(new THREE.Vector3(-31.237, 4.2, 1.1).addScaledVector(off.clone().normalize(), t.clone().sub(new THREE.Vector3(-31.237, 4.2, 1.1)).dot(off.clone().normalize()))) < texel, 'the shadow moved by less than a texel across the light');
  assert.deepEqual(bp.ground.position.toArray(), [-31.237, 0, 1.1]);
  bp.setPools(false); assert.equal(bp.compMat.uniforms.uPools.value, 0);
  bp.setFocus(null); bp.setPools(true);
  assert.equal(bp.focus, null);
  assert.deepEqual(bp.compMat.uniforms.uFocus.value.toArray(), [0, 0]);
  assert.deepEqual(bp.sun.position.toArray(), [3, 9, 4.2]);
  assert.deepEqual(bp.sun.target.position.toArray(), [0, 0, 0]);
  assert.deepEqual(bp.ground.position.toArray(), [0, 0, 0]);
  assert.equal(bp.compMat.uniforms.uPools.value, 1);
});

test('projectionCentre: the eye of a perspective, an orthographic and the sheet\'s blended projection', () => {
  const persp = new THREE.PerspectiveCamera(30, 1.6, 0.5, 80).projectionMatrix;
  assert.deepEqual(projectionCentre(persp).toArray().map((x) => +x.toFixed(9) + 0), [0, 0, 0, 1]);
  const ortho = new THREE.OrthographicCamera(-4, 4, 2.5, -2.5, 0.5, 80).projectionMatrix;
  assert.deepEqual(projectionCentre(ortho).toArray().map((x) => +x.toFixed(9) + 0), [0, 0, 1, 0]);
  const blend = new THREE.Matrix4();
  for (let i = 0; i < 16; i++) blend.elements[i] = persp.elements[i] * 0.5 + ortho.elements[i] * 0.5;
  const e = projectionCentre(blend);
  assert.ok(e.z > 0 && e.w > 0 && Math.abs(e.x) < 1e-12 && Math.abs(e.y) < 1e-12, 'behind the camera, at a finite distance');
  // every ray of the blend passes through that point: unproject two depths at two pixels and meet
  const inv = blend.clone().invert(), eye = new THREE.Vector3(e.x / e.w, e.y / e.w, e.z / e.w);
  for (const [x, y] of [[0.7, -0.4], [-0.9, 0.8]]) {
    const a = new THREE.Vector3(x, y, -1).applyMatrix4(inv), b = new THREE.Vector3(x, y, 1).applyMatrix4(inv);
    const d = b.clone().sub(a).normalize(), toEye = eye.clone().sub(a);
    assert.ok(toEye.clone().sub(d.clone().multiplyScalar(toEye.dot(d))).length() < 1e-6, 'the ray goes through the eye');
  }
});

test('ink gas: one puff instance per live puff (newest first when there are more), plumes only for firing jets', () => {
  const bp = sheet();
  const ink = createInkGas(bp, { max: 50, size: 1 });
  assert.equal(bp.gasMeshes.length, 3, 'puffs and two plume shapes');
  assert.ok(bp.gasMeshes.every((m) => m.isInstancedMesh && m.parent === bp.extras && m.userData.gMat.uniforms.uId.value === GAS_ID && m.frustumCulled === false));
  assert.deepEqual(ink.counts(), { puffs: 0, plumes: 0 }, 'nothing until the first update');

  ink.update(puffView(30), [], 1 / 60);
  assert.equal(ink.puffs.count, 30);
  const M = ink.puffs.instanceMatrix.array, T = ink.puffs.geometry.attributes.aTone.array;
  assert.deepEqual([M[0], M[5], M[10], M[12], M[13], M[14], M[15]].map((x) => +x.toFixed(6)), [0.2, 0.2, 0.2, 0, 1, 0, 1], 'centre and radius');
  assert.ok(Math.abs(T[29] - 29 / 30) < 1e-6, 'tone per instance');
  assert.ok(ink.puffs.instanceMatrix.needsUpdate !== false && ink.puffs.instanceMatrix.updateRanges[0].count === 30 * 16, 'only the live instances are uploaded');

  // more puffs than fit: the newest (the end of gas.js's oldest-first view)
  ink.update(puffView(80), [], 1 / 60);
  assert.equal(ink.puffs.count, 50);
  assert.ok(Math.abs(ink.puffs.instanceMatrix.array[12] - 3.0) < 1e-6, 'the first drawn is puff 30 of 80');
  // fewer again, then none, then a gas object with view()
  ink.update(puffView(7), [], 1 / 60); assert.equal(ink.puffs.count, 7);
  ink.update(null, [], 1 / 60); assert.equal(ink.puffs.count, 0);
  const v = puffView(12); ink.update({ view: () => v }, [], 1 / 60); assert.equal(ink.puffs.count, 12);
  // a puff at the end of its life shrinks away rather than fading
  const old = puffView(1); old.age[0] = 1; ink.update(old, [], 0);
  assert.ok(Math.abs(ink.puffs.instanceMatrix.array[0] - 0.2 * 0.2) < 1e-6);

  const jets = [
    jet('nozzle0', 'nozzle', 1), jet('nozzle1', 'nozzle', 0), jet('nozzle2', 'nozzle', 0.5),
    jet('fl', 'hover', 0.8, [1.66, 1.2, 0.62], [0, -1, 0]), jet('fr', 'hover', 0.005, [1.66, 0.2, -0.62], [0, -1, 0]),
    jet('frontL', 'front', 0.3, [1.98, 0.47, -0.75], [0, 0, -1]), { ...jet('ghost', 'warp', 1) }, { ...jet('stale', 'nozzle', 0.9), on: false },
  ];
  ink.update(null, jets, 1 / 60);
  assert.equal(ink.plumes.taper.count, 3, 'two nozzles and the nose jet that fire');
  assert.equal(ink.plumes.column.count, 1, 'one hover jet fires');
  assert.deepEqual(ink.counts(), { puffs: 0, plumes: 4 });
  // the plume points along the gas: its y column is dir x length, its origin the nozzle
  const P = ink.plumes.taper.instanceMatrix.array;
  assert.ok(P[4] < -PLUME.nozzle.len[1] * 0.9 && Math.abs(P[5]) < 1e-9 && Math.abs(P[6]) < 1e-9, 'a full nozzle\'s flame runs back along -x');
  assert.deepEqual([P[12], P[13], P[14]], [0, 0.5, 0]);
  // a hover column reaches the ground and no further (plus a little to sink into it)
  const C = ink.plumes.column.instanceMatrix.array;
  assert.ok(Math.abs(C[5]) <= 1.2 + 0.25 + 1e-6 && C[5] < 0);
  ink.update(null, [], 1 / 60); assert.equal(ink.counts().plumes, 0, 'a jet that stops loses its plume');

  ink.update(puffView(20), jets, 1 / 60);
  ink.clear(); assert.deepEqual(ink.counts(), { puffs: 0, plumes: 0 });
  ink.dispose();
});

test('ink gas: nearest the camera first when the sheet knows its eye', () => {
  const bp = sheet();
  const ink = createInkGas(bp, { max: 20 });
  bp.gasEye = new THREE.Vector3(10, 1, 0);
  ink.update(puffView(10, (i) => [i, 1, 0]), [], 0);
  const xs = Array.from({ length: 10 }, (_, n) => ink.puffs.instanceMatrix.array[n * 16 + 12]);
  assert.deepEqual(xs, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  const tones = Array.from(ink.puffs.geometry.attributes.aTone.array.slice(0, 10));
  assert.ok(Math.abs(tones[0] - 0.9) < 1e-6, 'each tone travels with its puff');
  ink.dispose();
});

test('ink gas: dispose takes it off the sheet and frees every buffer and material it or the sheet made for it', () => {
  const bp = sheet();
  const before = bp.scene.children.length;
  const ink = createInkGas(bp, { max: 100 });
  ink.update(puffView(40), [jet('n', 'nozzle', 1), jet('h', 'hover', 1, [0, 1, 0], [0, -1, 0])], 1 / 60);
  const meshes = [...bp.gasMeshes];
  const watch = disposals([...meshes, ...meshes.map((m) => m.geometry), ...meshes.map((m) => m.userData.gMat), meshes[0].userData.gasMaterial]);
  ink.dispose();
  for (const [o, n] of watch) assert.equal(n, 1, `${o.type || o.name || 'object'} disposed once`);
  assert.equal(bp.gasMeshes.length, 0); assert.equal(bp.extras.children.length, 0);
  assert.ok(meshes.every((m) => m.parent === null && !m.userData.gMat));
  assert.equal(bp.scene.children.length, before + 1, 'only the (empty, hidden) run group stays');
  ink.dispose(); ink.update(puffView(5), [], 0); ink.clear();   // after dispose: nothing happens, nothing throws
  for (const [, n] of watch) assert.equal(n, 1);
  // a second gas on the same sheet after the first is gone
  const again = createInkGas(bp, { max: 10 });
  again.update(puffView(3), [], 0); assert.equal(again.counts().puffs, 3);
  again.dispose(); assert.equal(bp.gasMeshes.length, 0);
});
