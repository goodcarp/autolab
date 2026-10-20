import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTapTracker, discoveryAction, discoveryFraming, discoveryHasTransitions, resetDiscoveryState, demoVisibility, visibleInScene, inVehicleAperture } from './discovery.js';
import { createTour } from './tour.js';

const pointer = (id = 1, x = 10, y = 10, time = 0, primary = true) => ({ pointerId: id, clientX: x, clientY: y, timeStamp: time, isPrimary: primary, button: 0 });

test('a slow opening or closing continues after the 1.5s activity deadline until the final pose', () => {
  for (const opening of [true, false]) {
    const state = resetDiscoveryState({}); state.openOn = opening; state.open = opening ? 0 : 1;
    const vehicle = { panelsT: 1 };
    let wallTime = 0, continuedAfterDeadline = false;
    while (wallTime < 1500 || discoveryHasTransitions(state, vehicle)) {
      // Five rendered frames per second, each advancing at most 50ms of simulation.
      wallTime += 200;
      state.open = Math.max(0, Math.min(1, state.open + (opening ? 1 : -1) * 0.05 / 0.8));
      if (wallTime > 1500 && discoveryHasTransitions(state, vehicle)) continuedAfterDeadline = true;
      assert.ok(wallTime < 10000, 'settled discovery must eventually sleep');
    }
    assert.equal(continuedAfterDeadline, true);
    assert.equal(state.open, opening ? 1 : 0);
    assert.equal(discoveryHasTransitions(state, vehicle), false);
  }
});

test('explosion, shell dissolve, lamp fade and lamp flash each keep discovery awake until settled', () => {
  const state = resetDiscoveryState({}), vehicle = { panelsT: 1 };
  assert.equal(discoveryHasTransitions(state, vehicle), false);
  state.explode = 0.4; assert.equal(discoveryHasTransitions(state, vehicle), true); state.explode = 0;
  vehicle.panelsT = 0.5; assert.equal(discoveryHasTransitions(state, vehicle), true); vehicle.panelsT = 1;
  state.lightsT = 0.2; assert.equal(discoveryHasTransitions(state, vehicle), true); state.lightsT = 0.0005;
  assert.equal(discoveryHasTransitions(state, vehicle), false, 'imperceptible lamp residue does not keep the GPU awake');
  assert.equal(discoveryHasTransitions(state, vehicle, 0.3), true);
  assert.equal(discoveryHasTransitions(state, vehicle, 0.6), false);
});

