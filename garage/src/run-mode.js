// Run mode: what the tray's PLAY starts for a car that has one (the Roadster). The car is put at
// the start line at the foot of the wall-ride ramp, 8 m before the curl, and driven by the
// lab's physics (rd/drive: a rigid body on four ray-cast tyres, the downforce fans, the cold-gas
// thrusters and their tank). Whether it makes the wall ride, falls off it or lands a hop is
// that simulation's call, not a script's.
//
//   const run = createRunMode({ bp, rig, ui, canvas, vehicle: () => car, canRun, enter, leave, ... });
//   await run.start({ autopilot: null | 'wallride' | 'hop' });   // PLAY, or start_run
//   run.step(dt);                                                 // every frame while run.active()
//   run.stop();                                                   // STOP, Esc, stop_run, a vehicle switch
//
// start() loads the drive modules the first time (they sit under rd/ with the Roadster), asks
// main.js to put the sheet into drive mode (enter: motions off, doors shut, panels on, callouts
// and dims hidden), draws the ramp, its frame and a start line (bp.addProp), turns the lamp pools
// off, places the car, takes the camera (a chase camera, chase-cam.js) and shows the drive
// controls. stop() takes all of it away again and puts the car back at the sheet's origin.
//
// The physics runs in fixed steps of 1/240 s, as many as the frame's time covers (at most 12, so
// a slow frame runs slow rather than piling up), with the inputs set before every step: from the
// keys and the touch pad (drive-controls.js), from an agent (set_drive_inputs), or from an
// autopilot script (rd/drive/scripts.js, the same functions the lab's tests run). The gas puffs
// step every 1/60 s of drive time. So a drive does not depend on the frame rate, and an autopilot
// run in the page is the same run the lab's tests check.
import { buildRampProps } from './ramp-props.js';
import { createChaseCamera } from './chase-cam.js';
import { keyAction, KEYS, HELD, DRIVING, WINGS, LEGEND, composeInputs, createDrivePad } from './drive-controls.js';

export const AUTOPILOTS = Object.freeze(['wallride', 'hop']);
export const GAS_MAX = 1500;
const STEPS_PER_TICK = 4;   // the gas steps once every four physics steps: 1/60 s

// The TELEMETRY panel's rows while a run is on (ui.setInstrRows).
export const RUN_INSTR = Object.freeze([
  { k: 'SPEED', id: 'speed' }, { k: 'PITCH', id: 'pitch' }, { k: 'ALTITUDE', id: 'alt' }, { k: 'DOWNFORCE', id: 'down' },
  { k: 'G-FORCE', id: 'g' }, { k: 'TANK', id: 'tank' }, { k: 'GAS', id: 'gas' }, { k: 'FANS', id: 'fans' }, { k: 'RUN', id: 'outcome' },
]);

// The drive's modules, loaded on the first PLAY. Relative to this file, so the page and the tests
// load the same copies.
export async function loadDrive() {
  const [run, gas, scripts, constants] = await Promise.all([
    import('./rd/drive/run.js'), import('./rd/drive/gas.js'), import('./rd/drive/scripts.js'), import('./rd/drive/constants.js'),
  ]);
  return { createRun: run.createRun, DEFAULT_START: run.DEFAULT_START, createGas: gas.createGas, SCRIPTS: scripts.SCRIPTS, SIM: constants.SIM };
}
// The cel-shaded gas (ink-gas.js, the renderer's side). Without it a run still drives; it just
// draws no gas.
export async function loadInkGas() {
  try { return (await import('./ink-gas.js')).createInkGas ?? null; } catch { return null; }
}

