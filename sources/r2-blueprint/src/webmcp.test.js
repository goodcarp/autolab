import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CONFIG, toggleMotionState } from './config.js';

// No WebGL is needed to inspect declarations or exercise browser registration.
const source = (await readFile(new URL('./webmcp.js', import.meta.url), 'utf8'))
  .replace("import * as THREE from 'three';", 'const THREE = { Box3: class { makeEmpty() { return this; } isEmpty() { return true; } }, Vector3: class {} };');
const { installWebMCP, watchWebMCP } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function browser(t, doc = {}, nav = {}, framed = false) {
  const win = { addEventListener() {}, removeEventListener() {} };
  win.top = framed ? {} : win;
  for (const [name, value] of Object.entries({ document: { body: { classList: { contains: () => false, toggle() {} } }, ...doc }, navigator: nav, window: win, location: { origin: 'http://localhost' } })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => { if (old) Object.defineProperty(globalThis, name, old); else delete globalThis[name]; });
  }
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
}
// The drawing's own context, as the tools see it, with nothing rendered.
function sheet(overrides = {}) {
  const st = { view: 'iso', run: true, drive: false, lights: false, panels: true, explode: 0, open: 0, explodeOn: false, openOn: false, hidePanels: false, hoverPart: null,
    vehicleContext: { build: 'Hudian RX2', paint: 'Not supplied', wheels: 'Not supplied', interior: 'Not supplied', rangeMiles: null, vehicleTotal: null, revision: 1 } };
  const rig = { cur: { az: 20, el: 18, dist: 8, ortho: 0, tx: 0, ty: 0.8, tz: 0 }, view: 'iso', settled: true, fov: 36, userZoom: false, grab() { rig.view = null; }, zoom(f) { rig.cur.dist *= f; } };
  const ui = { setView() {}, showViewTitle() {}, showPanels() {}, setCards() {}, setAgentTools() {} };
  const stopped = [];
  return { st, rig, ui, overlay: { setView() {} }, setView(v) { st.view = v; rig.view = v; }, motion() {}, select() {}, config: CONFIG,
    vehicle: { order: [], parts: {}, SPEC: { length: 4.715 } }, tourState: () => ({ running: false, step: 0, of: CONFIG.tour.length }), startTour: () => ({ running: true }), stopTour: (why) => { stopped.push(why); return { running: false }; }, stopped, ...overrides };
}

test('reset restores every motion after repeated demonstrations and reports the resulting state', async t => {
  browser(t);
  const ctx = sheet(); const selected = [];
  ctx.motion = motion => toggleMotionState(ctx.st, motion);
  ctx.select = part => selected.push(part);
  const api = installWebMCP(ctx);
  for (const motion of ['drive', 'lights', 'panels', 'explode', 'open']) await api.call('set_motion', { motion, on: true });
  await api.call('set_view', { view: 'front' });
  const expected = { run: true, drive: false, lights: false, panels: false, explode: false, open: false };
  const first = await api.call('reset');
  assert.deepEqual(first.motions, expected);
  assert.equal(first.view, 'iso');
  assert.equal(first.annotations_visible, true);
  assert.equal(selected.at(-1), null);
  assert.equal(ctx.st.panels, true, 'the shell is visible again');
  assert.deepEqual((await api.call('reset')).motions, expected, 'reset is idempotent');
  assert.deepEqual((await api.call('get_state')).motions, expected);
  api.dispose();
});

