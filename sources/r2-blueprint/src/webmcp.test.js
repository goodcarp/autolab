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

test('all 19 tools have closed schemas, titles and complete annotations; the tour rides the dispatcher', async t => {
  browser(t);
  const ctx = sheet(); const api = installWebMCP(ctx);
  assert.equal(api.tools.length, 19);
  assert.equal(new Set(api.tools.map(x => x.name)).size, 19);
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
  await api.call('get_specification');
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
  assert.equal(registerTool.mock.callCount(), 19);
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
  assert.equal(registerTool.mock.callCount(), 19);
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
  assert.equal(registerTool.mock.callCount(), 19);
  fail = false;
  t.mock.timers.tick(300); await flush();
  assert.equal(registerTool.mock.callCount(), 20);
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