test('doors, lamps, rear lamp strip and wheels map to the three discovery actions', () => {
  for (const part of ['doorFL', 'doorFR', 'doorRL', 'doorRR', 'hood', 'tailgate', 'chargePort']) assert.equal(discoveryAction(part), 'open');
  for (const part of ['headlamps', 'lightBar', 'tailPills']) assert.equal(discoveryAction(part), 'lights');
  assert.equal(discoveryAction('tailgate', 8), 'lights');
  for (const part of ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR']) assert.equal(discoveryAction(part), 'drive');
  for (const part of ['body', 'roofGlass', 'battery', undefined]) assert.equal(discoveryAction(part), null);
});

test('a short tap triggers once; dragging, moving away and back, and long presses never do', () => {
  const tap = createTapTracker();
  tap.down(pointer()); assert.equal(tap.up(pointer(1, 12, 11, 150)), true);
  assert.equal(tap.up(pointer(1, 12, 11, 160)), false);
  tap.down(pointer()); tap.move(pointer(1, 30, 10, 100)); assert.equal(tap.up(pointer(1, 30, 10, 150)), false);
  tap.down(pointer()); tap.move(pointer(1, 15, 10, 80)); tap.move(pointer(1, 10, 10, 100)); assert.equal(tap.up(pointer(1, 10, 10, 150)), false);
  tap.down(pointer()); assert.equal(tap.up(pointer(1, 10, 10, 800)), false);
});

test('pinch gestures cannot become accidental taps in either finger-lift order', () => {
  for (const order of [[1, 2], [2, 1]]) {
    const tap = createTapTracker();
    tap.down(pointer()); tap.down(pointer(2, 40, 10, 50, false));
    tap.move(pointer(2, 60, 10, 80, false));
    for (const id of order) assert.equal(tap.up(pointer(id, id === 1 ? 10 : 60, 10, 150, id === 1)), false);
    tap.down(pointer(3)); assert.equal(tap.up(pointer(3, 10, 10, 100)), true, 'a later independent tap still works');
  }
});

test('canceled pointers and the tap that interrupts a moving tour cannot trigger a component', () => {
  const tap = createTapTracker();
  tap.down(pointer(), true); assert.equal(tap.up(pointer(1, 10, 10, 100)), false);
  tap.down(pointer()); tap.cancel(pointer()); assert.equal(tap.up(pointer(1, 10, 10, 100)), false);
});

test('tour completion and interruption both leave a composed, closed, paused discovery state', async () => {
  for (const reason of ['complete', 'pointer', 'key', 'visibility']) {
    const state = { vehicleContext: { paint: 'Silver' }, run: true, drive: true, lights: true, panels: false, explode: 1, explodeOn: true, open: 1, openOn: true, speed: 48, steer: 7 };
    let advance;
    const tour = createTour({ steps: [{ id: 'last', dwell: 10, actions: [] }], call() {}, schedule: fn => { advance = fn; return () => {}; }, onStop: () => resetDiscoveryState(state) });
    await tour.start();
    if (reason === 'complete') advance(); else tour.stop(reason);
    assert.equal(tour.state().running, false);
    assert.deepEqual([state.view, state.run, state.drive, state.lights, state.panels, state.explode, state.explodeOn, state.open, state.openOn, state.speed], ['iso', false, false, false, true, 0, false, 0, false, 0]);
    assert.deepEqual(state.vehicleContext, { paint: 'Silver' });
  }
});

test('demo visibility accepts only boolean messages from the same-origin embedding parent', () => {
  const parent = {}, self = {}, origin = 'https://autolab.test';
  const options = { parent, self, origin };
  const event = { source: parent, origin, data: { type: 'autolab-demo-visibility', visible: false } };
  assert.equal(demoVisibility(event, options), false);
  assert.equal(demoVisibility({ ...event, data: { ...event.data, visible: true } }, options), true);
  for (const bad of [{ ...event, source: {} }, { ...event, origin: 'https://elsewhere.test' }, { ...event, data: { ...event.data, visible: 'false' } }, { ...event, data: null }]) assert.equal(demoVisibility(bad, options), null);
  assert.equal(demoVisibility(event, { ...options, self: parent }), null);
});

test('hidden ancestors exclude nested wheel and lamp meshes from picking', () => {
  const root = { visible: false }, group = { visible: true, parent: root }, mesh = { visible: true, parent: group };
  assert.equal(visibleInScene(mesh), false);
  root.visible = true; assert.equal(visibleInScene(mesh), true);
  mesh.visible = false; assert.equal(visibleInScene(mesh), false);
});

const threeUrl = new URL('../../universal-vehicle-configurator/node_modules/three/build/three.module.js', import.meta.url).href;
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const readSource = async name => (await readFile(new URL(name, import.meta.url), 'utf8')).replace("from 'three'", `from '${threeUrl}'`);
const geomUrl = dataUrl(await readSource('./geom.js'));
const roundedUrl = new URL('../../universal-vehicle-configurator/node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js', import.meta.url).href;
const modelSource = (await readSource('./vehicle.js')).replace("from './geom.js'", `from '${geomUrl}'`).replace("from 'three/addons/geometries/RoundedBoxGeometry.js'", `from '${roundedUrl}'`);
const { buildVehicle, CUT } = await import(dataUrl(modelSource));
const { Vector3, Raycaster } = await import(threeUrl);
const { Rig, presentationFit } = await import(dataUrl((await readSource('./camera.js')).replace("from './geom.js'", `from '${geomUrl}'`)));

test('actual model raycasts choose visible doors, hood and tires through the authored shell apertures', () => {
  const car = buildVehicle(); car.update(0, { run: false, drive: false, speed: 0, steer: 0, time: 0 }); car.root.updateMatrixWorld(true);
  const choose = (origin, direction) => {
    const hits = new Raycaster(new Vector3(...origin), new Vector3(...direction)).intersectObjects(car.pickables, false);
    return hits.find(hit => visibleInScene(hit.object) && (!hit.object.userData.cut || !inVehicleAperture(hit.object.worldToLocal(hit.point.clone()), CUT)))?.object.userData.part.name;
  };
  assert.equal(choose([0.2, 0.9, 4], [0, 0, -1]), 'doorFR');
  assert.equal(choose([-0.6, 0.9, 4], [0, 0, -1]), 'doorRR');
  assert.equal(choose([1.7, 4, 0], [0, -1, 0]), 'hood');
  assert.equal(choose([car.SPEC.XF, 0.4, 4], [0, 0, -1]), 'wheelFR');
  assert.ok(car.parts.tailgate.meshes.some(mesh => mesh.userData.subId === 8), 'the rendered rear light strip is authored on tailgate subId 8');
  car.root.visible = false;
  assert.equal(choose([0.2, 0.9, 4], [0, 0, -1]), undefined);
});

test('the tighter Home discovery framing contains closed and open components above its footer', () => {
  const car = buildVehicle();
  for (const [width, height] of [[490, 220], [350, 210], [450, 160]]) for (const open of [0, 1]) {
    car.openT = open; car.update(0, { run: false, drive: false, speed: 0, steer: 0, time: 0 }); car.root.updateMatrixWorld(true);
    const fit = discoveryFraming(false), rig = new Rig();
    rig.setViewport(width / height, fit.fitHeight); Object.assign(rig, presentationFit('iso', 0, open)); rig.tyOffset += fit.tyOffset;
    rig.goTo('iso', 0); rig.apply(width / height);
    for (const part of car.order) for (const mesh of part.meshes) {
      mesh.geometry.computeBoundingBox(); const { min, max } = mesh.geometry.boundingBox;
      for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
        const p = rig.project(new Vector3(x, y, z).applyMatrix4(mesh.matrixWorld), width, height);
        assert.ok(!p.behind && p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height, `${width}×${height}, open ${open}, ${part.name}: ${JSON.stringify(p)}`);
      }
    }
  }
});