test('all 25 tools have closed schemas, titles and complete annotations; the tour rides the dispatcher', async t => {
  browser(t);
  const ctx = sheet(); const api = installWebMCP(ctx);
  assert.equal(api.tools.length, 25);
  assert.equal(new Set(api.tools.map(x => x.name)).size, 25);
  for (const tool of api.tools) {
    assert.ok(tool.title.length > 3, tool.name);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint', 'untrustedContentHint']) assert.equal(typeof tool.annotations[k], 'boolean', `${tool.name}.${k}`);
    assert.equal(tool.annotations.destructiveHint, false, tool.name);
  }
  // an outside call interrupts the tour; the sequencer's own calls and the tour's tools do not
  await api.call('set_view', { view: 'side' });
  assert.deepEqual(ctx.stopped, ['tool']);
  await api.callTour('set_view', { view: 'front' }); await api.call('get_state');
  await api.call('set_vehicle_context', { build: 'Performance', paint: 'Silver', wheels: '21 in', interior: 'Black', rangeMiles: 330, vehicleTotal: 59485, revision: 5 });
  await api.call('get_specification'); await api.call('get_vehicles');
  assert.deepEqual(ctx.stopped, ['tool'], 'reads and the context sync are not interruptions');
  await api.call('stop_tour');            // stop_tour itself stops, on purpose
  assert.deepEqual(ctx.stopped, ['tool', 'tool']);
  assert.equal(globalThis.window.r2.callTour, undefined);
  // validation runs on every surface, with the recovery in the message
  await assert.rejects(api.call('set_view', { view: 'nope' }), /must be one of/);
  await assert.rejects(api.call('frame_point', { x: 99, y: 1, z: 0 }), /at most 4/);
  await assert.rejects(api.call('start_tour', { from: 0 }), /at least 1/);
  assert.equal((await api.get_state()).tour.of, CONFIG.tour.length);
  api.dispose();
});

test('framed: no browser registration, registration resolves false, the bridge still answers', async t => {
  const registerTool = t.mock.fn(async () => {});
  browser(t, { modelContext: { registerTool } }, {}, true);
  const api = installWebMCP(sheet());
  assert.equal(await api.registration, false);
  assert.equal(registerTool.mock.callCount(), 0);
  assert.equal(api.framed, true);
  api.dispose();
});

test('Home demo keeps its tour dispatcher private without registration, bridge or tools UI', async t => {
  const registerTool = t.mock.fn(async () => {});
  browser(t, { modelContext: { registerTool } });
  const listen = t.mock.fn(); window.addEventListener = listen;
  const ctx = sheet({ internalOnly: true });
  const renderTools = t.mock.fn(); ctx.ui.setAgentTools = renderTools;
  const api = installWebMCP(ctx);
  assert.equal(window.r2, undefined);
  assert.equal(listen.mock.callCount(), 0);
  assert.equal(renderTools.mock.callCount(), 0);
  assert.equal(registerTool.mock.callCount(), 0);
  await api.callTour('set_view', { view: 'side' });
  assert.equal(ctx.st.view, 'side');
  assert.deepEqual(ctx.stopped, [], 'tour calls still use the private non-interrupting dispatcher');
  t.mock.timers.tick(13000); await flush();
  assert.equal(registerTool.mock.callCount(), 0, 'no registration watcher was started');
  api.dispose();
});

test('document registerTool wins over navigator and provideContext; every tool registers once with its title', async t => {
  const registerTool = t.mock.fn(async () => {}), provideContext = t.mock.fn(), navRegister = t.mock.fn(async () => {});
  browser(t, { modelContext: { registerTool, provideContext } }, { modelContext: { registerTool: navRegister } });
  const api = installWebMCP(sheet());
  assert.equal(await api.registration, true);
  assert.equal(registerTool.mock.callCount(), 25);
  assert.equal(provideContext.mock.callCount(), 0); assert.equal(navRegister.mock.callCount(), 0);
  assert.equal(api.registered, true); assert.equal(api.api, 'document.modelContext.registerTool');
  assert.ok(registerTool.mock.calls.every(c => typeof c.arguments[0].title === 'string' && c.arguments[0].annotations));
  api.dispose();
});

test('late navigator injection registers once and execute uses the shared dispatcher', async t => {
  browser(t);
  const api = installWebMCP(sheet());
  const registerTool = t.mock.fn(async () => {});
  await flush(); t.mock.timers.tick(1000); await flush();
  globalThis.navigator.modelContext = { registerTool };
  t.mock.timers.tick(300); await flush(); t.mock.timers.tick(300); await flush();
  assert.equal(registerTool.mock.callCount(), 25);
  assert.equal(await api.registration, true);
  const decl = registerTool.mock.calls.find(c => c.arguments[0].name === 'get_state').arguments[0];
  const result = await decl.execute({});
  assert.equal(result.view, 'iso');
  const bad = await decl.execute({ extra: 1 });
  assert.equal(bad.isError, true);
  api.dispose();
});

