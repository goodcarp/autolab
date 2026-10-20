import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import './node-three.js';

// The run mode with everything real but the GPU: the adapted Roadster, the lab's drive physics
// (rd/drive), three.js, the sheet's own index.html in jsdom with the real UI. The renderer is a
// stand-in that records the props, the pools and the focus it is given.
const THREE = await import('three');
const require = createRequire(new URL('../../universal-vehicle-configurator/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const { loadVehicle } = await import('./vehicles.js');
const { Rig } = await import('./camera.js');
const { createRunMode, RUN_INSTR, outcomeMessage, runTelemetry, AUTOPILOTS } = await import('./run-mode.js');
const { keyAction, composeInputs, PAD, KEYS } = await import('./drive-controls.js');
const { CONFIG, ROADSTER_CONFIG } = await import('./config.js');
const roadster = await loadVehicle('roadster');
const rx2 = await loadVehicle('rx2');

// jsdom with the sheet, the UI, and a count of live listeners by target.
async function sheet(t) {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1/garage/?vehicle=roadster', pretendToBeVisual: true });
  const win = dom.window;
  win.matchMedia = () => ({ matches: false, addEventListener() {} });
  win.HTMLDialogElement.prototype.show = function () { this.open = true; };
  win.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  win.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const live = new Set(), onClose = [];
  const P = win.EventTarget.prototype, add = P.addEventListener, rem = P.removeEventListener;
  const key = (target, type, fn, o) => [target, type, fn, typeof o === 'boolean' ? o : !!o?.capture];
  const find = (k) => [...live].find((l) => l.every((v, i) => v === k[i]));
  P.addEventListener = function (type, fn, o) {
    const k = key(this, type, fn, o);
    if (!find(k)) { live.add(k); if (o?.signal) add.call(o.signal, 'abort', () => live.delete(find(k))); }
    return add.call(this, type, fn, o);
  };
  P.removeEventListener = function (type, fn, o) { const l = find(key(this, type, fn, o)); if (l) live.delete(l); return rem.call(this, type, fn, o); };
  const restore = [];
  for (const [name, value] of Object.entries({ window: win, document: win.document, location: win.location, localStorage: win.localStorage, requestAnimationFrame: (fn) => fn() })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    restore.push(() => { if (old) Object.defineProperty(globalThis, name, old); else delete globalThis[name]; });
  }
  // the runs stop first, while the sheet's globals are still there
  t.after(() => { for (const f of onClose) f(); for (const f of restore) f(); dom.window.close(); });
  const { UI } = await import('./ui.js');
  const ui = new UI(ROADSTER_CONFIG, { onView() {}, onMotion() {}, onKeyHover() {}, onKeySelect() {}, onReset() {}, onTour() {}, onVehicle() {}, onPlay() {} });
  return { win, doc: win.document, ui, live, onClose, count: (target) => [...live].filter((l) => (!target || l[0] === target) && !(l[0] instanceof win.AbortSignal)).length };
}

function renderer() {
  const bp = { props: new Map(), pools: [], focus: [], made: [],
    addProp(object, { id }) {
      assert.ok(id >= 200 && id <= 239, `prop id ${id} is in the props' range`);
      bp.props.set(object, id);
      object.traverse((m) => { if (m.isMesh) bp.made.push(m); });
    },
    removeProp(object) { assert.ok(bp.props.delete(object), 'only what was added is removed'); },
    setPools(on) { bp.pools.push(on); },
    setFocus(...p) { bp.focus.push(p[0] === null ? null : p); },
  };
  return bp;
}

const made = new WeakMap();
const runModeOf = (run) => made.get(run);
function runMode(t, s, over = {}) {
  const bp = renderer(), rig = new Rig(), canvas = s.doc.getElementById('gl');
  const said = [], changes = [], calls = { enter: 0, leave: 0 };
  let car = roadster, can = true;
  const run = createRunMode({ bp, rig, ui: s.ui, canvas, doc: s.doc, win: s.win, vehicle: () => car, canRun: () => can,
    say: (x) => said.push(x), onChange: (on) => changes.push(on), enter: () => calls.enter++, leave: () => calls.leave++,
    inkGas: async () => null, ...over });
  s.onClose.push(() => run.stop());
  const out = { run, bp, rig, canvas, said, changes, calls, setCar: (c) => { car = c; }, setCan: (v) => { can = v; } };
  made.set(run, out);
  return out;
}

const key = (s, type, code, init = {}) => {
  const target = init.target ?? s.doc.getElementById('gl');
  const e = new s.win.KeyboardEvent(type, { code, key: init.key ?? code, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};
const pointer = (s, el, type, pointerId, extra = {}) => el.dispatchEvent(new s.win.PointerEvent(type, { pointerId, bubbles: true, cancelable: true, button: 0, isPrimary: pointerId === 1, pointerType: 'touch', ...extra }));
const frames = (run, n) => { let st = null; for (let i = 0; i < n; i++) st = run.step(1 / 60); return st; };

test('start puts the ramp on the sheet and the car at the start line; stop takes everything away, ten times over', async (t) => {
  const s = await sheet(t);
  const { run, bp, rig, said, changes, calls } = runMode(t, s);
  const baseline = s.count(), rows = () => [...s.doc.querySelectorAll('#instr-grid .k')].map((el) => el.textContent);
  const base = { pos: roadster.root.position.clone(), quat: roadster.root.quaternion.clone() };
  for (let i = 0; i < 10; i++) {
    assert.equal(await run.start(), true);
    assert.equal(run.active(), true);
    assert.equal(await run.start(), false, 'a second PLAY is not a second run');
    assert.deepEqual([...bp.props.values()].sort(), [200, 201, 202], 'deck, frame and start line, each with its own id');
    assert.equal(bp.pools.at(-1), false, 'the lamp pools are off in a run');
    assert.ok(rig.free, 'the run has the camera');
    assert.ok(Math.abs(roadster.root.position.x + 8) < 0.01, 'the car starts at the foot, 8 m before the curl');
    assert.deepEqual(rows(), RUN_INSTR.map((r) => r.k));
    assert.equal(s.doc.querySelectorAll('#drive-pad .drive-btn').length, PAD.length);
    assert.ok(s.doc.getElementById('run-hud') && s.doc.getElementById('run-keys'));
    frames(run, 3);
    assert.ok(Array.isArray(bp.focus.at(-1)) && Math.abs(bp.focus.at(-1)[0] + 8) < 0.1, 'the grid and the shadow follow the car');
    const made = bp.made.splice(0), gone = new Set();
    for (const m of made) for (const thing of [m.geometry, m.material]) thing.addEventListener('dispose', () => gone.add(thing));
    assert.equal(run.stop(), true);
    assert.equal(run.stop(), false, 'stopping a stopped run does nothing');
    assert.equal(bp.props.size, 0);
    for (const m of made) assert.ok(gone.has(m.geometry) && gone.has(m.material), `${m.name}: geometry and material disposed`);
    assert.equal(bp.pools.at(-1), true); assert.equal(bp.focus.at(-1), null);
    assert.equal(rig.free, null, 'the camera goes back to the views');
    assert.ok(roadster.root.position.equals(base.pos) && roadster.root.quaternion.equals(base.quat), 'the car is back at the origin, at rest');
    for (const w of roadster.wheels) assert.ok(w.part.group.position.equals(w.part.rest), `${w.part.name} back at rest`);
    assert.equal(s.doc.querySelectorAll('#drive-pad, #run-hud, #run-keys').length, 0, 'no drive furniture left');
    assert.deepEqual(rows(), CONFIG.instr.map((r) => r.k), 'the telemetry rows are the car\'s again');
    assert.equal(s.count(), baseline, `run ${i + 1}: no listener left behind`);
  }
  assert.deepEqual([calls.enter, calls.leave], [10, 10]);
  assert.deepEqual(changes, Array.from({ length: 20 }, (_, i) => i % 2 === 0));
  assert.equal(said.at(-1), '');
});

test('a run needs a car with a run mode, ends when the sheet changes cars, and a stop while loading wins', async (t) => {
  const s = await sheet(t);
  const r = runMode(t, s);
  r.setCan(false);
  assert.equal(await r.run.start(), false, 'no run for a car without one');
  r.setCan(true);
  const pending = r.run.start();
  assert.equal(r.run.active(), true, 'PLAY shows STOP at once');
  r.run.stop();
  assert.equal(await pending, false, 'STOP before the drive loaded cancels it');
  assert.equal(r.bp.props.size, 0);
  assert.equal(await r.run.start(), true);
  frames(r.run, 2);
  r.setCar(rx2);
  assert.equal(r.run.step(1 / 60), null);
  assert.equal(r.run.active(), false, 'switching vehicle stops the run');
  assert.equal(r.bp.props.size, 0);
  assert.equal(r.calls.leave, 1);
  await assert.rejects(r.run.start({ autopilot: 'loop' }), /autopilot must be one of: wallride, hop/);
});

test('the wall-ride autopilot holds the overhang, through the page\'s own 60 fps path', async (t) => {
  const s = await sheet(t);
  const { run } = runMode(t, s);
  const { rig } = runModeOf(run);
  assert.equal(await run.start({ autopilot: 'wallride' }), true);
  assert.equal(run.autopilot, 'wallride');
  let maxPitch = 0, upsideDown = 0, onWall = false, maxTurn = 0, hangUp = 1, wallUp = 1;
  const lastUp = new THREE.Vector3(), carUp = new THREE.Vector3();
  for (let i = 0; i < 16 * 60; i++) {
    const st = run.step(1 / 60);
    maxPitch = Math.max(maxPitch, st.pitchDeg);
    if (st.onRamp && st.pitchDeg > 160) upsideDown++;
    if (st.onRamp && st.pitchDeg > 80 && st.pitchDeg < 100) onWall = true;
    // the chase camera: climbing the screen up the wall, the world upright under the overhang,
    // and never a sudden flip of the view on the way round or off the tip
    const up = rig.free.up;
    carUp.set(0, 1, 0).applyQuaternion(new THREE.Quaternion(...st.quat));
    if (i > 0) maxTurn = Math.max(maxTurn, lastUp.angleTo(up) * 180 / Math.PI);
    lastUp.copy(up);
    if (st.onRamp && st.pitchDeg > 80 && st.pitchDeg < 100) wallUp = Math.min(wallUp, up.dot(carUp));
    if (st.onRamp && st.pitchDeg > 165 && st.t > 9) hangUp = Math.min(hangUp, up.y);
  }
  assert.ok(wallUp > 0.9, `up the wall the view is rolled to the car (${wallUp.toFixed(2)})`);
  assert.ok(hangUp > 0.8, `on the overhang the world is upright and the car upside down (${hangUp.toFixed(2)})`);
  assert.ok(maxTurn < 12, `the view turns at most ${maxTurn.toFixed(1)} deg in a frame`);
  const st = run.status();
  assert.equal(st.outcome, 'summit');
  assert.equal(st.message, 'Held the overhang');
  assert.ok(onWall && maxPitch > 165, `round the curl to ${maxPitch.toFixed(1)} deg`);
  assert.ok(upsideDown > 60, 'upside down on the overhang for over a second');
  assert.ok(st.t_s > 15.9, `16 s of drive in 16 s of frames (${st.t_s})`);
  assert.match(s.doc.getElementById('instr-outcome').textContent, /HELD THE OVERHANG/);
});

test('the hop autopilot lifts off on the corner jets and lands on its wheels', async (t) => {
  const s = await sheet(t);
  const { run } = runMode(t, s);
  assert.equal(await run.start({ autopilot: 'hop' }), true);
  let peak = 0, gas0 = run.state.gas.kg;
  for (let i = 0; i < 10.5 * 60; i++) peak = Math.max(peak, run.step(1 / 60).altitudeFt);
  const st = run.status();
  assert.ok(peak > 20, `up to ${peak.toFixed(1)} ft`);
  assert.notEqual(st.outcome, 'crashed');
  assert.equal(st.wheels_in_contact, 4);
  assert.ok(Math.abs(st.roll_deg) < 5 && Math.abs(st.pitch_deg) < 5, 'level');
  assert.ok(gas0 - st.gas_kg > 50, 'the jets spent the tank\'s gas');
});

test('keys drive the car; the run\'s keys never reach the sheet\'s shortcuts; blur lets go', async (t) => {
  const s = await sheet(t);
  const { run } = runMode(t, s);
  const sheetKeys = [], sheetEscape = [];
  s.win.addEventListener('keydown', (e) => sheetKeys.push(e.code));                                   // main.js's shortcuts
  s.doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') sheetEscape.push(1); }, true);  // ui.js's sheet Escape
  await run.start();
  key(s, 'keydown', 'KeyW'); frames(run, 1);
  assert.equal(run.state.inputs.throttle, 1);
  key(s, 'keydown', 'ArrowUp'); key(s, 'keyup', 'KeyW'); frames(run, 1);
  assert.equal(run.state.inputs.throttle, 1, 'W and ↑ are both GO: letting one go keeps the other');
  key(s, 'keyup', 'ArrowUp'); key(s, 'keydown', 'KeyD'); key(s, 'keydown', 'ShiftLeft'); key(s, 'keydown', 'KeyQ'); frames(run, 1);
  // Shift boosts after a beat (a Shift+Tab never fires the nozzles)
  assert.equal(run.state.inputs.boost, 0, 'Shift waits a beat before it boosts');
  await new Promise((r) => setTimeout(r, 160)); frames(run, 1);
  // (the drive keeps its valve inputs as numbers, 0 or 1)
  assert.deepEqual([run.state.inputs.throttle, run.state.inputs.steer, run.state.inputs.boost, run.state.inputs.yawL], [0, 1, 1, 1]);
  key(s, 'keydown', 'KeyF'); key(s, 'keydown', 'Digit3'); frames(run, 1);
  assert.equal(run.state.inputs.fans, 1); assert.equal(run.state.inputs.wing, 'highDownforce');
  key(s, 'keydown', 'KeyF', { repeat: true }); frames(run, 1);
  assert.equal(run.state.inputs.fans, 1, 'a held F does not flicker the fans');
  const space = key(s, 'keydown', 'Space', { key: ' ' }); frames(run, 1);
  assert.equal(space.defaultPrevented, true); assert.equal(run.state.inputs.hop, 1);
  s.win.dispatchEvent(new s.win.Event('blur')); frames(run, 1);
  assert.deepEqual([run.state.inputs.steer, run.state.inputs.boost, run.state.inputs.hop, run.state.inputs.yawL], [0, 0, 0, 0], 'held keys let go on blur');
  assert.equal(run.state.inputs.fans, 1, 'latched settings stay');
  // Space on a focused control outside the drawing stays that control's
  const link = s.doc.querySelector('.header-tools a');
  const native = key(s, 'keydown', 'Space', { key: ' ', target: link });
  assert.equal(native.defaultPrevented, false);
  assert.deepEqual(sheetKeys, ['Space'], 'only the Space on the link reached the sheet');
  // Shift+Tab moves focus and never boosts; Cmd lets go of held keys (macOS drops their keyups)
  key(s, 'keydown', 'ShiftLeft'); key(s, 'keydown', 'Tab', { key: 'Tab', shiftKey: true });
  await new Promise((r) => setTimeout(r, 160)); frames(run, 1);
  assert.equal(run.state.inputs.boost, 0, 'Shift+Tab does not boost');
  key(s, 'keyup', 'ShiftLeft');
  key(s, 'keydown', 'KeyW'); frames(run, 1); assert.equal(run.state.inputs.throttle, 1);
  key(s, 'keydown', 'MetaLeft', { key: 'Meta', metaKey: true }); frames(run, 1);
  assert.equal(run.state.inputs.throttle, 0, 'Cmd lets go of W');
  // R restarts, C turns the camera, Esc stops without the sheet's Escape
  frames(run, 60);
  key(s, 'keydown', 'KeyR'); assert.ok(run.state.t < 0.01, 'R: back to the start line');
  assert.equal(run.camera(), 'chase');
  key(s, 'keydown', 'KeyC'); assert.equal(run.camera(), 'side');
  key(s, 'keyup', 'KeyC'); key(s, 'keydown', 'KeyC'); assert.equal(run.camera(), 'orbit');
  key(s, 'keydown', 'KeyC'); assert.equal(run.camera(), 'chase');
  key(s, 'keydown', 'Escape', { key: 'Escape' });
  assert.equal(run.active(), false);
  assert.deepEqual(sheetEscape, []);
});

test('the touch pad: press-and-hold buttons with multi-touch, FANS toggles, RETRY restarts, any input takes over from the autopilot', async (t) => {
  const s = await sheet(t);
  const { run } = runMode(t, s);
  await run.start({ autopilot: 'wallride' });
  frames(run, 4 * 60);   // launched, fans on
  assert.equal(run.autopilot, 'wallride');
  const btn = (a) => s.doc.querySelector(`#drive-pad [data-drive="${a}"]`);
  assert.deepEqual([...s.doc.querySelectorAll('#primary-controls .drive-btn, #primary-controls #play-btn')].map((b) => b.dataset.drive ?? b.id),
    ['play-btn', 'fans', 'hop', 'boost', 'retry', 'left', 'right', 'brake', 'go'], 'the pad follows STOP in the tray (focus order = the wide tray\'s order)');
  pointer(s, btn('go'), 'pointerdown', 1);
  assert.equal(run.autopilot, null, 'a touch takes the car back');
  frames(run, 1);
  assert.equal(run.state.inputs.fans, 1, 'the fans the autopilot had on stay on');
  pointer(s, btn('left'), 'pointerdown', 2);
  pointer(s, btn('go'), 'pointerdown', 3);
  frames(run, 1);
  assert.deepEqual([run.state.inputs.throttle, run.state.inputs.steer], [1, -1], 'two thumbs: GO and steer at once');
  assert.equal(btn('go').getAttribute('aria-pressed'), 'true');
  pointer(s, btn('go'), 'pointerup', 1); frames(run, 1);
  assert.equal(run.state.inputs.throttle, 1, 'a second finger still holds GO');
  pointer(s, btn('go'), 'pointercancel', 3); pointer(s, btn('left'), 'pointerleave', 2); frames(run, 1);
  assert.deepEqual([run.state.inputs.throttle, run.state.inputs.steer], [0, 0]);
  assert.equal(btn('go').getAttribute('aria-pressed'), 'false');
  pointer(s, btn('fans'), 'pointerdown', 4); pointer(s, btn('fans'), 'pointerup', 4); frames(run, 1);
  assert.equal(run.state.inputs.fans, 0); assert.equal(btn('fans').getAttribute('aria-pressed'), 'false');
  pointer(s, btn('retry'), 'pointerdown', 5); pointer(s, btn('retry'), 'pointerup', 5);
  assert.ok(run.state.t < 0.01, 'RETRY: back to the start line');
});

test('input mapping: keys, held actions, an agent\'s held inputs and the latched settings', () => {
  assert.equal(keyAction({ code: 'KeyW' }), 'go');
  assert.equal(keyAction({ code: 'ArrowLeft' }), 'left');
  assert.equal(keyAction({ code: 'ShiftRight' }), 'boost');
  assert.equal(keyAction({ code: 'Digit2' }), 'wing:lowDrag');
  assert.equal(keyAction({ code: 'KeyW', metaKey: true }), null, 'a browser shortcut is not driving');
  assert.equal(keyAction({ code: 'KeyT' }), null);
  assert.equal(keyAction({ code: '', key: 'Escape' }), 'stop');
  for (const action of new Set(Object.values(KEYS))) assert.ok(typeof action === 'string');
  const c = (held, o = {}) => composeInputs({ held: new Set(held), ...o });
  assert.deepEqual(c(['go']), { throttle: 1, brake: 0, steer: 0, boost: false, hop: false, yawL: false, yawR: false, fans: false, wing: 'road' });
  assert.equal(c(['brake'], { forwardSpeed: 10 }).brake, 1);
  assert.equal(c(['brake'], { forwardSpeed: 0 }).throttle, -1, 'brake at a standstill reverses');
  assert.equal(c(['left', 'right']).steer, 0);
  assert.equal(c([], { agent: { throttle: 0.4, steer: -0.3 } }).throttle, 0.4, 'an agent holds the throttle');
  assert.equal(c(['go'], { agent: { throttle: 0.4 } }).throttle, 1, 'a held key overrides it');
  assert.equal(c(['right'], { agent: { steer: -0.3 } }).steer, 1);
  assert.equal(c([], { agent: { boost: true } }).boost, true);
  assert.deepEqual([c([], { latch: { fans: true, wing: 'lowDrag' } }).fans, c([], { latch: { wing: 'sideways' } }).wing], [true, 'road']);
});

test('the outcome in plain words and the telemetry the panel shows', () => {
  const s = { outcome: 'running', pitchDeg: 92.34, speedKmh: 21.96, altitudeFt: 31.04, downforceKg: 4800.4, gForce: 1.794, gas: { psi: 5500, kg: 250, empty: false }, fans: { level: 1 } };
  assert.equal(outcomeMessage(s), null);
  assert.equal(outcomeMessage({ ...s, outcome: 'summit' }), 'Held the overhang');
  assert.equal(outcomeMessage({ ...s, outcome: 'fell' }, 108.4), 'Fell off at 108 deg');
  assert.equal(outcomeMessage({ ...s, outcome: 'crashed' }), 'Crashed');
  assert.equal(outcomeMessage({ ...s, outcome: 'crashed', events: { fell: 6.4, summit: null } }, 108.5), 'Fell off at 109 deg, then crashed');
  assert.equal(outcomeMessage({ ...s, outcome: 'crashed', events: { fell: null, summit: 7.4 } }), 'Held the overhang, then crashed');
  assert.equal(outcomeMessage({ ...s, gas: { ...s.gas, empty: true } }), 'Out of gas');
  assert.deepEqual(runTelemetry(s), { speed: '22.0 km/h', pitch: '+92.3°', alt: '31.0 ft', down: '4 800 kg', g: '1.79 g', tank: '5 500 psi', gas: '250.0 kg', fans: '100 %', outcome: 'RUNNING' });
  assert.equal(runTelemetry(s, { autopilot: 'hop' }).outcome, 'AUTOPILOT · HOP');
  assert.deepEqual(AUTOPILOTS, ['wallride', 'hop']);
});

test('the run tools on the real run mode: start_run switches to the Roadster, set_drive_inputs drives it, get_run_state reads it', async (t) => {
  const s = await sheet(t);
  const { installWebMCP } = await import('./webmcp.js');
  const { VEHICLES } = await import('./vehicles.js');
  const r = runMode(t, s);
  r.setCar(rx2);
  let current = 'rx2';
  const stopped = [];
  const st = { view: 'iso', run: true, drive: false, lights: false, panels: true, explodeOn: false, openOn: false, explode: 0, open: 0, hoverPart: null, vehicleContext: {} };
  const ctx = { st, rig: r.rig, overlay: { setView() {} }, ui: { setCards() {}, setAgentTools() {} }, setView() {}, motion() {}, select() {},
    get vehicle() { return current === 'rx2' ? rx2 : roadster; }, get config() { return current === 'rx2' ? CONFIG : ROADSTER_CONFIG; }, get vehicleId() { return current; },
    vehicles: VEHICLES, setVehicle: async (id) => { r.run.stop(); current = id; r.setCar(id === 'rx2' ? rx2 : roadster); return true; },
    run: r.run, internalOnly: true, tourState: () => ({ running: true }), stopTour: (why) => stopped.push(why) };
  const api = installWebMCP(ctx);
  assert.equal((await api.call('get_run_state')).active, false);
  assert.deepEqual(stopped, [], 'reading the run does not stop the tour');
  const started = await api.call('start_run', { autopilot: 'hop' });
  assert.equal(current, 'roadster', 'start_run put the Roadster on the sheet');
  assert.equal(started.active, true); assert.equal(started.autopilot, 'hop');
  assert.ok(Math.abs(started.position_m.x + 30) < 0.01, 'the hop starts 30 m before the foot');
  await assert.rejects(api.call('set_drive_inputs', { throttle: 2 }), /at most 1/);
  await assert.rejects(api.call('set_drive_inputs', { gear: 1 }), /unsupported field/);
  await assert.rejects(api.call('set_drive_inputs', { wing: 'up' }), /must be one of/);
  const set = await api.call('set_drive_inputs', { throttle: 0.5, fans: true, wing: 'lowDrag' });
  assert.equal(set.inputs.throttle, 0.5); assert.equal(set.autopilot, null, 'the agent took over');
  frames(r.run, 60);
  const read = await api.call('get_run_state');
  assert.ok(read.speed_kmh > 5 && read.fans_pct > 50 && read.wing === 'lowDrag', JSON.stringify(read));
  assert.equal(read.inputs.throttle, 0.5, 'held until changed');
  const end = await api.call('stop_run');
  assert.equal(end.stopped, true); assert.equal(end.active, false); assert.equal(end.last.outcome, 'running');
  await assert.rejects(api.call('set_drive_inputs', { brake: 1 }), /No run is on/);
  assert.equal((await api.call('stop_run')).stopped, false);
});

test('set_drive_inputs with only the fans leaves the autopilot driving: the wall ride without its fans falls off the wall', async (t) => {
  const s = await sheet(t);
  const { run, said } = runMode(t, s);
  await run.start({ autopilot: 'wallride' });
  frames(run, 60);
  const next = run.setInputs({ fans: false });
  assert.equal(run.autopilot, 'wallride', 'the autopilot still drives');
  assert.equal(next.fans, false); assert.equal(next.brake, 1, 'with its own pedals (spooling on the brakes)');
  frames(run, 1);
  assert.match(said.at(-1), /^Autopilot: wall ride, fans off/);
  let fell = null, maxPitch = 0;
  for (let i = 0; i < 9 * 60; i++) { const st = run.step(1 / 60); maxPitch = Math.max(maxPitch, st.pitchDeg); if (st.events.fell != null && fell == null) fell = st.t; }
  const st = run.status();
  assert.ok(fell != null && st.events.summit_s == null, `off the wall before the overhang (fell at ${fell}, top pitch ${maxPitch.toFixed(1)})`);
  assert.match(st.message, /^Fell off at 1\d\d deg/);
  assert.equal(st.fans_pct, 0);
  // the same call on a car the agent drives itself, and any other input, take over as before
  await run.restart();
  assert.equal(run.autopilot, 'wallride', 'R runs the same autopilot again');
  run.setInputs({ throttle: 0.3 });
  assert.equal(run.autopilot, null, 'a pedal takes the car back');
  assert.equal(run.state.inputs.fans, 0, 'and the fans stay as the autopilot had them');
});

test('the touch pad lets go of every held button when the window loses focus, and takes the next press', async (t) => {
  const s = await sheet(t);
  const { run } = runMode(t, s);
  await run.start();
  const btn = (a) => s.doc.querySelector(`#drive-pad [data-drive="${a}"]`);
  pointer(s, btn('go'), 'pointerdown', 7); pointer(s, btn('right'), 'pointerdown', 8); frames(run, 1);
  assert.deepEqual([run.state.inputs.throttle, run.state.inputs.steer], [1, 1]);
  s.win.dispatchEvent(new s.win.Event('blur')); frames(run, 1);
  assert.deepEqual([run.state.inputs.throttle, run.state.inputs.steer], [0, 0], 'GO and steer let go');
  assert.equal(btn('go').getAttribute('aria-pressed'), 'false'); assert.equal(btn('go').classList.contains('held'), false);
  // the lifted fingers' ups never came; a new touch on GO still drives
  pointer(s, btn('go'), 'pointerdown', 9); frames(run, 1);
  assert.equal(run.state.inputs.throttle, 1, 'a new press after the blur holds GO again');
  pointer(s, btn('go'), 'pointerup', 9); frames(run, 1);
  assert.equal(run.state.inputs.throttle, 0);
});

test('the side camera tracks a car away from the ramp; the chase camera backs off a car falling toward it', async () => {
  const { createChaseCamera } = await import('./chase-cam.js');
  const { createWorld } = await import('./rd/drive/world.js');
  const world = createWorld();
  const cam = createChaseCamera({ world });
  const at = (x, y, extra = {}) => ({ t: 0, pos: [x, y, 0], quat: [0, 0, 0, 1], rampS: null, onRamp: false, pitchDeg: 0, ...extra });
  cam.setMode('side');
  // a hop 30 m out, 7 m up: tracked, not left behind for the ramp's elevation
  let p = cam.update(at(-30, 7), 1 / 60, 1.6);
  assert.ok(Math.abs(p.target.x + 30) < 0.5, `the side camera looks at the hop (${p.target.x.toFixed(1)})`);
  // at the start line by the ramp: the whole curl as an elevation
  cam.setMode('orbit'); cam.setMode('side');
  p = cam.update(at(-8, 0), 1 / 60, 1.6);
  assert.ok(p.target.x > -8 && p.target.y > 5, 'by the ramp it frames the curl');
  // off the wall: the hold backs away from a car that comes at the camera
  const chase = createChaseCamera({ world });
  const sb = world.ramp.sAtPitch(100), [x, y] = world.ramp.at(sb);
  let q = chase.update(at(x, y, { t: 5, rampS: sb, onRamp: true, pitchDeg: 100 }), 1 / 60, 1.6);
  const camAt = q.pos.clone();
  for (let i = 1; i <= 60; i++) q = chase.update(at(camAt.x + 0.5, camAt.y + 0.5, { t: 5 + i / 60 }), 1 / 60, 1.6);
  assert.ok(q.pos.distanceTo(q.target) > 6, `the camera keeps its distance (${q.pos.distanceTo(q.target).toFixed(2)} m)`);
});
