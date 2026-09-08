import * as THREE from 'three';
import { CONFIG, toggleMotionState } from './config.js';
import { buildVehicle, CUT } from './vehicle.js';
import { Blueprint } from './blueprint.js';
import { Rig, presentationFit } from './camera.js';
import { Overlay } from './overlay.js';
import { UI } from './ui.js';
import { installWebMCP } from './webmcp.js';
import { createTour } from './tour.js';
import { easeInOut, clamp } from './geom.js';
import { createTapTracker, discoveryAction, discoveryFraming, discoveryHasTransitions, resetDiscoveryState, demoVisibility, visibleInScene, inVehicleAperture } from './discovery.js';

const q = new URLSearchParams(location.search);
const demo = q.get('demo') === '1';
// Framed (the configurator's Garage, the landing page's tour): the host owns navigation and the
// agent surface, so the header links and chip stay hidden and the GPU is shared.
const framed = (() => { try { return !!window.top && window.top !== window; } catch { return true; } })();
if (framed) document.body.classList.add('framed', 'nav-off');
if (demo) document.body.classList.add('demo', 'nav-off');
let demoInViewport = true, demoDirtyUntil = 0, animationHandle = null, animationReady = false;
let last = performance.now();
function postDemo(type) { if (demo && framed) window.parent.postMessage({ type }, location.origin); }
function scheduleFrame() {
  if (!animationReady || animationHandle !== null || document.hidden || (demo && !demoInViewport)) return;
  animationHandle = requestAnimationFrame(frame);
}
function invalidateDemo() {
  if (!demo) return;
  demoDirtyUntil = performance.now() + 1500;
  scheduleFrame();
}
let tour;
const tourState = () => tour?.state() ?? { running: false, step: 0, of: CONFIG.tour.length, id: null, title: null };
const stopTour = (reason) => tour?.stop(reason) ?? tourState();

const canvas = document.getElementById('gl');
const svg = document.getElementById('overlay');
const stage = document.getElementById('stage');

let bp;
try { bp = new Blueprint(canvas); } catch (e) { postDemo('autolab-demo-error'); document.getElementById('fallback').hidden = false; throw e; }
const vehicle = buildVehicle();
bp.addVehicle(vehicle);
const rig = new Rig();
const overlay = new Overlay(svg, rig, vehicle);

const st = {
  view: 'iso', run: true, drive: false, lights: false, panels: true, explode: 0, open: 0, explodeOn: false, openOn: false,
  speed: 0, steer: 0, soc: 87.0, time: 0, ortho: 0, hoverId: -1, hoverPart: null, lampGlow: 0, gridOffset: 0, gridAlpha: 1, hidePanels: false,
  // What the configurator has told this sheet about the car it is showing; 'Not supplied' until it does.
  vehicleContext: { build: 'Hudian RX2', paint: 'Not supplied', wheels: 'Not supplied', interior: 'Not supplied', rangeMiles: null, vehicleTotal: null, revision: 1 },
};
const ui = new UI(CONFIG, {
  onView: (v) => { stopTour('view'); setView(v); },
  onTour: () => tourState().running ? stopTour('button') : startTour(),
  onMotion: (m) => { stopTour('motion'); motion(m); },
  onReset: () => { void api.call('reset'); },
  onKeyHover: (part) => { if (tourState().running) return; keyHover = part ? vehicle.parts[part] : null; },
  onKeySelect: (part) => { stopTour('part'); selectedPart = part ? vehicle.parts[part] : null; pointerHit = null; pointerDirty = false; keyHover = null; ui.selectPart(selectedPart); },
});
let keyHover = null, selectedPart = null;

function setView(v) {
  st.view = v; ui.setView(v); rig.goTo(v, tourState().running && q.get('snap') === '1' ? 0 : 1.15); overlay.setView(v);
  if (tourState().running && q.get('nodrift') === '1') rig.driftOn = false;
  const ortho = (v === 'side' || v === 'front' || v === 'top');
  ui.showPanels(!ortho); st.hidePanels = ortho;
  ui.showViewTitle(null);
  if (rig.settled) rig.onSettle?.(v);
}
rig.onSettle = (v) => { overlay.settled(v); ui.showViewTitle(v); };