test('provideContext is used only as fallback', async t => {
  const provideContext = t.mock.fn();
  browser(t, {}, { modelContext: { provideContext } });
  const api = installWebMCP(sheet());
  await flush();
  assert.equal(provideContext.mock.callCount(), 1);
  assert.equal(await api.registration, true);
  assert.equal(api.api, 'navigator.modelContext.provideContext');
  api.dispose();
});

test('the watch expires at 12 seconds without an API', async t => {
  browser(t);
  const none = installWebMCP(sheet());
  t.mock.timers.tick(12500); await flush();
  assert.equal(await none.registration, false);
  assert.equal(none.registered, false);
  none.dispose();
});

test('failed registration retries only the tools that failed', async t => {
  t.mock.method(console, 'warn', () => {});
  let fail = true;
  const registerTool = t.mock.fn(async (tool) => { if (fail && tool.name === 'measure') throw new Error('flaky'); });
  browser(t, { modelContext: { registerTool } });
  const api = installWebMCP(sheet());
  await flush();
  assert.equal(registerTool.mock.callCount(), 25);
  fail = false;
  t.mock.timers.tick(300); await flush();
  assert.equal(registerTool.mock.callCount(), 26);
  assert.equal(await api.registration, true);
  api.dispose();
});

test('watchWebMCP stops on abort', async t => {
  browser(t);
  const controller = new AbortController(); let outcome = null;
  const stop = watchWebMCP({ tools: [] }, async () => ({}), controller.signal, (ok) => { outcome = ok; });
  controller.abort(); await flush();
  assert.equal(outcome, false); stop();
});

// Two cars behind the same tools: the registry and the swap come in through ctx, because this
// module is loaded from a data: URL in these tests and cannot import vehicles.js itself.
function fleet(t) {
  const rx2Car = { order: [{ name: 'battery', label: 'BATTERY', category: 'chassis' }], parts: {}, SPEC: { length: 4.715, height: 1.699 } };
  const roadsterCar = { order: [{ name: 'doorFR', label: 'RIGHT DOOR', category: 'shell' }, { name: 'fans', label: 'DOWNFORCE FANS', category: 'chassis' }], parts: {}, SPEC: { id: 'roadster', label: 'Roadster', length: 4.382, height: 1.148, mass: 1700 } };
  const ROADSTER = { ...CONFIG, tour: CONFIG.tour.slice(0, 9), opens: 'the two gull-wing doors', specBasis: 'Tesla basis.', cabin: { z: 0.8, y0: 0.2, y1: 1.05 } };
  const vehicles = [{ id: 'rx2', label: 'Hudian RX2', config: CONFIG, play: false }, { id: 'roadster', label: 'Tesla Roadster', config: ROADSTER, play: true }];
  const cars = { rx2: rx2Car, roadster: roadsterCar };
  let id = 'rx2';
  const ctx = sheet({ vehicles });
  Object.defineProperties(ctx, {
    vehicle: { get: () => cars[id], configurable: true },
    config: { get: () => vehicles.find(v => v.id === id).config, configurable: true },
    vehicleId: { get: () => id, configurable: true },
  });
  ctx.swaps = [];
  ctx.setVehicle = t.mock.fn(async (next) => { ctx.stopTour('vehicle'); if (next === id) return false; ctx.swaps.push(next); id = next; return true; });
  return ctx;
}

