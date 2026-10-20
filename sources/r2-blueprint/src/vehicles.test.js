import test from 'node:test';
import assert from 'node:assert/strict';
import './node-three.js';

// The real modules, three.js and both cars, under plain Node: no WebGL is needed to build a car,
// adapt it, frame it or swap it in and out of the drawing's scene.
const THREE = await import('three');
const { VEHICLES, vehicleEntry, loadVehicle, ROADSTER_PRESETS, ROADSTER_PRESENTATION } = await import('./vehicles.js');
const { Rig, PRESETS, presentationFit } = await import('./camera.js');
const { Blueprint, lampKind } = await import('./blueprint.js');
const rx2 = await loadVehicle('rx2');
const roadster = await loadVehicle('roadster');
const rest = { run: false, drive: false, time: 0, speed: 0, steer: 0 };

test('the registry lists the RX2 and the Roadster, each with a complete sheet', async () => {
  assert.deepEqual(VEHICLES.map(v => v.id), ['rx2', 'roadster']);
  assert.equal(vehicleEntry('roadster').label, 'Tesla Roadster');
  assert.equal(vehicleEntry('nope'), null);
  for (const v of VEHICLES) {
    const c = v.config;
    assert.ok(v.label && v.short, v.id);
    for (const key of ['hdrLeft', 'hdrRight', 'title', 'titleBlock', 'instr', 'views', 'motions', 'tour', 'viewTitles', 'opens', 'specBasis', 'cabin']) assert.ok(c[key], `${v.id}.${key}`);
    assert.equal(c.keyItems.length, 10, v.id);
    assert.deepEqual(c.keyItems.map(k => k.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], v.id);
    assert.deepEqual(Object.keys(v.presets).sort(), c.views.map(x => x.id).sort(), `${v.id} has a preset for every view`);
    assert.ok(v.fitHeight > 0 && v.presentation, v.id);
  }
  assert.equal(vehicleEntry('rx2').play, false, 'PLAY is the Roadster\'s');
  assert.equal(vehicleEntry('roadster').play, true);
  assert.equal(await loadVehicle('roadster'), roadster, 'each car is built once');
  await assert.rejects(loadVehicle('nope'), /unknown vehicle "nope"/);
});

test('every part, view and motion a sheet names exists on its own car', () => {
  for (const [entry, car] of [[vehicleEntry('rx2'), rx2], [vehicleEntry('roadster'), roadster]]) {
    const c = entry.config, views = new Set(c.views.map(v => v.id)), motions = new Set(c.motions.map(m => m.id));
    for (const k of c.keyItems) assert.ok(car.parts[k.part], `${entry.id} key ${k.n}: ${k.part}`);
    for (const step of c.tour) for (const { name, args } of step.actions) {
      if (args.part) assert.ok(car.parts[args.part], `${entry.id} ${step.id}: ${args.part}`);
      if (name === 'set_view') assert.ok(views.has(args.view), `${entry.id} ${step.id}: ${args.view}`);
      if (name === 'set_motion') assert.ok(motions.has(args.motion), `${entry.id} ${step.id}: ${args.motion}`);
    }
  }
});

test('the adapted Roadster carries every field the sheet reads', () => {
  const v = roadster, S = v.SPEC;
  for (const key of ['XF', 'XR', 'NOSE', 'TAIL', 'length', 'width', 'widthMirrors', 'height', 'wheelbase', 'track', 'groundClearance', 'tireR']) assert.ok(Number.isFinite(S[key]), `SPEC.${key}`);
  assert.ok(Math.abs(S.length - 4.382) < 0.01 && Math.abs(S.height - 1.148) < 0.01);
  assert.ok(v.root.isObject3D && v.body.isObject3D);
  assert.ok(Array.isArray(v.lampIds) && Array.isArray(v.tailIds));
  assert.ok(v.hidden instanceof Set);
  for (const key of ['explodeT', 'openT', 'panelsT', 'bob']) assert.equal(typeof v[key], 'number', key);
  assert.equal(typeof v.update, 'function');
  const meshes = v.order.flatMap(p => p.meshes);
  assert.equal(v.pickables.length, meshes.length);
  const ids = new Set();
  for (const p of v.order) {
    assert.ok(Number.isInteger(p.id) && !ids.has(p.id), `${p.name} has its own id`); ids.add(p.id);
    assert.ok(['shell', 'chassis', 'running', 'interior'].includes(p.category), p.name);
    assert.ok(p.label && p.desc && p.rest.isVector3 && p.explode.isVector3, p.name);
    for (const m of p.meshes) {
      assert.equal(m.userData.part, p);
      assert.ok(m.material.isMeshLambertMaterial && m.material.color.getHex() === 0xffffff && m.material.side === THREE.DoubleSide, `${m.name} is drawn in the sheet's white`);
      assert.equal(m.receiveShadow, false, m.name);
      assert.ok(m.userData.pbrMat?.isMaterial, `${m.name} keeps its lab material`);
    }
  }
  for (const [name, at] of Object.entries(v.guideAnchors)) {
    assert.ok(v.parts[name], name); assert.equal(at.length, 3); assert.ok(at.every(Number.isFinite), name);
  }
  for (const p of v.order) if (p.explode.lengthSq()) assert.ok(v.guideAnchors[p.name], `${p.name} explodes and has a guide line`);
  assert.equal(v.lampFlash.part, v.parts.fasciaFront);
  assert.equal(v.lampFlash.locals.length, 2);
});