function motion(m) {
  for (const [id, on] of Object.entries(toggleMotionState(st, m))) ui.setToggle(id, on);
  if (m === 'lights' && st.lights) { flashT = 0; const S = vehicle.SPEC; overlay.flash(vehicle.parts.headlamps, [[S.NOSE + 0.05, 0.875, -0.595], [S.NOSE + 0.05, 0.875, 0.595]]); }
  if (demo) { updateDiscoveryButtons(); invalidateDemo(); }
}
let flashT = 99;
const demoTaps = createTapTracker();

function updateDiscoveryButtons() {
  for (const button of document.querySelectorAll('[data-demo-action]')) {
    const action = button.dataset.demoAction;
    button.setAttribute('aria-pressed', String(action === 'open' ? st.openOn : st[action]));
  }
}

function finishDemo(reason = 'reset') {
  if (!demo) return;
  resetDiscoveryState(st);
  flashT = 99; overlay.flashes = [];
  keyHover = selectedPart = null;
  vehicle.explodeT = vehicle.openT = 0; vehicle.panelsT = 1;
  vehicle.update(0, st); vehicle.root.updateMatrixWorld(true);
  rig.fitScale = 1; rig.tyOffset = discoveryFraming(false).tyOffset;
  ui.setCards(false, true); ui.selectPart(null); ui.setView('iso');
  for (const id of ['run', 'drive', 'lights', 'panels', 'explode', 'open']) ui.setToggle(id, false);
  clearTimeout(ui.tourTimer); ui.tourCard.hidden = true;
  document.body.classList.remove('tour-active'); document.body.classList.add('demo-exploring');
  document.getElementById('demo-discovery').hidden = false;
  document.getElementById('demo-options').hidden = true;
  document.getElementById('demo-options-toggle').setAttribute('aria-expanded', 'false');
  document.documentElement.style.setProperty('--demo-space', `${document.getElementById('demo-discovery').offsetHeight + 4}px`);
  document.getElementById('demo-status').textContent = reason === 'complete' ? 'Tour complete. Explore the car, or replay the tour.' : 'Car reset. Explore the doors, lights and wheels.';
  resize(); rig.goTo('iso', 0); rig.driftOn = false; rig.apply(W / H);
  updateDiscoveryButtons(); invalidateDemo();
}

function activateDiscovery(action) {
  if (!action) return;
  stopTour('discovery');
  motion(action);
  if (action === 'drive' && !st.drive) { if (st.run) motion('run'); st.speed = 0; st.steer = 0; }
  const on = action === 'open' ? st.openOn : st[action];
  document.getElementById('demo-status').textContent = action === 'open' ? `Doors ${on ? 'open' : 'closed'}.` : action === 'lights' ? `Lights ${on ? 'on' : 'off'}.` : `Wheels ${on ? 'spinning' : 'stopped'}.`;
  rig.driftOn = false;
}