test('get_vehicles lists both cars without interrupting; set_vehicle swaps and every reply follows the current car', async t => {
  browser(t);
  const ctx = fleet(t); const api = installWebMCP(ctx);
  const set = api.tools.find(x => x.name === 'set_vehicle'), get = api.tools.find(x => x.name === 'get_vehicles');
  assert.deepEqual(set.inputSchema.properties.vehicle.enum, ['rx2', 'roadster']);
  assert.deepEqual(set.inputSchema.required, ['vehicle']);
  assert.equal(set.annotations.idempotentHint, true); assert.equal(set.annotations.readOnlyHint, false);
  assert.equal(get.annotations.readOnlyHint, true);
  const listed = await api.call('get_vehicles');
  assert.deepEqual(ctx.stopped, [], 'get_vehicles is a read');
  assert.equal(listed.current, 'rx2');
  assert.deepEqual(listed.vehicles.map(v => [v.id, v.current, v.run_mode, v.tour_steps]), [['rx2', true, false, 9], ['roadster', false, true, 9]]);
  assert.equal(listed.vehicles[0].part_count, 1);
  assert.deepEqual((await api.call('get_state')).vehicle, { id: 'rx2', label: 'Hudian RX2' });
  assert.equal((await api.call('get_specification')).basis, CONFIG.specBasis);
  await assert.rejects(api.call('set_vehicle', { vehicle: 'cybertruck' }), /must be one of: rx2, roadster/);
  await assert.rejects(api.call('set_vehicle', {}), /requires vehicle/);
  const swapped = await api.call('set_vehicle', { vehicle: 'roadster' });
  assert.equal(swapped.vehicle, 'roadster'); assert.equal(swapped.changed, true);
  assert.deepEqual(swapped.state.vehicle, { id: 'roadster', label: 'Tesla Roadster' });
  assert.ok(ctx.stopped.includes('tool'), 'switching the car interrupts the tour');
  const parts = await api.call('list_parts');
  assert.equal(parts.vehicle, 'roadster'); assert.deepEqual(parts.parts.map(p => p.id), ['doorFR', 'fans']);
  const spec = await api.call('get_specification');
  assert.equal(spec.vehicle, 'roadster'); assert.equal(spec.basis, 'Tesla basis.'); assert.equal(spec.mass_kg, 1700);
  assert.deepEqual(spec.dimensions_m, { length: 4.382, height: 1.148 }, 'lengths only');
  assert.equal((await api.call('frame_point', { x: 0, y: 1.2, z: 0 })).hint, undefined, '1.2 m is above the Roadster\'s roof');
  assert.ok((await api.call('frame_point', { x: 0, y: 0.8, z: 0 })).hint);
  assert.equal((await api.call('get_vehicles')).current, 'roadster');
  assert.equal((await api.call('set_vehicle', { vehicle: 'roadster' })).changed, false, 'the same car again changes nothing');
  assert.deepEqual(ctx.swaps, ['roadster']);
  api.dispose();
});

test('each car keeps its own configurator sync: revisions are checked against the car on the sheet', async t => {
  browser(t);
  const ctx = fleet(t); const api = installWebMCP(ctx);
  const context = (build, revision) => ({ build, paint: 'Silver', wheels: '21 in', interior: 'Black', rangeMiles: 330, vehicleTotal: 59485, revision });
  await api.call('set_vehicle_context', context('Performance', 5));
  assert.equal((await api.call('get_state')).vehicle_context_synced, true);
  await api.call('set_vehicle', { vehicle: 'roadster' });
  assert.equal((await api.call('get_state')).vehicle_context_synced, false, 'the RX2\'s sync says nothing about the Roadster');
  const first = await api.call('set_vehicle_context', context('Roadster', 1));
  assert.equal(first.synced, true, 'revision 1 is not stale against the RX2\'s revision 5');
  await api.call('set_vehicle', { vehicle: 'rx2' });
  assert.equal((await api.call('get_state')).vehicle_context_synced, true);
  await assert.rejects(api.call('set_vehicle_context', context('Performance', 4)), /stale vehicle context revision 4; Garage is already at revision 5/);
  await assert.rejects(api.call('set_vehicle_context', context('Standard', 5)), /conflicts/);
  assert.equal((await api.call('set_vehicle_context', context('Performance', 5))).changed, false);
  api.dispose();
});

test('a sheet without a registry still answers get_vehicles and refuses set_vehicle', async t => {
  browser(t);
  const api = installWebMCP(sheet());
  const listed = await api.call('get_vehicles');
  assert.equal(listed.vehicles.length, 1);
  assert.equal(listed.vehicles[0].current, true);
  await assert.rejects(api.call('set_vehicle', { vehicle: 'roadster' }), /cannot switch/);
  api.dispose();
});

