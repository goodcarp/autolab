import test from 'node:test';
import assert from 'node:assert/strict';
import { createTour } from './tour.js';
import { CONFIG } from './config.js';

const steps = [
  { id: 'one', title: 'ONE', caption: 'One.', dwell: 6000, actions: [{ name: 'reset', args: {} }, { name: 'set_view', args: { view: 'iso' } }] },
  { id: 'two', title: 'TWO', caption: 'Two.', dwell: 6000, actions: [{ name: 'highlight_part', args: { part: 'battery' } }] },
];
function harness(options = {}) {
  let time = 0;
  const calls = [], pending = [], shown = [], stopped = [];
  const tour = createTour({ steps, call: (name, args) => calls.push([name, args]),
    onStep: (step, state) => shown.push([step.id, state.step]), onStop: (state, reason) => stopped.push(reason),
    now: () => time, schedule: (fn, ms) => { pending.push({ fn, at: time + ms }); }, ...options });
  const tick = async () => { const job = pending.shift(); time = job.at; job.fn(); for (let i = 0; i < 10; i++) await Promise.resolve(); };
  return { tour, calls, pending, shown, stopped, tick };
}
test('start runs ordered tool calls and reports the first step', async () => {
  const h = harness();
  assert.deepEqual(h.tour.state(), { running: false, step: 0, of: 2, id: null, title: null });
  await h.tour.start();
  assert.deepEqual(h.calls, [['reset', {}], ['set_view', { view: 'iso' }]]);
  assert.deepEqual(h.shown, [['one', 1]]);
  assert.equal(h.pending[0].at, 6000);
});
test('advance and complete without restoring the scene', async () => {
  const h = harness(); await h.tour.start(); await h.tick();
  assert.equal(h.tour.state().step, 2); assert.equal(h.calls.length, 3);
  await h.tick(); assert.equal(h.tour.state().running, false);
  assert.deepEqual(h.stopped, ['complete']); assert.equal(h.calls.length, 3);
});
test('stop cancels pending actions even when the scheduler cannot cancel', async () => {
  const h = harness(); await h.tour.start(); h.tour.stop('pointer'); await h.tick();
  assert.equal(h.calls.length, 2); assert.equal(h.tour.state().step, 1);
  assert.deepEqual(h.stopped, ['pointer']);
});
test('from-index is zero-based and rejects invalid starts', async () => {
  const h = harness(); await h.tour.start(1);
  assert.deepEqual(h.calls, [['highlight_part', { part: 'battery' }]]);
  assert.equal(h.tour.state().id, 'two');
  for (const i of [-1, 2, 0.5, NaN]) assert.throws(() => h.tour.start(i), RangeError);
});
test('interruption mid-step prevents the next action after an awaited tool resolves', async () => {
  let resolve;
  const calls = [];
  const h = harness({ call: (name) => { calls.push(name); return new Promise(r => { resolve = r; }); } });
  const started = h.tour.start(); h.tour.stop('tool'); resolve(); await started;
  assert.deepEqual(calls, ['reset']); assert.equal(h.pending.length, 0);
});
test('restart invalidates callbacks from the previous run', async () => {
  const h = harness(); await h.tour.start(); await h.tour.start(1);
  await h.tick(); assert.equal(h.calls.length, 3); assert.equal(h.tour.state().running, true);
  await h.tick(); assert.equal(h.tour.state().running, false);
});
test('hold completes actions and installs no advance callback', async () => {
  const h = harness({ steps: steps.map(s => ({ ...s, dwell: Infinity })) });
  await h.tour.start(1); assert.equal(h.tour.state().running, true); assert.equal(h.pending.length, 0);
});
test('stop inside onStep prevents even the first action', async () => {
  const h = harness({ onStep: () => h.tour.stop('key') }); await h.tour.start();
  assert.equal(h.calls.length, 0);
});
test('tool failure stops the tour and does not schedule further actions', async () => {
  const h = harness({ call: () => { throw new Error('failed'); } });
  await assert.rejects(h.tour.start(), /failed/); assert.deepEqual(h.stopped, ['error']);
  assert.equal(h.pending.length, 0);
});
test('authored tour keeps nine readable stops within thirty seconds', () => {
  assert.equal(CONFIG.tour.length, 9);
  assert.equal(CONFIG.tour.reduce((n, s) => n + s.dwell, 0), 30000);
  assert.equal(new Set(CONFIG.tour.map(s => s.id)).size, CONFIG.tour.length);
  for (const step of CONFIG.tour) {
    assert.ok(step.dwell >= 3000 && step.dwell <= 4000);
    assert.ok(step.caption && step.title && step.actions.length);
    for (const action of step.actions) assert.ok(['set_view', 'set_motion', 'frame_part', 'highlight_part', 'set_annotations', 'reset', 'orbit_camera', 'set_camera'].includes(action.name));
  }
  for (const id of ['open', 'explode']) assert.equal(CONFIG.tour.find(step => step.id === id).dwell, 4000);
});