// ---- pointer interaction ----
let dragging = false, lastX = 0, lastY = 0, moved = 0, pointerX = -1, pointerY = -1;
let pointerClient = null, pointerDirty = false, pointerHit = null, hadPinch = false, inspectionPress = null;
function rememberPointer(e) {
  pointerClient = { x: e.clientX, y: e.clientY }; pointerDirty = true;
  const rect = stage.getBoundingClientRect(); pointerX = e.clientX - rect.left; pointerY = e.clientY - rect.top;
}
canvas.addEventListener('pointerdown', (e) => {
  if (demo) demoTaps.down(e, tourState().running);
  stopTour('pointer'); invalidateDemo();
  if (e.button !== 0 || !e.isPrimary) return;
  rememberPointer(e); dragging = true; moved = 0; hadPinch = false;
  if (!demo) inspectionPress = e.pointerId;
  lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (demo) { demoTaps.move(e); invalidateDemo(); }
  rememberPointer(e);
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
  if (moved > (demo ? 8 : 3)) {
    if (!demo) { selectedPart = keyHover = pointerHit = null; ui.selectPart(null); ui.tooltip(); }
    if (rig.view) { rig.grab(); ui.setView(null); overlay.setView(null); ui.showViewTitle(null); ui.showPanels(true); st.hidePanels = false; st.view = null; }
    rig.orbit(dx, dy); }
});
const endDrag = (e) => { if (!e.isPrimary) return; dragging = false; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerup', e => {
  if (!demo) {
    const accepted = inspectionPress === e.pointerId;
    if (accepted) inspectionPress = null;
    if (accepted && e.isPrimary && e.button === 0 && moved <= 3 && !hadPinch) {
      rememberPointer(e);
      pointerHit = pickHit();
      selectedPart = pointerHit?.object.userData.part ?? null;
      pointerDirty = false; keyHover = null;
      ui.selectPart(selectedPart);
    }
    return;
  }
  if (demoTaps.up(e)) {
    const rect = stage.getBoundingClientRect(); pointerX = e.clientX - rect.left; pointerY = e.clientY - rect.top;
    const hit = pickHit();
    activateDiscovery(discoveryAction(hit?.object.userData.part?.name, hit?.object.userData.subId));
  }
  invalidateDemo();
});
canvas.addEventListener('pointercancel', e => { if (demo) demoTaps.cancel(e); invalidateDemo(); });
canvas.addEventListener('lostpointercapture', e => { if (demo) demoTaps.cancel(e); });
const cancelInspectionPress = e => {
  if (demo || inspectionPress !== e.pointerId) return;
  inspectionPress = null; pointerClient = pointerHit = null; pointerDirty = false; pointerX = pointerY = -1;
};
canvas.addEventListener('pointercancel', cancelInspectionPress);
canvas.addEventListener('lostpointercapture', cancelInspectionPress);
canvas.addEventListener('pointerleave', () => { pointerX = pointerY = -1; pointerClient = pointerHit = null; pointerDirty = false; invalidateDemo(); });
canvas.addEventListener('wheel', (e) => { stopTour('wheel'); e.preventDefault(); rig.zoom(Math.exp(e.deltaY * 0.0012), true); rig.idle = 0; invalidateDemo(); }, { passive: false });

