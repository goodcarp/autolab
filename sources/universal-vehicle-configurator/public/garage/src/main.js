import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildVehicle } from './vehicle.js';
import { Blueprint } from './blueprint.js';
import { Rig } from './camera.js';
import { Overlay } from './overlay.js';
import { UI } from './ui.js';
import { installWebMCP } from './webmcp.js';
import { easeInOut, clamp } from './geom.js';

const canvas = document.getElementById('gl');
const svg = document.getElementById('overlay');
const stage = document.getElementById('stage');

let bp;
try { bp = new Blueprint(canvas); } catch (e) { document.getElementById('fallback').hidden = false; throw e; }
const vehicle = buildVehicle();
bp.addVehicle(vehicle);
const rig = new Rig();
const overlay = new Overlay(svg, rig, vehicle);

const st = {
  view: 'iso', run: true, drive: false, lights: false, panels: true, explode: 0, open: 0, explodeOn: false, openOn: false,
  speed: 0, steer: 0, soc: 87.0, time: 0, ortho: 0, hoverId: -1, hoverPart: null, lampGlow: 0, gridOffset: 0, gridAlpha: 1, hidePanels: false,
  vehicleContext: { build: 'Hudian RX2', paint: 'Not supplied', wheels: '20 in reference', interior: 'Not supplied', rangeMiles: null, vehicleTotal: null, revision: 1 },
};
const ui = new UI(CONFIG, {
  onView: (v) => setView(v),
  onMotion: (m) => motion(m),
  onKeyHover: (part) => { keyHover = part ? vehicle.parts[part] : null; },
});
let keyHover = null;

function setView(v) {
  st.view = v; ui.setView(v); rig.goTo(v); overlay.setView(v);
  const ortho = (v === 'side' || v === 'front' || v === 'top');
  ui.showPanels(!ortho); st.hidePanels = ortho;
  ui.showViewTitle(null);
}
rig.onSettle = (v) => { overlay.settled(v); ui.showViewTitle(v); };

function motion(m) {
  if (m === 'run') { st.run = !st.run; ui.setToggle('run', st.run); if (!st.run && st.drive) { st.drive = false; ui.setToggle('drive', false); } }
  else if (m === 'drive') { st.drive = !st.drive; ui.setToggle('drive', st.drive); if (st.drive && !st.run) { st.run = true; ui.setToggle('run', true); } }
  else if (m === 'lights') { st.lights = !st.lights; ui.setToggle('lights', st.lights); if (st.lights) { flashT = 0; const S = vehicle.SPEC; overlay.flash(vehicle.parts.headlamps, [[S.NOSE + 0.05, 0.875, -0.595], [S.NOSE + 0.05, 0.875, 0.595]]); } }
  else if (m === 'panels') { st.panels = !st.panels; ui.setToggle('panels', !st.panels); }
  else if (m === 'explode') { st.explodeOn = !st.explodeOn; ui.setToggle('explode', st.explodeOn); }
  else if (m === 'open') { st.openOn = !st.openOn; ui.setToggle('open', st.openOn); }
}
let flashT = 99;

// ---- pointer interaction ----
let dragging = false, lastX = 0, lastY = 0, moved = 0, pointerX = -1, pointerY = -1;
canvas.addEventListener('pointerdown', (e) => { if (e.button !== 0 || !e.isPrimary) return; dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); });
canvas.addEventListener('pointermove', (e) => {
  const r = stage.getBoundingClientRect(); pointerX = e.clientX - r.left; pointerY = e.clientY - r.top;
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
  if (moved > 3) { if (rig.view) { rig.grab(); ui.setView(null); overlay.setView(null); ui.showViewTitle(null); ui.showPanels(true); st.hidePanels = false; st.view = null; }
    rig.orbit(dx, dy); }
});
const endDrag = (e) => { if (!e.isPrimary) return; dragging = false; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => { pointerX = pointerY = -1; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); rig.zoom(Math.exp(e.deltaY * 0.0012)); rig.idle = 0; }, { passive: false });

// Pinch to zoom. Zoom was bound to the wheel alone, so on a touch device the
// only way in or out of the drawing was the view presets — and the on-screen
// hint said "scroll to zoom", which names a gesture that does not exist there.
// Tracked over raw pointer ids because the orbit handler only follows the
// primary pointer; a second finger arriving switches this to a pinch and
// suspends the orbit rather than letting the two fight.
const pinch = new Map();
let pinchSpan = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch.size === 2) {
    const [a, b] = [...pinch.values()];
    pinchSpan = Math.hypot(a.x - b.x, a.y - b.y);
    dragging = false;
    canvas.classList.remove('dragging');
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'touch' || !pinch.has(e.pointerId)) return;
  pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch.size !== 2) return;
  const [a, b] = [...pinch.values()];
  const span = Math.hypot(a.x - b.x, a.y - b.y);
  if (pinchSpan > 0 && span > 0) {
    if (rig.view) { rig.grab(); ui.setView(null); overlay.setView(null); ui.showViewTitle(null); ui.showPanels(true); st.hidePanels = false; st.view = null; }
    rig.zoom(pinchSpan / span);
    rig.idle = 0;
  }
  pinchSpan = span;
});
const endPinch = (e) => {
  if (e.pointerType !== 'touch') return;
  pinch.delete(e.pointerId);
  if (pinch.size < 2) pinchSpan = 0;
};
canvas.addEventListener('pointerup', endPinch);
canvas.addEventListener('pointercancel', endPinch);