// A run mode as the tools see it (run-mode.js runs for real in run-mode.test.js).
function fakeRun(t) {
  let on = false, last = null, held = {};
  return {
    calls: [],
    active: () => on,
    start: t.mock.fn(async ({ autopilot = null } = {}) => { on = true; held = {}; return true; }),
    stop: t.mock.fn(() => { if (!on) return false; on = false; last = { outcome: 'running' }; return true; }),
    setInputs: t.mock.fn((inp) => { if (!on) throw new Error('No run is on. Call start_run first.'); Object.assign(held, inp); return { ...held }; }),
    status: () => (on ? { active: true, outcome: 'running', inputs: { throttle: 0 } } : { active: false, starting: false, last }),
  };
}

test('the run tools: closed schemas and annotations, start_run moves to the Roadster, get_run_state never interrupts, reset ends a run', async t => {
  browser(t);
  const ctx = fleet(t); ctx.run = fakeRun(t);
  const api = installWebMCP(ctx);
  const tool = (n) => api.tools.find(x => x.name === n);
  assert.deepEqual(['start_run', 'stop_run', 'set_drive_inputs', 'get_run_state'].map(n => [tool(n).annotations.readOnlyHint, tool(n).annotations.idempotentHint]),
    [[false, false], [false, true], [false, true], [true, true]]);
  assert.deepEqual(tool('start_run').inputSchema.properties.autopilot.enum, ['wallride', 'hop']);
  assert.deepEqual(Object.keys(tool('set_drive_inputs').inputSchema.properties), ['throttle', 'brake', 'steer', 'fans', 'boost', 'hop', 'yawL', 'yawR', 'wing']);
  const read = await api.call('get_run_state');
  assert.equal(read.active, false); assert.equal(read.run_mode_available, false, 'the RX2 has no run mode');
  assert.deepEqual(ctx.stopped, [], 'reading the run is not an interruption');
  await assert.rejects(api.call('start_run', { autopilot: 'loop' }), /must be one of: wallride, hop/);
  const started = await api.call('start_run', { autopilot: 'wallride' });
  assert.deepEqual(ctx.swaps, ['roadster'], 'start_run put the Roadster on the sheet first');
  assert.deepEqual(ctx.run.start.mock.calls[0].arguments[0], { autopilot: 'wallride' });
  assert.equal(started.active, true); assert.deepEqual(started.vehicle, { id: 'roadster', label: 'Tesla Roadster' });
  assert.ok(ctx.stopped.includes('tool'), 'a run is a scene-moving call');
  assert.equal((await api.call('get_state')).run_active, true);
  await assert.rejects(api.call('set_drive_inputs', { steer: -1.5 }), /at least -1/);
  await assert.rejects(api.call('set_drive_inputs', { boost: 'yes' }), /must be a boolean/);
  assert.equal((await api.call('set_drive_inputs', { throttle: 0.7, wing: 'highDownforce' })).inputs.throttle, 0.7);
  await api.call('start_run');   // again: a fresh run, no switch
  assert.equal(ctx.run.stop.mock.callCount(), 1); assert.deepEqual(ctx.swaps, ['roadster']);
  assert.deepEqual(ctx.run.start.mock.calls[1].arguments[0], { autopilot: null });
  const stopped = await api.call('stop_run');
  assert.equal(stopped.stopped, true); assert.equal(stopped.active, false); assert.deepEqual(stopped.last, { outcome: 'running' });
  await api.call('start_run');
  await api.call('reset');
  assert.equal(ctx.run.active(), false, 'reset returns the sheet to how it opens, with no run');
  // the sheet's own camera and motion tools end a run first; reads and the run's own tools do not
  for (const [name, args] of [['set_view', { view: 'side' }], ['set_motion', { motion: 'lights', on: true }], ['set_camera', { azimuth_deg: 30, elevation_deg: 20, distance_m: 9 }]]) {
    await api.call('start_run');
    await api.call(name, args);
    assert.equal(ctx.run.active(), false, `${name} ends the run`);
  }
  await api.call('start_run');
  for (const name of ['get_state', 'get_run_state', 'list_parts', 'get_specification']) await api.call(name);
  await api.call('set_drive_inputs', { throttle: 1 });
  assert.equal(ctx.run.active(), true, 'reads and set_drive_inputs leave the run on');
  api.dispose();
});