// Pinch to zoom. Zoom was bound to the wheel alone, so on a touch device the only way in or out of
// the drawing was the view presets, and the hint named a gesture that does not exist there. Tracked
// over raw pointer ids because the orbit handler only follows the primary pointer; a second finger
// arriving switches this to a pinch and suspends the orbit rather than letting the two fight.
const pinch = new Map();
let pinchSpan = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  if (!e.isPrimary) canvas.setPointerCapture(e.pointerId);
  pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch.size === 2) {
    hadPinch = true;
    if (!demo) { selectedPart = keyHover = pointerHit = null; ui.selectPart(null); ui.tooltip(); }
    const [a, b] = [...pinch.values()];
    pinchSpan = Math.hypot(a.x - b.x, a.y - b.y);
    dragging = false; canvas.classList.remove('dragging');
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'touch' || !pinch.has(e.pointerId)) return;
  pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch.size !== 2) return;
  const [a, b] = [...pinch.values()];
  const span = Math.hypot(a.x - b.x, a.y - b.y);
  if (pinchSpan > 0 && span > 0) {
    stopTour('pinch');
    if (rig.view) { rig.grab(); ui.setView(null); overlay.setView(null); ui.showViewTitle(null); ui.showPanels(true); st.hidePanels = false; st.view = null; }
    rig.zoom(pinchSpan / span, true); rig.idle = 0;
  }
  pinchSpan = span;
});
const endPinch = (e) => {
  if (e.pointerType !== 'touch') return;
  pinch.delete(e.pointerId); if (pinch.size < 2) pinchSpan = 0;
  if (pinch.size === 0 && hadPinch) {
    hadPinch = false; pointerClient = pointerHit = null; pointerDirty = false; pointerX = pointerY = -1;
  }
};
canvas.addEventListener('pointerup', endPinch); canvas.addEventListener('pointercancel', endPinch);
// Name the gesture the device actually has.
{ const hint = document.getElementById('hint'); if (hint && window.matchMedia('(hover: none) and (pointer: coarse)').matches) hint.textContent = 'DRAG TO ORBIT · PINCH TO ZOOM'; }
// arrows orbit and [ ] dolly, so the camera is reachable without a pointer (and from a screen reader
// or an agent driving the page by keystroke rather than through window.r2)
function camKey(k, shift) {
  const step = shift ? 15 : 4;
  if (rig.view) { rig.grab(); ui.setView(null); overlay.setView(null); ui.showViewTitle(null); ui.showPanels(true); st.hidePanels = false; st.view = null; }
  if (k === 'ArrowLeft') rig.cur.az -= step; else if (k === 'ArrowRight') rig.cur.az += step;
  else if (k === 'ArrowUp') rig.cur.el = Math.min(86, rig.cur.el + step); else if (k === 'ArrowDown') rig.cur.el = Math.max(2, rig.cur.el - step);
  else if (k === '[') rig.zoom(shift ? 1.25 : 1.08, true); else if (k === ']') rig.zoom(shift ? 0.8 : 0.93, true);
}
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  if (e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  if (demo) {
    // The Home exhibit has a deliberately small interaction vocabulary. Native button
    // activation remains native; keyboard canvas controls match the direct part taps.
    if (e.target !== canvas && e.target !== document.body && e.target !== document.documentElement) return;
    const key = e.key.toLowerCase();
    const cameraKey = /^(Arrow(Left|Right|Up|Down)|\[|\])$/.test(e.key);
    if (!cameraKey && !['o', 'l', 'd', 'r', 't', 'escape'].includes(key)) return;
    e.preventDefault();
    stopTour('key');
    if (key === 't') void startTour();
    else if (key === 'r' || key === 'escape') finishDemo();
    else if (cameraKey) camKey(e.key, e.shiftKey);
    else activateDiscovery({ o: 'open', l: 'lights', d: 'drive' }[key]);
    invalidateDemo();
    return;
  }
  // Space belongs to the focused control; only the sheet/canvas shortcut drives.
  if (e.key === ' ' && e.target !== document.body && e.target !== document.documentElement && e.target !== canvas) return;
  const wasRunning = tourState().running;
  stopTour('key');
  // Enter on the focused launcher must stop, not immediately synthesize a restart click.
  if (wasRunning && e.key === 'Enter' && e.target.closest('#tour-btn, #compact-tour-btn')) e.preventDefault();
  // A modal's arrows, space and Escape belong to its focused control.
  if (e.target.closest('#compact-sheet')) return;
  if (e.key.toLowerCase() === 't') { e.preventDefault(); if (!wasRunning) void startTour(); return; }
  const map = { 1: 'iso', 2: 'q34f', 3: 'q34r', 4: 'side', 5: 'front', 6: 'top' };
  if (map[e.key]) setView(map[e.key]);
  if (/^(Arrow(Left|Right|Up|Down)|\[|\])$/.test(e.key)) { e.preventDefault(); camKey(e.key, e.shiftKey); }
  if (e.key === ' ') { e.preventDefault(); motion('drive'); }
  if (e.key === 'e') motion('explode');
  if (e.key === 'l' || e.key === 'f') motion('lights');
  if (e.key === 'h') ui.setCards(document.body.classList.contains('cards-off'));
  if (e.key === 'p') motion('panels');
  if (e.key === 'o') motion('open');
  if (e.key === 'd') motion('drive');
  if (e.key === 'r') motion('run');
});