// Name the gesture the device actually has.
{
  const hint = document.getElementById('hint');
  if (hint && window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
    hint.textContent = 'DRAG TO ORBIT · PINCH TO ZOOM';
  }
}
// arrows orbit and [ ] dolly, so the camera is reachable without a pointer (and from a screen reader
// or an agent driving the page by keystroke rather than through window.r2)
function camKey(k, shift) {
  const step = shift ? 15 : 4;
  if (rig.view) { rig.grab(); ui.setView(null); overlay.setView(null); ui.showViewTitle(null); ui.showPanels(true); st.hidePanels = false; st.view = null; }
  if (k === 'ArrowLeft') rig.cur.az -= step; else if (k === 'ArrowRight') rig.cur.az += step;
  else if (k === 'ArrowUp') rig.cur.el = Math.min(86, rig.cur.el + step); else if (k === 'ArrowDown') rig.cur.el = Math.max(2, rig.cur.el - step);
  else if (k === '[') rig.zoom(shift ? 1.25 : 1.08); else if (k === ']') rig.zoom(shift ? 0.8 : 0.93);
}
window.addEventListener('keydown', (e) => { if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.target.tagName === 'INPUT') return; const map = { 1: 'iso', 2: 'q34f', 3: 'q34r', 4: 'side', 5: 'front', 6: 'top' }; if (map[e.key]) setView(map[e.key]); if (/^(Arrow(Left|Right|Up|Down)|\[|\])$/.test(e.key)) { e.preventDefault(); camKey(e.key, e.shiftKey); } if (e.key === ' ') { e.preventDefault(); motion('drive'); } if (e.key === 'e') motion('explode'); if (e.key === 'l' || e.key === 'f') motion('lights'); if (e.key === 'h') ui.setCards(document.body.classList.contains('cards-off')); if (e.key === 'p') motion('panels'); if (e.key === 'o') motion('open'); if (e.key === 'd') motion('drive'); if (e.key === 'r') motion('run'); });

// ---- resize ----
let W = 1, H = 1;
function resize() {
  const r = stage.getBoundingClientRect(); W = Math.max(2, Math.floor(r.width)); H = Math.max(2, Math.floor(r.height));
  bp.setSize(W, H); overlay.setSize(W, H);
}
window.addEventListener('resize', resize); resize(); rig.aspect = W / H;

// ---- hover picking ----
const raycaster = new THREE.Raycaster();
function pick() {
  if (pointerX < 0 || dragging) return null;
  const nx = (pointerX / W) * 2 - 1, ny = 1 - (pointerY / H) * 2;
  const ray = rig.ray(nx, ny); raycaster.set(ray.origin, ray.direction);
  const hits = raycaster.intersectObjects(vehicle.pickables, false);
  for (const h of hits) { if (h.object.visible && h.object.parent.visible) return h.object.userData.part; }
  return null;
}

// ---- main loop ----
// URL parameters for deep links / automated captures: ?view=side&explode=1&panels=0&open=1&drive=1&nodrift=1&snap=1
const q = new URLSearchParams(location.search);

// Throwaway experiment: ?pbr=1 swaps the drawing pass for a lit PBR render to
// test whether the lofted surfacing survives reflections. See src/pbr-probe.js.
if (q.get('pbr') === '1') {
  const { enablePbrProbe } = await import('./pbr-probe.js');
  const info = enablePbrProbe(bp, vehicle, q.get('paint') || '#4A5D3A');
  console.info('[pbr probe]', info);
  document.documentElement.dataset.pbr = '1';
}
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
if (q.get('cards') === '0') ui.setCards(false);
if (q.get('min')) for (const id of q.get('min').split(',')) { if (!/^[a-z]+$/.test(id)) continue; const el = document.getElementById(id); const b = el && el.querySelector('.panel-min'); if (b && !el.classList.contains('min')) { b.dataset.noPersist = '1'; b.click(); delete b.dataset.noPersist; } }
if (q.get('bare') === '1') { document.getElementById('overlay').style.display = 'none'; for (const id of ['key', 'instr', 'controls', 'titleblock', 'viewtitle', 'hint', 'hdr-left', 'hdr-right']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; } }
if (q.get('nodrift') === '1') rig.driftOn = false;
if (q.get('snap') === '1' || q.get('az') || q.get('el')) { rig.goTo(st.view || 'iso', 0); rig.driftOn = false; if (q.get('az')) rig.cur.az = +q.get('az'); if (q.get('el')) rig.cur.el = +q.get('el'); rig.onSettle(st.view); }
// WebMCP + window.r2: the sheet is operable by an agent, not only by a person with a pointer
installWebMCP({
  st, rig, vehicle, overlay, ui, setView, motion, config: CONFIG,
  select: (p) => { keyHover = p; ui.highlightKey(p ? p.name : null); },
});