const group3 = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const signed = (v, d = 1) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(d)}`;

/**
 * What a run has come to, in plain words, or null while it is still open: 'Crashed',
 * 'Fell off at 108 deg', 'Fell off at 108 deg, then crashed', 'Held the overhang',
 * 'Held the overhang, then crashed', 'Out of gas'. fellAt is the pitch (deg) of the car's last
 * moment on the deck.
 */
export function outcomeMessage(s, fellAt = null) {
  if (!s) return null;
  const fell = () => `Fell off at ${Math.round(fellAt ?? s.pitchDeg)} deg`;
  // a crash outranks the rest (rd/drive/run.js), so say what came before it too
  if (s.outcome === 'crashed') return s.events?.fell != null ? `${fell()}, then crashed` : s.events?.summit != null ? 'Held the overhang, then crashed' : 'Crashed';
  if (s.outcome === 'fell') return fell();
  if (s.outcome === 'summit') return 'Held the overhang';
  if (s.gas?.empty) return 'Out of gas';
  return null;
}

/** The TELEMETRY values for a drive state (the RUN_INSTR ids). */
export function runTelemetry(s, { message = null, autopilot = null } = {}) {
  const outcome = message ? message.toUpperCase() : autopilot ? `AUTOPILOT · ${autopilot === 'hop' ? 'HOP' : 'WALL RIDE'}` : s.outcome === 'stopped' ? 'STOPPED' : 'RUNNING';
  return {
    speed: `${s.speedKmh.toFixed(1)} km/h`, pitch: `${signed(s.pitchDeg)}°`, alt: `${s.altitudeFt.toFixed(1)} ft`,
    down: `${group3(s.downforceKg)} kg`, g: `${s.gForce.toFixed(2)} g`, tank: `${group3(s.gas.psi)} psi`,
    gas: `${s.gas.kg.toFixed(1)} kg`, fans: `${Math.round(s.fans.level * 100)} %`, outcome,
  };
}

export function createRunMode({
  onChange = () => {}, say = () => {},
  bp = null, rig = null, ui = null, canvas = null,
  doc = globalThis.document ?? null, win = globalThis.window ?? null,
  vehicle = () => null,          // the car on the sheet now
  canRun = () => true,           // whether that car has a run mode
  enter = () => {}, leave = () => {},   // main.js: the sheet into and out of drive mode
  drive = loadDrive,               // () => the drive's modules (loadDrive)
  inkGas: inkGasLoader = loadInkGas, // () => createInkGas, or null for a run without drawn gas
} = {}) {
  let phase = 'off', token = 0;
  let mods = null, physics = null, gas = null, createInkGas;
  // one run
  let car = null, props = null, ink = null, cam = null, pad = null, hud = null, keysEl = null, ac = null, instrInert = null;
  let startPose = null, script = null, mem = null, autopilot = null, acc = 0, sub = 0, uiT = 0;
  let lastDeckPitch = null, fellAt = null, status = '', last = null;
  const held = new Map();                       // source (a key code, a pad button) → action
  const agent = { throttle: 0, brake: 0, steer: 0, boost: false, hop: false, yawL: false, yawR: false };
  const latch = { fans: false, wing: 'road' };
  // An agent's fans or wing for the autopilot's own drive (set_drive_inputs with only those):
  // the autopilot keeps driving, with the car set up that way. null: the autopilot's own.
  let setup = null;

  const compact = () => !!ui?.compactMedia?.matches;
  // The touch pad shows on compact sheets and on wide touch screens (styles.css), so the
  // instructions name its buttons there, and the keys everywhere else.
  const touchy = () => compact() || !!win?.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches;
  const actionsHeld = () => new Set(held.values());
  const inputsNow = () => (script
    ? { ...script.inputs(physics.state, mem, physics), ...setup }
    : composeInputs({ held: actionsHeld(), agent, latch, forwardSpeed: physics.state.forwardSpeed }));

  async function ensureDrive() {
    if (!mods) mods = await drive();
    if (!physics) {
      physics = mods.createRun();
      gas = mods.createGas({ world: physics.world, max: GAS_MAX, seed: 7 });
    }
    if (createInkGas === undefined) createInkGas = (await inkGasLoader?.()) ?? null;
  }

  // ---- the drive ----
  function reset() {
    physics.reset(startPose);
    gas.reset(); ink?.clear?.();
    acc = 0; sub = 0; uiT = 1; lastDeckPitch = null; fellAt = null;
    flashText = null; flashUntil = 0;   // a flash belongs to the run (and the clock) that made it
    mem = {};
    cam?.reset();
  }
  function advance(dt) {
    acc += Math.min(Math.max(0, +dt || 0), mods.SIM.maxFrame);
    let n = 0;
    while (acc >= physics.dt && n < mods.SIM.maxSteps) {
      physics.setInputs(inputsNow());
      const s = physics.step();
      acc -= physics.dt; n++;
      if (s.rampS != null) lastDeckPitch = s.pitchDeg;
      if (s.outcome === 'fell' && fellAt == null) fellAt = lastDeckPitch ?? s.pitchDeg;
      if (++sub >= STEPS_PER_TICK) { sub = 0; gas.step(STEPS_PER_TICK * physics.dt, s.jets, s.vel); }
    }
    if (acc >= physics.dt) acc %= physics.dt;   // a backlog past maxSteps is dropped
    return n;
  }
  // The car on the sheet takes the drive's pose: root from the body, wheels from their tyres.
  function pose(dt) {
    const s = physics.state;
    car.root.position.set(...s.pos); car.root.quaternion.set(...s.quat);
    car.explodeT = 0; car.openT = 0; car.panelsT = 1;
    car.aeroMode = s.inputs.wing; car.fanLevel = s.fans.level;
    car.update(dt, { speed: s.forwardSpeed * 3.6, steer: s.steerDeg, run: false, drive: false, time: 0 });
    // each wheel as its tyre is: lifted by its suspension, its own spin (wheelspin and locking
    // show) and the steering's own angle per side
    car.wheels?.forEach((w, i) => {
      const ws = s.wheels[i]; if (!ws) return;
      w.part.group.position.y = w.part.rest.y + ws.compression;
      if (w.steer) w.steer.rotation.y = w.front ? ws.steer : 0;
      if (w.spin) w.spin.rotation.z = ws.spin;
    });
    car.root.updateMatrixWorld(true);
  }
  function park(c) {
    if (!c) return;
    c.root.position.set(0, 0, 0); c.root.quaternion.identity();
    c.fanLevel = 0; c.aeroMode = 'road';
    c.wheels?.forEach((w) => { w.part.group.position.copy(w.part.rest); if (w.steer) w.steer.rotation.y = 0; if (w.spin) w.spin.rotation.z = 0; });
    c.update?.(0, { speed: 0, steer: 0, run: false, drive: false, time: 0 });
    c.root.updateMatrixWorld(true);
  }

  // ---- inputs ----
  function takeOver() {
    if (!script) return;
    const now = physics.state.inputs;
    latch.fans = !!now.fans; latch.wing = WINGS.includes(now.wing) ? now.wing : 'road';
    script = null; autopilot = null; mem = {}; setup = null;
    pad?.setPressed('fans', latch.fans);
    uiT = 1;
  }
  function press(source, action, down) {
    if (phase !== 'on') return;
    if (HELD.includes(action)) {
      if (down) { takeOver(); held.set(source, action); } else held.delete(source);
      return;
    }
    if (!down) return;
    if (DRIVING.includes(action)) takeOver();
    if (action === 'fans') { latch.fans = !latch.fans; pad?.setPressed('fans', latch.fans); }
    else if (action.startsWith('wing:')) latch.wing = action.slice(5);
    else if (action === 'retry') restart();
    else if (action === 'camera') { cam.next(); flash(`Camera: ${cam.mode}`); }
    else if (action === 'stop') stop();
    uiT = 1;
  }
  let flashText = null, flashUntil = 0;
  function flash(text) { flashText = text; flashUntil = (physics?.state.t ?? 0) + 1.5; uiT = 1; }

  // Space on a focused control (a header link, STOP, a pad button reached by Tab) stays that
  // control's; on the drawing or the page it is the hop.
  let shiftTimer = 0;
  const cancelShift = () => { if (shiftTimer) { win?.clearTimeout(shiftTimer); shiftTimer = 0; } };
  const drivesFrom = (t) => !t || t === doc?.body || t === doc?.documentElement || t === canvas || (!!t.closest?.('#stage') && !t.closest('button, a'));
  function listen() {
    ac = new (win?.AbortController ?? AbortController)();   // the page's own (a test's window has its own)
    const opts = { signal: ac.signal, capture: true };
    win?.addEventListener('keydown', (e) => {
      if (phase !== 'on' || e.defaultPrevented) return;
      if (e.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), #agent-tools')) return;
      // Cmd swallows the keyups of keys let go while it is down (macOS): let go of them now.
      if (e.key === 'Meta') { for (const [src, act] of [...held]) if (src.startsWith('key:')) press(src, act, false); return; }
      // Shift+Tab moves focus: a Shift that turns out to be the start of it never boosts.
      if (e.code === 'Tab') { cancelShift(); for (const [src, act] of [...held]) if (act === 'boost' && src.startsWith('key:Shift')) press(src, act, false); return; }
      const action = keyAction(e); if (!action) return;
      if ((action === 'hop' || action === 'boost') && !drivesFrom(e.target)) return;
      // the run's keys are the run's: the sheet's own shortcuts and its Escape never see them
      e.preventDefault(); e.stopPropagation();
      // Shift boosts after a beat, so a Shift+Tab from the drawing neither fires the nozzles nor
      // takes the car back from the autopilot.
      if (action === 'boost' && e.code.startsWith('Shift') && !held.has(`key:${e.code}`)) {
        if (!e.repeat && !shiftTimer) { const code = e.code; shiftTimer = win.setTimeout(() => { shiftTimer = 0; if (phase === 'on') press(`key:${code}`, 'boost', true); }, 120); }
        return;
      }
      if (HELD.includes(action)) { press(`key:${e.code}`, action, true); return; }
      if (e.repeat) return;
      press(`key:${e.code}`, action, true);
    }, opts);
    win?.addEventListener('keyup', (e) => {
      if (e.code.startsWith('Shift')) cancelShift();
      const source = `key:${e.code}`;
      if (!held.has(source)) return;
      e.preventDefault(); e.stopPropagation();
      press(source, held.get(source), false);
    }, opts);
    // a held key or pad button whose up never arrives (the window lost focus) must not stay held
    const releaseAll = () => { cancelShift(); pad?.releaseAll(); held.clear(); };
    win?.addEventListener('blur', releaseAll, { signal: ac.signal });
    doc?.addEventListener('visibilitychange', () => { if (doc.hidden) releaseAll(); }, { signal: ac.signal });
    if (canvas) {
      // dragging turns the camera round the car; the wheel or a pinch pulls it in or out
      let drag = null;
      const pinch = new Map(); let span = 0;
      canvas.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch.size >= 2) { if (drag) cam?.release(); drag = null; const [a, b] = [...pinch.values()]; span = Math.hypot(a.x - b.x, a.y - b.y); return; }
        // the first finger on the drawing turns the camera, even while a thumb holds a pad button
        if (e.button !== 0 || drag) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
        try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      }, { signal: ac.signal });
      canvas.addEventListener('pointermove', (e) => {
        if (pinch.has(e.pointerId)) pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch.size === 2) {
          const [a, b] = [...pinch.values()], now = Math.hypot(a.x - b.x, a.y - b.y);
          if (span > 0 && now > 0) cam?.zoom(span / now);
          span = now; return;
        }
        if (!drag || e.pointerId !== drag.id) return;
        cam?.drag(e.clientX - drag.x, e.clientY - drag.y); drag.x = e.clientX; drag.y = e.clientY;
      }, { signal: ac.signal });
      const end = (e) => { pinch.delete(e.pointerId); if (pinch.size < 2) span = 0; if (drag && e.pointerId === drag.id) { drag = null; cam?.release(); } };
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, end, { signal: ac.signal });
      canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam?.zoom(Math.exp(e.deltaY * 0.0012)); }, { signal: ac.signal, passive: false });
    }
  }

  // ---- the drive's furniture on the sheet ----
  function showControls() {
    const tray = doc?.getElementById('primary-controls');
    if (tray) pad = createDrivePad({ container: tray, before: doc.getElementById('play-btn')?.nextSibling ?? null, onPress: (action, down) => press(`pad:${action}`, action, down), signal: ac.signal });
    pad?.setPressed('fans', latch.fans);
    const sheet = doc?.getElementById('sheet');
    if (sheet) {
      hud = doc.createElement('div');
      // compact sheets show this strip instead of the TELEMETRY panel, so it is the one a reader gets there
      hud.id = 'run-hud'; hud.setAttribute('role', 'group'); hud.setAttribute('aria-label', 'Run telemetry');
      hud.innerHTML = RUN_INSTR.filter((r) => r.id !== 'outcome').map((r) => `<div><span class="k">${r.k}</span><span class="v" data-run="${r.id}">—</span></div>`).join('');
      sheet.append(hud);
    }
    const instr = doc?.getElementById('instr');
    if (instr) {
      // the cards may have left the panel inert; in a run it carries the figures, so a reader gets them
      instrInert = instr.inert; instr.inert = false;
      keysEl = doc.createElement('div');
      keysEl.id = 'run-keys'; keysEl.className = 'run-keys';
      keysEl.innerHTML = LEGEND.map(([k, v]) => `<span class="rk">${k}</span><span class="rv">${v}</span>`).join('');
      instr.append(keysEl);
    }
    ui?.setInstrRows?.(RUN_INSTR);
  }
  function hideControls() {
    pad?.dispose(); pad = null;
    hud?.remove(); hud = null;
    keysEl?.remove(); keysEl = null;
    const instr = doc?.getElementById('instr');
    if (instr && instrInert !== null) instr.inert = instrInert;
    instrInert = null;
    ui?.setInstrRows?.();
  }

  // ---- status and telemetry, ten times a second ----
  function statusText(s) {
    const msg = outcomeMessage(s, fellAt);
    if (msg) return `${msg} · ${touchy() ? 'RETRY to go again' : 'R to retry'}`;
    if (flashText && s.t < flashUntil) return flashText;
    if (script) {
      const how = setup ? [setup.fans === false && 'fans off', setup.fans === true && 'fans on', setup.wing && `${{ road: 'road', lowDrag: 'low-drag', highDownforce: 'high-downforce' }[setup.wing]} wing`].filter(Boolean).join(', ') : '';
      return `Autopilot: ${autopilot === 'hop' ? 'hop' : 'wall ride'}${how ? `, ${how}` : ''} · ${touchy() ? 'touch to take over' : 'any key takes over'}`;
    }
    if (s.outcome === 'stopped') return 'Stopped';
    if (s.airborne) return 'In the air';
    if (s.onRamp) return s.pitchDeg > 135 ? 'Upside down on the overhang' : 'On the wall';
    return touchy() ? 'GO drives at the wall · FANS hold you on' : 'W to drive at the wall · F for the fans';
  }
  function report(s) {
    const msg = outcomeMessage(s, fellAt);
    const text = statusText(s);
    if (text !== status) { status = text; say(text); }
    const vals = runTelemetry(s, { message: msg, autopilot: script ? autopilot : null });
    ui?.setInstr?.(vals);
    if (hud) for (const el of hud.querySelectorAll('[data-run]')) { const v = vals[el.dataset.run]; if (el.textContent !== v) el.textContent = v; }
  }

  // ---- lifecycle ----
  async function start({ autopilot: ap = null } = {}) {
    if (phase !== 'off') return false;
    if (ap != null && !AUTOPILOTS.includes(ap)) throw new Error(`autopilot must be one of: ${AUTOPILOTS.join(', ')}`);
    if (!canRun() || !vehicle()) return false;
    const my = ++token;
    phase = 'starting'; onChange(true); say('Loading the drive…');
    try { await ensureDrive(); } catch (err) { if (my === token) { phase = 'off'; onChange(false); say(''); } throw err; }
    if (my !== token || phase !== 'starting') return false;   // stopped, or the car changed, while loading
    if (!canRun() || !vehicle()) { phase = 'off'; onChange(false); say(''); return false; }
    car = vehicle();
    enter();
    autopilot = ap;
    script = ap ? mods.SCRIPTS[ap]() : null;
    // At the foot of the ramp, as the owner put it: where the wall-ride script parks, 8 m before
    // the curl. Flat out from there the car meets the curl at about 16 m/s; from the lab's 50 m
    // run-in it meets it at twice that, and the curl's 11 g bottoms it out on the deck.
    startPose = script ? script.start : mods.SCRIPTS.wallride().start;
    latch.fans = false; latch.wing = 'road'; setup = null;
    Object.assign(agent, { throttle: 0, brake: 0, steer: 0, boost: false, hop: false, yawL: false, yawR: false });
    held.clear();
    cam = createChaseCamera({ world: physics.world });
    reset();
    // the ramp, its frame and the start line, drawn like the car (the renderer's prop ids)
    props = buildRampProps(physics.world, { startX: startPose.pos[0], frontX: car.SPEC?.NOSE ?? 2.2 });
    if (bp?.addProp) for (const { object, id } of props.props) bp.addProp(object, { id });
    bp?.setPools?.(false);
    ink = createInkGas && bp ? createInkGas(bp, { max: GAS_MAX }) : null;
    pose(0);
    rig?.setFree(cam.update(physics.state, 0, rig.aspect));
    bp?.setFocus?.(...physics.state.pos);
    listen();
    showControls();
    phase = 'on';
    status = ''; report(physics.state);
    canvas?.focus?.({ preventScroll: true });
    return true;
  }
  function teardown() {
    ac?.abort(); ac = null;
    hideControls();
    if (props) { if (bp?.removeProp) for (const { object } of props.props) bp.removeProp(object); props.dispose(); props = null; }
    ink?.dispose?.(); ink = null;
    bp?.setPools?.(true);
    bp?.setFocus?.(null);
    rig?.setFree(null);
    park(car);
    held.clear(); script = null; autopilot = null; cam = null;
    leave();
    car = null;
  }
  function stop() {
    if (phase === 'off') return false;
    token++;
    if (phase === 'on') last = snapshot();
    const was = phase; phase = 'off';
    if (was === 'on') teardown();
    status = ''; onChange(false); say('');
    return true;
  }
  // R, RETRY: the same run from its start, the autopilot too if it still has the car.
  function restart() {
    if (phase !== 'on') return false;
    if (autopilot && !script) autopilot = null;
    if (autopilot) script = mods.SCRIPTS[autopilot]();
    // from the start line at rest: an agent's held pedals or jets do not carry over into the new go
    Object.assign(agent, { throttle: 0, brake: 0, steer: 0, boost: false, hop: false, yawL: false, yawR: false });
    reset();
    pose(0);
    flash(script ? 'Again: autopilot' : 'Again from the start line');
    return true;
  }

  function step(dt) {
    if (phase !== 'on') return null;
    if (vehicle() !== car || !canRun()) { stop(); return null; }   // the sheet changed cars under the run
    advance(dt);
    pose(dt);
    const s = physics.state;
    rig?.setFree(cam.update(s, dt, rig.aspect));
    bp?.setFocus?.(s.pos[0], s.pos[1], s.pos[2]);
    ink?.update(gas.view(), s.jets, dt);
    uiT += dt;
    if (uiT >= 0.1) { uiT = 0; report(s); }
    return s;
  }

  // An agent's held inputs (set_drive_inputs): fans and wing latch, the rest hold until changed.
  // While an autopilot drives, a call that sets only the fans or the wing leaves it driving with
  // the car set up that way (the wall ride with fans: false is the same ride without its fans);
  // any other input takes the car back from it.
  function setInputs(inp = {}) {
    if (phase !== 'on') throw new Error('No run is on. Call start_run first.');
    const given = Object.keys(inp).filter((k) => inp[k] !== undefined);
    if (script && given.length && given.every((k) => k === 'fans' || k === 'wing')) {
      setup = { ...setup };
      if (inp.fans !== undefined) { setup.fans = !!inp.fans; latch.fans = setup.fans; pad?.setPressed('fans', latch.fans); }
      if (inp.wing !== undefined) { setup.wing = WINGS.includes(inp.wing) ? inp.wing : 'road'; latch.wing = setup.wing; }
      uiT = 1;
      return inputsNow();
    }
    takeOver();
    for (const k of Object.keys(agent)) if (inp[k] !== undefined) agent[k] = inp[k];
    if (inp.fans !== undefined) { latch.fans = !!inp.fans; pad?.setPressed('fans', latch.fans); }
    if (inp.wing !== undefined) latch.wing = inp.wing;
    uiT = 1;
    return inputsNow();
  }

  function snapshot() {
    if (!physics || phase !== 'on') return null;
    const s = physics.state, i = s.inputs, r = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
    return {
      outcome: s.outcome, message: outcomeMessage(s, fellAt), autopilot: script ? autopilot : null,
      t_s: r(s.t, 3), position_m: { x: r(s.pos[0], 3), y: r(s.pos[1], 3), z: r(s.pos[2], 3) }, heading_deg: r(s.headingDeg, 1),
      speed_kmh: r(s.speedKmh, 1), pitch_deg: r(s.pitchDeg, 1), roll_deg: r(s.rollDeg, 1), altitude_ft: r(s.altitudeFt, 1),
      downforce_kg: Math.round(s.downforceKg), g: r(s.gForce, 2), tank_psi: Math.round(s.gas.psi), gas_kg: r(s.gas.kg, 1),
      gas_empty: !!s.gas.empty, fans_pct: Math.round(s.fans.level * 100), wing: s.inputs.wing,
      on_ramp: !!s.onRamp, airborne: !!s.airborne, wheels_in_contact: s.wheels.filter((w) => w.contact).length,
      inputs: { throttle: r(i.throttle, 3), brake: r(i.brake, 3), steer: r(i.steer, 3), fans: !!i.fans, boost: !!i.boost, hop: !!i.hop, yawL: !!i.yawL, yawR: !!i.yawR, wing: i.wing },
      camera: cam?.mode ?? null,
      events: { summit_s: s.events.summit, fell_s: s.events.fell, crashed_s: s.events.crashed, max_altitude_ft: r(s.events.maxAltitudeFt, 1) },
    };
  }

  return {
    start, stop, restart, step, setInputs,
    active: () => phase !== 'off',
    running: () => phase === 'on',
    // what the drawing needs from the run this frame: the brake lights
    lamps: () => (phase === 'on' ? { brake: (physics.state.inputs.brake ?? 0) > 0.1 } : { brake: false }),
    // get_run_state: the live run, or how the last one ended
    status: () => (phase === 'on' ? { active: true, ...snapshot() } : { active: false, starting: phase === 'starting', last }),
    camera: (name) => (cam ? (name ? cam.setMode(name) : cam.mode) : null),
    get state() { return phase === 'on' ? physics.state : null; },
    get autopilot() { return phase === 'on' && script ? autopilot : null; },
    get held() { return actionsHeld(); },
    get props() { return props; },
    KEYS,
  };
}