// Sheet clicks also stop the caption when they land on a card instead of the canvas.
window.addEventListener('click', (e) => { if (!e.target.closest('#tour-btn, #compact-tour-btn, #demo-replay')) stopTour('click'); });

// ---- resize ----
let W = 1, H = 1;
function resize() {
  pointerDirty = !!pointerClient;
  const r = stage.getBoundingClientRect(); W = Math.max(2, Math.floor(r.width)); H = Math.max(2, Math.floor(r.height));
  bp.setSize(W, H); overlay.setSize(W, H);
  rig.setViewport(W / H, demo ? discoveryFraming(tourState().running).fitHeight : ui.compactMedia.matches || framed ? 4.8 : 0);
  invalidateDemo();
}
window.addEventListener('resize', resize); resize();
new ResizeObserver(resize).observe(stage);

// ---- hover picking ----
const raycaster = new THREE.Raycaster();
const pickLocal = new THREE.Vector3();
function pickHit() {
  if (pointerX < 0 || dragging) return null;
  if (pointerClient) { const rect = stage.getBoundingClientRect(); pointerX = pointerClient.x - rect.left; pointerY = pointerClient.y - rect.top; }
  if (pointerX < 0 || pointerY < 0 || pointerX > W || pointerY > H) return null;
  const nx = (pointerX / W) * 2 - 1, ny = 1 - (pointerY / H) * 2;
  const ray = rig.ray(nx, ny); raycaster.set(ray.origin, ray.direction);
  const hits = raycaster.intersectObjects(vehicle.pickables, false);
  for (const hit of hits) {
    if (!visibleInScene(hit.object)) continue;
    if (hit.object.userData.cut && inVehicleAperture(hit.object.worldToLocal(pickLocal.copy(hit.point)), CUT)) continue;
    return hit;
  }
  return null;
}

// ---- main loop ----
// URL parameters for deep links / automated captures: ?view=side&explode=1&panels=0&open=1&drive=1&nodrift=1&snap=1
// Throwaway experiment: ?pbr=1 swaps the drawing pass for a lit PBR render to
// test whether the lofted surfacing survives reflections. See src/pbr-probe.js.
// pbr-probe.js is deliberately NOT in build.py's ORDER, but this dynamic import survives into the
// bundle, where it 404s -- and a failed TOP-LEVEL await means the whole module never evaluates, so
// the sheet renders blank with the onerror fallback stripped too. Guarded: in a dist build ?pbr=1
// now does nothing instead of destroying the page.
if (!demo && q.get('pbr') === '1') try {
  const { enablePbrProbe } = await import('./pbr-probe.js');
  const info = enablePbrProbe(bp, vehicle, q.get('paint') || '#4A5D3A');
  console.info('[pbr probe]', info);
  document.documentElement.dataset.pbr = '1';
} catch (e) { console.warn('[pbr probe] unavailable in this build:', e.message); }
setView(q.get('view') && CONFIG.views.some(v => v.id === q.get('view')) ? q.get('view') : 'iso'); ui.setToggle('run', true);
if (q.get('run') === '0') motion('run');
if (q.get('drive') === '1') motion('drive');
if (q.get('explode') === '1') motion('explode');
if (q.get('panels') === '0') motion('panels');
if (q.get('open') === '1') motion('open');
if (q.get('lights') === '1') motion('lights');
if (q.get('sil') === '1') st.sil = true;
// ?hide=a,b  /  ?only=a  — isolate parts by name when tracking down a stray surface
if (q.get('hide')) for (const n of q.get('hide').split(',')) vehicle.hidden.add(n);
if (q.get('only')) { const keep = q.get('only').split(','); for (const p of vehicle.order) if (!keep.includes(p.name)) vehicle.hidden.add(p.name); }
// ?cards is a deep link, not a preference: it must not overwrite what this browser has chosen, and
// it has to work in both directions. Without noPersist a single ?cards=0 link silently flipped the
// default for the origin, with no ?cards=1 able to undo it.
if (q.get('cards') === '0' || q.get('cards') === '1') ui.setCards(q.get('cards') === '1', true);
if (q.get('min')) for (const id of q.get('min').split(',')) { if (!/^[a-z]+$/.test(id)) continue; const el = document.getElementById(id); const b = el && el.querySelector('.panel-min'); if (b && !el.classList.contains('min')) { b.dataset.noPersist = '1'; b.click(); delete b.dataset.noPersist; } }
// ?nav=0 hides the header links when the sheet is embedded somewhere that has its own navigation
if (q.get('nav') === '0') document.body.classList.add('nav-off');
if (q.get('bare') === '1') { document.getElementById('overlay').style.display = 'none'; for (const id of ['key', 'instr', 'controls', 'primary-controls', 'cards-toggle', 'titleblock', 'viewtitle', 'hint', 'hdr-left', 'hdr-right']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; } }
if (q.get('nodrift') === '1') rig.driftOn = false;
if (q.get('snap') === '1' || q.get('az') || q.get('el')) { rig.goTo(st.view || 'iso', 0); rig.driftOn = false; if (q.get('az')) rig.cur.az = +q.get('az'); if (q.get('el')) rig.cur.el = +q.get('el'); rig.onSettle(st.view); }
// WebMCP + window.r2: the sheet is operable by an agent, not only by a person with a pointer
const api = installWebMCP({
  st, rig, vehicle, overlay, ui, bp, setView, motion, config: CONFIG, tourState, startTour, stopTour, internalOnly: demo,
  select: (p) => { selectedPart = p; pointerHit = null; pointerDirty = false; keyHover = null; st.hoverPart = p; ui.highlightKey(p ? p.name : null); ui.selectPart(p); },
});