test('lamps are flagged per mesh; the RX2 keeps its old part rule', () => {
  const flagged = (v, kind) => v.order.flatMap(p => p.meshes.filter(m => lampKind(v, p, m) === kind).map(m => `${p.name}:${m.userData.subId}`)).sort();
  // The lab's car keeps changing, so the flags are checked against its own lamp materials: every
  // head lamp glows with the lights, every tail lamp and side marker goes red, nothing else does.
  const L = roadster.lamps, marker = roadster.materials.marker;
  for (const p of roadster.order) for (const m of p.meshes) {
    const lab = m.userData.pbrMat;
    const expected = lab === L.head ? 1 : lab === L.tail || lab === marker ? 2 : 0;
    assert.equal(lampKind(roadster, p, m), expected, `${p.name}:${m.userData.subId} (${lab.name})`);
  }
  const centreX = kind => roadster.order.flatMap(p => p.meshes.filter(m => m.userData.lamp === kind).map(m => new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()).x));
  assert.ok(centreX(1).length >= 1 && centreX(1).every(x => x > 1), 'head lamps at the nose');
  assert.ok(centreX(2).some(x => x < -1.9), 'tail lamps across the tail');
  // Which sub-meshes carry the lamps changes as the lab refines the car; the parts do not.
  assert.ok(flagged(roadster, 1).some(id => id.startsWith('fasciaFront:')), 'a head lamp in the nose fascia');
  assert.ok(flagged(roadster, 2).some(id => id.startsWith('fasciaRear:')), 'a tail lamp in the rear fascia');
  const lampParts = new Set(rx2.lampIds);
  for (const p of rx2.order) for (const m of p.meshes) {
    const sub = m.userData.subId || 0;
    const expected = lampParts.has(p.id) ? 1 : (p.id === rx2.tailIds[0] && sub < 0.5) || (p.id === rx2.tailIds[1] && sub === 8) ? 2 : 0;
    assert.equal(lampKind(rx2, p, m), expected, `${p.name}:${sub}`);
  }
  assert.ok(flagged(rx2, 2).includes('tailgate:8'));
});

test('the ten Roadster key items resolve to parts anchored on their own skin', () => {
  roadster.explodeT = 0; roadster.openT = 0; roadster.update(0, rest); roadster.root.updateMatrixWorld(true);
  for (const k of vehicleEntry('roadster').config.keyItems) {
    const p = roadster.parts[k.part];
    assert.ok(p, `${k.n} ${k.part}`);
    assert.ok(p.anchor?.isVector3 && p.anchorN?.isVector3, `${k.part} has an anchor`);
    const box = new THREE.Box3();
    for (const m of p.meshes) box.expandByObject(m);
    const world = p.group.localToWorld(p.anchor.clone().sub(p.rest));
    assert.ok(box.expandByScalar(0.01).containsPoint(world), `${k.part} anchor ${world.toArray()} lies on the part`);
  }
});

test('the Roadster update honours hidden parts, PANELS, OPEN, EXPLODE, DRIVE and the run bob', () => {
  const v = roadster, st = { ...rest, run: true, time: 1 };
  v.hidden.add('brakes'); v.update(0, st);
  assert.ok(v.parts.brakes.meshes.every(m => !m.visible), 'brakes hang in the wheels and still hide');
  v.hidden.clear(); v.update(0, st);
  assert.ok(v.parts.brakes.meshes.every(m => m.visible));
  assert.notEqual(v.bob, 0, 'the body idles');
  v.panelsT = 0; v.update(0, st);
  for (const p of v.order) assert.equal(p.group.visible, p.category !== 'shell', p.name);
  assert.equal(v.dissolve.value, 0);
  v.panelsT = 1; v.update(0, st);
  const top = () => { v.root.updateMatrixWorld(true); return new THREE.Box3().setFromObject(v.parts.doorFR.group).max.y; };
  const closed = top();
  v.openT = 1; v.update(0, st);
  assert.ok(top() > closed + 0.5, 'the gull-wing rises');
  v.openT = 0; v.explodeT = 1; v.update(0, st);
  assert.ok(Math.abs(v.parts.greenhouse.group.position.y - v.parts.greenhouse.rest.y - v.parts.greenhouse.explode.y) < 1e-9);
  v.explodeT = 0;
  const before = v.spinAngle; v.update(0.1, { ...st, drive: true, speed: 40 });
  assert.ok(v.spinAngle < before, 'the wheels turn');
  v.update(0, rest); v.root.updateMatrixWorld(true);
});