let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsShown = 60, uiT = 0, pickT = 0;
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
  const elev = rig.view === 'front' || rig.view === 'side';
  const q34 = rig.view === 'q34f' || rig.view === 'q34r'; // tight, low 3/4 framings need the most pull-back
  rig.fitScale = 1 + (q34 ? 0.95 : 0.56) * vehicle.explodeT; rig.tyOffset = (elev ? 0.60 : 1.08) * vehicle.explodeT;
  vehicle.panelsT += ((st.panels ? 1 : 0) - vehicle.panelsT) * Math.min(1, dt * 6);
  if (Math.abs(vehicle.panelsT - (st.panels ? 1 : 0)) < 0.01) vehicle.panelsT = st.panels ? 1 : 0;
  flashT += dt; const flashGlow = flashT < 0.6 ? (1 - flashT / 0.6) : 0;
  st.lampGlow = Math.max(st.lights ? 1 : (st.run ? 0.30 + 0.04 * Math.sin(st.time * 3) : 0), flashGlow);
  st.lightsT = (st.lightsT ?? 0) + ((st.lights ? 1 : 0) - (st.lightsT ?? 0)) * Math.min(1, dt * 6);
  st.shellDissolve = vehicle.panelsT;

  // camera
  rig.update(dt); rig.apply(W / H); st.ortho = rig.cur.ortho;
  st.gridAlpha = 1 - rig.cur.ortho; st.shadowAlpha = rig.cur.el > 60 ? 1 - rig.cur.ortho : 1;
  vehicle.update(dt, st); vehicle.root.updateMatrixWorld(true);
  if (!render) return;

  // hover
  pickT += dt;
  if (pickT > 0.03) { pickT = 0; const p = keyHover || pick(); st.hoverPart = p; st.hoverId = p ? p.id : -1; overlay.hoverId = st.hoverId; ui.highlightKey(p ? p.name : null); canvas.classList.toggle('hovering', !!p && !keyHover);
    if (p && !keyHover) ui.tooltip(pointerX, pointerY, p.label, p.desc); else ui.tooltip(); }

  overlay.update(st, dt);
  bp.render(rig.camera, st);

  uiT += dt;
  if (uiT > 0.1) { uiT = 0;
    const rpm = st.speed / 3.6 / vehicle.SPEC.tireR * 60 / (2 * Math.PI);
    if (st.run) ui.setInstr({ steer: (st.steer >= 0 ? '+' : '−') + Math.abs(st.steer).toFixed(1).padStart(4, '0') + '°', rpm: rpm.toFixed(0) + ' rpm', speed: st.speed.toFixed(1) + ' km/h',
      ride: Math.round(vehicle.SPEC.groundClearance * 1000 + vehicle.bob * 1000) + ' mm', soc: st.soc.toFixed(1) + ' %', fps: fpsShown + ' fps' });
    else ui.setInstr({ steer: '—', rpm: '—', speed: '—', ride: '—', soc: st.soc.toFixed(1) + ' %', fps: fpsShown + ' fps' });
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  // A 30 Hz technical drawing still feels immediate, but halves the most
  // expensive three-pass GPU work and frees the host page to stay tactile.
  // Reset the clock while hidden so returning to the tab never causes a jump.
  if (document.hidden) { last = now; return; }
  if (now - last < 1000 / 30) return;
  // clamp BOTH ends: a negative delta (rAF timestamp earlier than our last sample, which happens after
  // the deterministic ?adv= pre-roll, on bfcache restore and under timer coarsening) would run st.time
  // backwards and drive the explode/open ramps to full because their decay term flips sign.
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  step(dt);
}
// ?adv=<seconds>: advance the simulation deterministically before the first frame (for captures)
if (q.get('adv')) { const n = Math.round(+q.get('adv') * 60); for (let i = 0; i < n; i++) step(1 / 60, false); overlay.dimAlpha = overlay.dimTarget; uiT = 1; step(1 / 60, true); }
requestAnimationFrame(frame);
window.__app = { rig, vehicle, st, overlay, bp, THREE };
if (q.get('debug') === '1') { const el = document.documentElement;
  const wide = [...document.querySelectorAll('#sheet *')].filter(e => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; })
    .map(e => `${e.id || e.className || e.tagName}:${Math.round(e.getBoundingClientRect().left)}..${Math.round(e.getBoundingClientRect().right)}`);
  console.log('LAYOUT vw=' + innerWidth + ' scrollW=' + el.scrollWidth + ' overflow=[' + wide.slice(0, 8).join(', ') + ']'); }
if (q.get('debug') === '1') setInterval(() => console.log('DBG ' + JSON.stringify({ t: +st.time.toFixed(2), panels: st.panels, panelsT: +vehicle.panelsT.toFixed(3), bodyVis: vehicle.parts.body.group.visible, explode: +st.explode.toFixed(2), open: +st.open.toFixed(3), openOn: st.openOn, url: location.search, az: +rig.cur.az.toFixed(1), ortho: +rig.cur.ortho.toFixed(2), view: rig.view, settled: rig.settled, fps: fpsShown })), 1000);