function startTour(fromIndex = 0, hold = false) {
  stopTour('restart');
  if (demo) {
    document.body.classList.remove('demo-exploring');
    document.getElementById('demo-discovery').hidden = true;
    invalidateDemo();
  }
  tour = createTour({
    steps: hold ? CONFIG.tour.map(step => ({ ...step, dwell: Infinity })) : CONFIG.tour,
    call: api.callTour,
    onStep: (step, state) => { ui.showTour(step, state); invalidateDemo(); },
    onStop: (state, reason) => { ui.stopTour(state, reason); if (demo) finishDemo(reason); },
    now: () => performance.now(),
  });
  return tour.start(fromIndex);
}

if (demo) {
  canvas.setAttribute('aria-describedby', 'demo-description');
  canvas.setAttribute('aria-label', 'Explore the Hudian RX2');
  const discovery = document.getElementById('demo-discovery');
  const options = document.getElementById('demo-options');
  document.getElementById('demo-replay').addEventListener('click', () => { void startTour(); canvas.focus({ preventScroll: true }); });
  document.getElementById('demo-reset').addEventListener('click', () => { stopTour('reset'); finishDemo(); });
  document.getElementById('demo-options-toggle').addEventListener('click', e => {
    options.hidden = !options.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!options.hidden));
    invalidateDemo();
  });
  for (const button of document.querySelectorAll('[data-demo-action]')) button.addEventListener('click', () => activateDiscovery(button.dataset.demoAction));
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--demo-space', discovery.hidden ? '0px' : `${discovery.offsetHeight + 4}px`);
  }).observe(discovery);
  window.addEventListener('message', event => {
    const visible = demoVisibility(event, { origin: location.origin, parent: window.parent, self: window });
    if (visible === null) return;
    demoInViewport = visible;
    if (!visible) {
      stopTour('visibility');
      if (animationHandle !== null) { cancelAnimationFrame(animationHandle); animationHandle = null; }
    } else { last = performance.now(); invalidateDemo(); }
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (demo) stopTour('visibility');
    if (animationHandle !== null) { cancelAnimationFrame(animationHandle); animationHandle = null; }
  } else { last = performance.now(); if (demo) invalidateDemo(); else scheduleFrame(); }
});
// Complete the tool calls before ?adv pre-roll, so held captures render the requested step.
if (q.get('tour') === '1') {
  const requested = Number(q.get('step') || 1);
  const from = Number.isInteger(requested) && requested >= 1 && requested <= CONFIG.tour.length ? requested - 1 : 0;
  await startTour(from, q.get('hold') === '1');
  // Capture preferences override the reset/set_annotations actions without persisting them.
  if (q.has('cards')) ui.setCards(q.get('cards') !== '0', true);
}
if (demo && q.get('tour') !== '1') finishDemo();