test('the authored sequence reaches its final reset and completes at thirty seconds', async () => {
  const h = harness({ steps: CONFIG.tour });
  await h.tour.start();
  let deadline = 0;
  for (const step of CONFIG.tour) {
    assert.equal(h.tour.state().id, step.id);
    assert.equal(h.tour.state().running, true);
    deadline += step.dwell;
    assert.equal(h.pending[0].at, deadline);
    await h.tick();
  }
  assert.equal(deadline, 30000);
  assert.equal(h.tour.state().running, false);
  assert.equal(h.tour.state().id, 'reset');
  assert.deepEqual(h.calls, CONFIG.tour.flatMap(step => step.actions.map(action => [action.name, action.args])));
  assert.deepEqual(h.stopped, ['complete']);
  assert.equal(h.pending.length, 0);
});

test('the shorter dwell includes awaited action execution rather than adding it to the tour', async () => {
  let elapsed = 0;
  const h = harness({ steps: CONFIG.tour, now: () => elapsed, call: async () => { elapsed += 200; } });
  await h.tour.start();
  assert.equal(h.pending[0].at, 3000 - 3 * 200);
});

test('a held authored step still finishes its actions without advancing on the faster schedule', async () => {
  const h = harness({ steps: CONFIG.tour.map(step => ({ ...step, dwell: Infinity })) });
  await h.tour.start(6);
  assert.equal(h.tour.state().id, 'explode');
  assert.equal(h.tour.state().running, true);
  assert.deepEqual(h.calls, CONFIG.tour[6].actions.map(action => [action.name, action.args]));
  assert.equal(h.pending.length, 0);
  h.tour.stop('pointer');
  assert.equal(h.tour.state().running, false);
  assert.deepEqual(h.stopped, ['pointer']);
});

test('WebMCP dispatcher preserves tour calls and interrupts on external calls across surfaces', async (t) => {
  // Stub only three.js constructors; dispatch and sequencing are the real modules.
  const { readFile } = await import('node:fs/promises');
  const source = (await readFile(new URL('./webmcp.js', import.meta.url), 'utf8'))
    .replace("import * as THREE from 'three';", 'const THREE = { Box3: class {}, Vector3: class {} };');
  const { installWebMCP } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const listeners = {}, declared = [];
  const globals = { window: globalThis.window, document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), location: globalThis.location };
  t.after(() => {
    for (const key of ['window', 'document', 'location']) {
      if (globals[key] === undefined) delete globalThis[key]; else globalThis[key] = globals[key];
    }
    if (globals.navigator) Object.defineProperty(globalThis, 'navigator', globals.navigator);
    else delete globalThis.navigator;
  });
  globalThis.window = { addEventListener: (name, fn) => { listeners[name] = fn; } };
  globalThis.document = { body: { classList: { contains: () => false } } };
  globalThis.location = { origin: 'https://sheet.test' };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { modelContext: { registerTool: tool => declared.push(tool) } } });
  let tour, api;
  const calls = [], config = { ...CONFIG, tour: steps };
  const st = { run: true, panels: true, drive: false, lights: false, explodeOn: false, openOn: false, explode: 0, open: 0 };
  const ctx = { st, config, rig: { cur: { az: 52, el: 22, dist: 9, ortho: 0, ty: 0.72 } }, vehicle: { order: [], SPEC: {} },
    ui: { setCards: () => {} }, select: () => {}, setView: view => calls.push(view),
    tourState: () => tour?.state(), stopTour: reason => tour?.stop(reason),
    startTour: from => { tour?.stop('restart'); tour = createTour({ steps, call: api.callTour, schedule: () => {} }); return tour.start(from); } };
  api = installWebMCP(ctx);
  assert.equal(window.r2.callTour, undefined, 'private provenance is not exposed on window.r2');
  await window.r2.start_tour();
  assert.equal((await window.r2.get_state()).tour.running, true);
  assert.deepEqual(calls, ['iso', 'iso']);
  await window.r2.set_annotations({ visible: true }); assert.equal(tour.state().running, false);
  const starting = window.r2.start_tour();
  await window.r2.set_annotations({ visible: true }); await starting;
  assert.equal(calls.length, 3, 'external call between actions prevents the second action');
  await assert.rejects(window.r2.start_tour({ from: 0 }), /from must/);
  await window.r2.start_tour();
  await declared.find(tool => tool.name === 'set_annotations').execute({ visible: true });
  assert.equal(tour.state().running, false, 'registered tools interrupt');
  await window.r2.start_tour();
  let reply;
  await listeners.message({ origin: location.origin, source: { postMessage: body => { reply = body; } },
    data: { source: 'r2-blueprint', id: 1, tool: 'set_annotations', args: { visible: true } } });
  assert.equal(reply.ok, true); assert.equal(tour.state().running, false, 'postMessage interrupts');
  await window.r2.start_tour(); await window.r2.stop_tour();
  assert.equal(tour.state().running, false);
});