test('Roadster presets keep the closed, open and exploded car inside desktop and phone stages', () => {
  const v = roadster;
  for (const [width, height] of [[1366, 830], [358, 632], [808, 236], [288, 632]]) for (const [open, explode] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    v.openT = open; v.explodeT = explode; v.update(0, rest); v.root.updateMatrixWorld(true);
    for (const view of Object.keys(ROADSTER_PRESETS)) {
      const rig = new Rig(); rig.setPresets(ROADSTER_PRESETS);
      rig.setViewport(width / height, width > 1000 ? 0 : vehicleEntry('roadster').fitHeight);
      Object.assign(rig, presentationFit(view, explode, open, ROADSTER_PRESENTATION));
      rig.goTo(view, 0); rig.apply(width / height);
      for (const part of v.order) for (const mesh of part.meshes) {
        if (!mesh.visible) continue;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const { min, max } = mesh.geometry.boundingBox;
        for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
          const p = rig.project(new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld), width, height);
          assert.ok(!p.behind && p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height, `${view} ${width}×${height}, open ${open}, explode ${explode}, ${part.name}: ${JSON.stringify(p)}`);
        }
      }
    }
  }
  v.openT = 0; v.explodeT = 0; v.update(0, rest); v.root.updateMatrixWorld(true);
});

test('Roadster presets fill about as much of the sheet as the RX2\'s do', () => {
  // The car's projected width in the ISO view, as a fraction of a 1366×830 stage.
  const span = (v, presets) => {
    const rig = new Rig(); rig.setPresets(presets); rig.setViewport(1366 / 830, 0); rig.goTo('iso', 0); rig.apply(1366 / 830);
    let lo = Infinity, hi = -Infinity; const S = v.SPEC;
    for (const x of [S.TAIL, S.NOSE]) for (const y of [0, S.height]) for (const z of [-S.width / 2, S.width / 2]) {
      const p = rig.project(new THREE.Vector3(x, y, z), 1366, 830); lo = Math.min(lo, p.x); hi = Math.max(hi, p.x);
    }
    return (hi - lo) / 1366;
  };
  const a = span(rx2, PRESETS), b = span(roadster, ROADSTER_PRESETS);
  assert.ok(Math.abs(a - b) < 0.08, `RX2 ${a.toFixed(3)} vs Roadster ${b.toFixed(3)}`);
});

test('the drawing swaps cars: removeVehicle disposes only its own G-buffer clones', () => {
  // The renderer is not needed to add and remove a car, only the scene and the materials.
  const bp = Object.create(Blueprint.prototype);
  Object.assign(bp, { scene: new THREE.Scene(), vehicleMeshes: [],
    gMatProto: new THREE.ShaderMaterial({ uniforms: { uId: { value: 0 }, uSub: { value: 0 }, uDissolve: { value: 1 }, uCut: { value: 0 }, uLamp: { value: 0 } } }),
    compMat: { uniforms: { uNose: { value: 0 }, uTail: { value: 0 } } } });
  const shared = new Set(rx2.order.flatMap(p => p.meshes.map(m => m.material)));
  const disposedShared = [];
  for (const m of shared) m.addEventListener('dispose', () => disposedShared.push(m));
  bp.addVehicle(rx2);
  const clones = bp.vehicleMeshes.map(m => m.userData.gMat);
  let disposed = 0; for (const c of clones) c.addEventListener('dispose', () => disposed++);
  assert.equal(bp.compMat.uniforms.uNose.value, rx2.SPEC.NOSE);
  bp.removeVehicle(rx2);
  assert.equal(disposed, clones.length, 'every per-mesh clone is disposed');
  assert.deepEqual(disposedShared, [], 'the RX2\'s shared materials are never disposed');
  assert.equal(bp.vehicleMeshes.length, 0);
  assert.ok(!bp.scene.children.includes(rx2.root));
  assert.ok(rx2.order.every(p => p.meshes.every(m => !m.userData.gMat && shared.has(m.material))));
  bp.addVehicle(roadster);
  assert.equal(bp.vehicleMeshes.length, roadster.pickables.length);
  assert.ok(bp.vehicleMeshes.every(m => m.userData.part === roadster.parts[m.userData.part.name]));
  assert.equal(bp.vehicleMeshes.filter(m => m.userData.gMat.uniforms.uLamp.value === 2).length, roadster.pickables.filter(m => m.userData.lamp === 2).length);
  assert.ok(bp.vehicleMeshes.every(m => m.userData.gMat.uniforms.uLamp.value === m.userData.lamp), 'each clone carries its mesh\'s lamp flag');
  assert.equal(bp.compMat.uniforms.uTail.value, roadster.SPEC.TAIL);
  bp.removeVehicle(roadster); bp.addVehicle(rx2);
  assert.equal(bp.vehicleMeshes.length, rx2.pickables.length, 'the RX2 comes back whole');
  bp.removeVehicle(rx2);
});