let fpsAcc = 0, fpsN = 0, fpsShown = 60, uiT = 0, pickT = 0;
function step(dt, render = true) {
  st.time += dt;
  fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fpsShown = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

  // motion state
  const targetSpeed = st.drive ? 48 : 0; st.speed += (targetSpeed - st.speed) * Math.min(1, dt * 1.2);
  st.steer = st.drive ? Math.sin(st.time * 0.55) * 7 : 0;
  st.gridOffset = (st.gridOffset + st.speed / 3.6 * dt) % 1; // ground streams toward the tail; 1 m grid period
  if (st.drive) st.soc = Math.max(5, st.soc - dt * 0.012);
  st.explode = clamp(st.explode + (st.explodeOn ? 1 : -1) * dt / 1.15, 0, 1);
  st.open = clamp(st.open + (st.openOn ? 1 : -1) * dt / 0.8, 0, 1);
  vehicle.explodeT = easeInOut(st.explode); vehicle.openT = easeInOut(st.open);
  // back the camera off so the exploded stack stays on the sheet; the elevations already pin the
  // ground datum with groundFrac, so they need a smaller lift than the ISO views.
  // Compact and embedded stages now exclude the navigation and toolbar, so the camera
  // can centre naturally in their remaining drawing area, including phone landscape.
  Object.assign(rig, presentationFit(rig.view, vehicle.explodeT, vehicle.openT));
  if (demo) rig.tyOffset += discoveryFraming(tourState().running).tyOffset;
  vehicle.panelsT += ((st.panels ? 1 : 0) - vehicle.panelsT) * Math.min(1, dt * 6);
  if (Math.abs(vehicle.panelsT - (st.panels ? 1 : 0)) < 0.01) vehicle.panelsT = st.panels ? 1 : 0;
  flashT += dt; const flashGlow = flashT < 0.6 ? (1 - flashT / 0.6) : 0;
  st.lampGlow = Math.max(st.lights ? 1 : (st.run ? 0.30 + 0.04 * Math.sin(st.time * 3) : 0), flashGlow);
  st.lightsT = (st.lightsT ?? 0) + ((st.lights ? 1 : 0) - (st.lightsT ?? 0)) * Math.min(1, dt * 6);
  st.shellDissolve = vehicle.panelsT;

  // camera
  rig.update(dt); rig.apply(W / H); st.ortho = rig.cur.ortho;
  st.gridAlpha = demo ? 0 : (1 - rig.cur.ortho) * (ui.compactMedia.matches ? 0.32 : 0.65); st.shadowAlpha = rig.cur.el > 60 ? 1 - rig.cur.ortho : 1;
  vehicle.update(dt, st); vehicle.root.updateMatrixWorld(true);
  if (!render) return;

  // hover
  pickT += dt;
  if (pickT > 0.03) {
    pickT = 0;
    if (pointerDirty && !dragging && !(hadPinch && pinch.size)) { pointerHit = pickHit(); pointerDirty = false; }
    if (pointerHit && !visibleInScene(pointerHit.object)) pointerHit = null;
  }
  const inspected = hadPinch && pinch.size ? null : keyHover || selectedPart || pointerHit?.object.userData.part || null;
  st.hoverPart = inspected; st.hoverId = inspected ? inspected.id : -1; overlay.hoverId = st.hoverId;
  ui.highlightKey(inspected ? inspected.name : null); canvas.classList.toggle('hovering', !!inspected && !keyHover && !selectedPart);

  if (!demo) {
    const p = st.hoverPart;
    overlay.tooltipPartId = p?.id ?? -1;
    overlay.update(st, dt);
    const layout = p ? overlay.partTooltip(p) : null;
    ui.tooltip(pointerX, pointerY, p?.label, p?.desc, layout);
  }
  bp.render(rig.camera, st);
  if (demo) return;

  uiT += dt;
  if (uiT > 0.1) { uiT = 0;
    const rpm = st.speed / 3.6 / vehicle.SPEC.tireR * 60 / (2 * Math.PI);
    if (st.run) ui.setInstr({ steer: (st.steer >= 0 ? '+' : '−') + Math.abs(st.steer).toFixed(1).padStart(4, '0') + '°', rpm: rpm.toFixed(0) + ' rpm', speed: st.speed.toFixed(1) + ' km/h',
      ride: Math.round(vehicle.SPEC.groundClearance * 1000 + vehicle.bob * 1000) + ' mm', soc: st.soc.toFixed(1) + ' %', fps: fpsShown + ' fps' });
    else ui.setInstr({ steer: '—', rpm: '—', speed: '—', ride: '—', soc: st.soc.toFixed(1) + ' %', fps: fpsShown + ' fps' });
  }
}
function frame(now) {
  animationHandle = null;
  // Framed, a 30 Hz technical drawing still feels immediate and halves the three-pass GPU work so the
  // host page stays tactile; hidden, do nothing and reset the clock so returning never jumps.
  if (document.hidden || (demo && !demoInViewport)) { last = now; return; }
  if ((framed || demo) && now - last < 1000 / (demo ? 24 : 30)) { scheduleFrame(); return; }
  // clamp BOTH ends: a negative delta (rAF timestamp earlier than our last sample, which happens after
  // the deterministic ?adv= pre-roll, on bfcache restore and under timer coarsening) would run st.time
  // backwards and drive the explode/open ramps to full because their decay term flips sign.
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  step(dt);
  if (!demo || tourState().running || st.drive || rig.from || rig._orthoFade || dragging || pinch.size > 0
    || discoveryHasTransitions(st, vehicle, flashT) || now < demoDirtyUntil) scheduleFrame();
}
// ?adv=<seconds>: advance the simulation deterministically before the first frame (for captures)
if (q.get('adv')) { const n = Math.round(+q.get('adv') * 60); for (let i = 0; i < n; i++) step(1 / 60, false); overlay.dimAlpha = overlay.dimTarget; uiT = 1; step(1 / 60, true); }
animationReady = true; last = performance.now(); scheduleFrame();
postDemo('autolab-demo-ready');
if (!demo) window.__app = { rig, vehicle, st, overlay, bp, THREE };
if (!demo && q.get('debug') === '1') { const el = document.documentElement;
  const wide = [...document.querySelectorAll('#sheet *')].filter(e => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; })
    .map(e => `${e.id || e.className || e.tagName}:${Math.round(e.getBoundingClientRect().left)}..${Math.round(e.getBoundingClientRect().right)}`);
  console.log('LAYOUT vw=' + innerWidth + ' scrollW=' + el.scrollWidth + ' overflow=[' + wide.slice(0, 8).join(', ') + ']'); }
if (!demo && q.get('debug') === '1') setInterval(() => console.log('DBG ' + JSON.stringify({ t: +st.time.toFixed(2), panels: st.panels, panelsT: +vehicle.panelsT.toFixed(3), bodyVis: vehicle.parts.body.group.visible, explode: +st.explode.toFixed(2), open: +st.open.toFixed(3), openOn: st.openOn, url: location.search, az: +rig.cur.az.toFixed(1), ortho: +rig.cur.ortho.toFixed(2), view: rig.view, settled: rig.settled, fps: fpsShown })), 1000);
