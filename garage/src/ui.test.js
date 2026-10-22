import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { CONFIG, ROADSTER_CONFIG, toggleMotionState } from './config.js';
import { UI, garageSiteBase, CONSOLE_KEY, CONSOLE_KEY_FRAMED, LEGACY_CONSOLE_KEY } from './ui.js';

const require = createRequire(new URL('../../universal-vehicle-configurator/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function createSheet(t, { compact = true, url = 'https://example.test/autolab/configure/garage/', cards = null, legacyCards = null, framed = false, storage = null } = {}) {
  const dom = new JSDOM(html, { url });
  const win = dom.window;
  // framed: the sheet inside the configurator's iframe, where window.top is the host page (jsdom's
  // own top cannot be redefined, so the page's global window answers top with another object)
  const pageWindow = framed ? new Proxy(win, { get: (w, k) => { if (k === 'top') return {}; const v = Reflect.get(w, k, w); return typeof v === 'function' ? v.bind(w) : v; } }) : win;
  if (cards !== null) win.localStorage.setItem(framed ? CONSOLE_KEY_FRAMED : CONSOLE_KEY, cards);
  if (legacyCards !== null) win.localStorage.setItem(LEGACY_CONSOLE_KEY, legacyCards);
  for (const [k, v] of Object.entries(storage || {})) win.localStorage.setItem(k, v);
  win.matchMedia = () => ({ matches: compact, addEventListener() {} });
  win.HTMLDialogElement.prototype.show = function () { this.open = true; this.presentation = 'nonmodal'; };
  win.HTMLDialogElement.prototype.showModal = function () { this.open = true; this.presentation = 'modal'; };
  win.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new win.Event('close')); };
  for (const [name, value] of Object.entries({ window: pageWindow, document: win.document, location: win.location, localStorage: win.localStorage, requestAnimationFrame: fn => fn() })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => { if (old) Object.defineProperty(globalThis, name, old); else delete globalThis[name]; });
  }
  t.after(() => dom.window.close());
  const st = { run: true, drive: false, lights: false, panels: true, explodeOn: false, openOn: false };
  const callbacks = { onView: v => ui.setView(v), onMotion: m => { for (const [id, on] of Object.entries(toggleMotionState(st, m))) ui.setToggle(id, on); }, onKeyHover() {}, onKeySelect: t.mock.fn(), onReset: t.mock.fn(), onTour: t.mock.fn(), onVehicle: t.mock.fn(), onPlay: t.mock.fn() };
  const ui = new UI(CONFIG, callbacks);
  ui.setView('iso'); ui.setToggle('run', true);
  return { ui, st, callbacks, document: win.document, win };
}

test('navigation works for both public sheet routes and site prefixes', () => {
  for (const [path, expected] of [['/garage/', '/'], ['/configure/garage/', '/'], ['/configure/garage/index.html', '/'], ['/autolab/garage/', '/autolab/'], ['/autolab/configure/garage/', '/autolab/']]) assert.equal(garageSiteBase(path), expected);
});

test('compact views keep the sheet open for repeated choices and align both sets of preset states', t => {
  const { document, ui } = createSheet(t);
  const launcher = document.querySelector('[data-sheet="views"]');
  launcher.click();
  assert.equal(launcher.getAttribute('aria-expanded'), 'true');
  assert.equal(document.querySelector('#compact-sheet').open, true);
  assert.equal(document.querySelector('#compact-sheet').presentation, 'nonmodal');
  assert.equal(document.querySelector('#compact-sheet').getAttribute('aria-modal'), 'false');
  assert.equal(document.activeElement.dataset.view, 'iso');
  for (const view of ['side', 'top', 'iso']) {
    const selected = document.querySelector(`#compact-view-btns [data-view="${view}"]`);
    selected.focus();
    selected.click();
    assert.equal(document.querySelector('#compact-sheet').open, true);
    assert.equal(launcher.getAttribute('aria-expanded'), 'true');
    assert.equal(document.activeElement, selected);
    for (const button of ui.viewBtns) assert.equal(button.getAttribute('aria-pressed'), String(button.dataset.view === view));
  }
  assert.deepEqual([...document.querySelectorAll('[data-site-link]')].map(x => x.pathname), ['/autolab/', '/autolab/configure/', '/autolab/engine/']);
});

test('all motion controls reverse and run/drive dependencies update both visible and accessible states', t => {
  const { document, ui, st } = createSheet(t);
  document.querySelector('[data-sheet="more"]').click();
  const activate = name => {
    document.querySelector(`#compact-motion-btns [data-motion="${name}"]`).click();
    assert.equal(document.querySelector('#compact-sheet').open, true);
    assert.equal(document.querySelector('[data-sheet="more"]').getAttribute('aria-expanded'), 'true');
  };
  for (const name of ['lights', 'panels', 'explode', 'open']) {
    activate(name);
    assert.ok(ui.motionBtns.filter(b => b.dataset.motion === name).every(b => b.classList.contains('toggled') && b.getAttribute('aria-pressed') === 'true'));
    activate(name);
    assert.ok(ui.motionBtns.filter(b => b.dataset.motion === name).every(b => !b.classList.contains('toggled') && b.getAttribute('aria-pressed') === 'false'));
  }
  activate('lights');
  activate('open');
  assert.equal(st.lights, true); assert.equal(st.openOn, true);
  activate('lights');
  assert.equal(st.lights, false); assert.equal(st.openOn, true);
  activate('drive');
  activate('run');
  assert.equal(st.run, false); assert.equal(st.drive, false);
  activate('drive');
  assert.equal(st.run, true); assert.equal(st.drive, true);
  for (const b of ui.motionBtns.filter(b => ['run', 'drive'].includes(b.dataset.motion))) assert.equal(b.getAttribute('aria-pressed'), 'true');
});

test('parts remain reachable, selection closes the sheet, and Reset invokes the shared action', t => {
  const { document, callbacks } = createSheet(t);
  document.querySelector('[data-sheet="parts"]').click();
  assert.equal(document.querySelector('#compact-sheet').presentation, 'modal');
  assert.equal(document.querySelector('#compact-sheet').getAttribute('aria-modal'), 'true');
  assert.equal(document.activeElement.id, 'compact-sheet-close');
  assert.equal(document.querySelector('#compact-parts').hidden, false);
  assert.equal(document.querySelectorAll('#compact-key-grid button').length, 10);
  document.querySelector('#compact-key-grid [data-part="battery"]').click();
  assert.equal(callbacks.onKeySelect.mock.calls[0].arguments[0], 'battery');
  assert.equal(document.querySelector('#compact-sheet').open, false);
  document.querySelector('#reset-btn').click();
  assert.equal(callbacks.onReset.mock.callCount(), 1);
  document.querySelector('[data-sheet="more"]').click();
  document.querySelector('#reset-btn').click();
  assert.equal(callbacks.onReset.mock.callCount(), 2);
  assert.equal(document.querySelector('#compact-sheet').open, false);
});

test('annotations and tour can be activated repeatedly without dismissing More', t => {
  const { document, ui, callbacks } = createSheet(t);
  ui.setCards(false);
  document.querySelector('[data-sheet="more"]').click();
  for (const enabled of [true, false]) {
    const annotations = document.querySelector('#compact-cards-btn');
    annotations.focus();
    annotations.click();
    assert.equal(annotations.getAttribute('aria-pressed'), String(enabled));
    assert.equal(document.querySelector('#key').inert, !enabled);
    assert.equal(document.querySelector('#compact-sheet').open, true);
    assert.equal(document.activeElement, annotations);
  }
  const tour = document.querySelector('#compact-tour-btn');
  tour.focus();
  for (let activation = 1; activation <= 2; activation++) {
    tour.click();
    assert.equal(callbacks.onTour.mock.callCount(), activation);
    assert.equal(document.querySelector('#compact-sheet').open, true);
    assert.equal(document.activeElement, tour);
  }
});

test('quick panels switch from the persistent toolbar and Escape returns to the actual trigger', t => {
  const { document, win } = createSheet(t);
  const views = document.querySelector('[data-sheet="views"]');
  const more = document.querySelector('[data-sheet="more"]');
  const dialog = document.querySelector('#compact-sheet');
  views.click();
  more.click();
  // A queued native close event from Views must not reset the newly open More.
  dialog.dispatchEvent(new win.Event('close'));
  assert.equal(dialog.open, true);
  assert.equal(dialog.dataset.section, 'more');
  assert.equal(views.getAttribute('aria-expanded'), 'false');
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement.dataset.motion, 'run');
  document.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, more);
  more.click();
  more.click();
  assert.equal(dialog.open, false);
  assert.equal(more.getAttribute('aria-expanded'), 'false');
});

test('an outside pointer closes quick controls without swallowing the vehicle gesture; Parts stays modal', t => {
  const { document, win } = createSheet(t);
  const dialog = document.querySelector('#compact-sheet');
  const canvas = document.querySelector('#gl');
  const gesture = t.mock.fn();
  canvas.addEventListener('pointerdown', gesture);
  document.querySelector('[data-sheet="views"]').click();
  const pointer = new win.Event('pointerdown', { bubbles: true, cancelable: true });
  canvas.dispatchEvent(pointer);
  assert.equal(dialog.open, false);
  assert.equal(pointer.defaultPrevented, false);
  assert.equal(gesture.mock.callCount(), 1);
  document.querySelector('[data-sheet="parts"]').click();
  canvas.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
  assert.equal(dialog.open, true);
});

// The registry's shape as main.js passes it (vehicles.js), without loading three.js here.
const FLEET = [{ id: 'rx2', label: 'Hudian RX2', short: 'RX2', config: CONFIG, play: false }, { id: 'roadster', label: 'Tesla Roadster', short: 'ROADSTER', config: ROADSTER_CONFIG, play: true }];

test('the tray names the current car, lists both with aria-pressed, and PLAY appears only for the Roadster', t => {
  const { document, ui, callbacks } = createSheet(t);
  ui.setVehicles(FLEET, 'rx2');
  const button = document.querySelector('#vehicle-btn'), play = document.querySelector('#play-btn');
  const dialog = document.querySelector('#compact-sheet');
  assert.equal(button.textContent, 'RX2');
  assert.match(button.getAttribute('aria-label'), /Hudian RX2/);
  assert.equal(play.hidden, true);
  button.click();
  assert.equal(dialog.open, true);
  assert.equal(dialog.dataset.section, 'vehicles');
  assert.equal(dialog.getAttribute('aria-modal'), 'false');
  assert.equal(document.querySelector('#compact-sheet-title').textContent, 'VEHICLE');
  assert.equal(document.querySelector('#compact-vehicles').hidden, false);
  assert.equal(document.querySelector('#compact-views').hidden, true);
  const choices = [...document.querySelectorAll('#compact-vehicle-btns [data-vehicle]')];
  assert.deepEqual(choices.map(b => [b.dataset.vehicle, b.getAttribute('aria-pressed')]), [['rx2', 'true'], ['roadster', 'false']]);
  assert.equal(document.activeElement, choices[0], 'focus lands on the current car');
  choices[0].click();
  assert.equal(callbacks.onVehicle.mock.callCount(), 0, 'choosing the current car only closes the menu');
  assert.equal(dialog.open, false);
  button.click(); choices[1].click();
  assert.deepEqual(callbacks.onVehicle.mock.calls.map(c => c.arguments[0]), ['roadster']);
  assert.equal(dialog.open, false); assert.equal(document.activeElement, button);
  ui.setVehicle('roadster');
  assert.equal(button.textContent, 'ROADSTER');
  assert.deepEqual(choices.map(b => b.getAttribute('aria-pressed')), ['false', 'true']);
  assert.equal(play.hidden, false);
  assert.ok(document.body.classList.contains('has-play'), 'the wide header makes room for PLAY');
  play.click();
  assert.equal(callbacks.onPlay.mock.callCount(), 1);
  ui.setPlaying(true);
  assert.equal(play.textContent, 'STOP'); assert.equal(play.getAttribute('aria-pressed'), 'true');
  ui.showRunStatus('Run mode: coming in the next build');
  assert.equal(document.querySelector('#run-status').hidden, false);
  assert.equal(document.querySelector('#run-status').textContent, 'Run mode: coming in the next build');
  ui.setPlaying(false); ui.showRunStatus('');
  assert.equal(play.textContent, 'PLAY'); assert.equal(play.getAttribute('aria-pressed'), 'false');
  assert.equal(document.querySelector('#run-status').hidden, true);
  ui.setVehicle('rx2');
  assert.equal(play.hidden, true);
  assert.ok(!document.body.classList.contains('has-play'));
});

test('the vehicle menu closes on Escape back to its button, and on an outside pointer without eating it', t => {
  const { document, ui, win } = createSheet(t);
  ui.setVehicles(FLEET, 'rx2');
  const button = document.querySelector('#vehicle-btn'), dialog = document.querySelector('#compact-sheet');
  button.click();
  document.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(dialog.open, false);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, button);
  button.click();
  const canvas = document.querySelector('#gl'), gesture = t.mock.fn();
  canvas.addEventListener('pointerdown', gesture);
  const pointer = new win.Event('pointerdown', { bubbles: true, cancelable: true });
  canvas.dispatchEvent(pointer);
  assert.equal(dialog.open, false);
  assert.equal(pointer.defaultPrevented, false); assert.equal(gesture.mock.callCount(), 1);
  // the tray's own Views launcher swaps the section rather than toggling the sheet shut
  button.click(); document.querySelector('[data-sheet="views"]').click();
  assert.equal(dialog.open, true); assert.equal(dialog.dataset.section, 'views');
  assert.equal(document.querySelector('#compact-vehicles').hidden, true);
});

test('switching the sheet to the Roadster rewrites its text, key and buttons, and keeps the tour launchers', t => {
  const { document, ui, callbacks } = createSheet(t);
  ui.setConfig(ROADSTER_CONFIG);
  assert.match(document.querySelector('#tb-title').textContent, /TESLA ROADSTER/);
  assert.deepEqual([...document.querySelectorAll('#compact-key-grid [data-part]')].map(b => b.dataset.part), ROADSTER_CONFIG.keyItems.map(k => k.part));
  assert.equal(document.querySelectorAll('#key-grid .key-item').length, 10);
  assert.equal(ui.keyEls.length, 20, 'both key grids, rebuilt');
  document.querySelector('#compact-key-grid [data-part="fans"]').click();
  assert.equal(callbacks.onKeySelect.mock.calls.at(-1).arguments[0], 'fans');
  assert.ok(document.querySelector('#motion-btns #tour-btn') && document.querySelector('#compact-motion-btns #compact-tour-btn'));
  assert.equal(document.querySelectorAll('#tour-btn').length, 1);
  document.querySelector('#compact-tour-btn').click();
  assert.equal(callbacks.onTour.mock.callCount(), 1, 'the moved tour button keeps its listener');
  ui.highlightKey('wheelRL');
  assert.deepEqual(ui.keyEls.filter(el => el.classList.contains('hot')).map(el => el.dataset.part), ['wheelFR', 'wheelFR'], 'a wheel without a row lights the wheel row');
  ui.highlightKey('doorFR');
  assert.deepEqual(ui.keyEls.filter(el => el.classList.contains('hot')).map(el => el.dataset.part), ['doorFR', 'doorFR']);
});

test('every agent tool has a line in the agent tools panel, and the telemetry rows can be swapped and back', async t => {
  const { ui, document } = createSheet(t);
  const source = await readFile(new URL('./webmcp.js', import.meta.url), 'utf8');
  const names = [...source.matchAll(/^      name: '([a-z_]+)',$/gm)].map(m => m[1]);
  assert.equal(names.length, 25);
  ui.setAgentTools({ tools: names.map(name => ({ name })), registered: true });
  const lines = [...document.querySelectorAll('#agent-tools-list dd')].map(dd => dd.textContent);
  assert.equal(lines.length, 25);
  assert.ok(lines.every(line => line.length > 10), 'no tool without its summary');
  assert.equal(document.getElementById('agent-chip').textContent, '25 AGENT TOOLS');
  ui.setInstrRows([{ k: 'SPEED', id: 'speed' }, { k: 'RUN', id: 'outcome' }]);
  ui.setInstr({ speed: '12.0 km/h', outcome: 'RUNNING', soc: '87 %' });
  assert.deepEqual([...document.querySelectorAll('#instr-grid .v')].map(v => v.textContent), ['12.0 km/h', 'RUNNING']);
  ui.setInstrRows();
  assert.deepEqual([...document.querySelectorAll('#instr-grid .k')].map(k => k.textContent), CONFIG.instr.map(r => r.k));
});

// ---- the tray, the console and the header (2026-10-22) ----
const trayIds = (document) => [...document.querySelectorAll('#primary-controls > .btn:not(.compact-only)')].map(b => b.id);

test('console off on a wide sheet: one tray row at the foot, vehicle TOUR PLAY RESET CONSOLE, and no header titles or drag hint', t => {
  const { document, ui } = createSheet(t, { compact: false, url: 'https://example.test/autolab/garage/' });
  ui.setVehicles(FLEET, 'roadster');
  assert.ok(document.body.classList.contains('cards-off'), 'standalone opens with the console off');
  assert.equal(localStorage.getItem(CONSOLE_KEY), null, 'opening writes no preference; only a choice does');
  const tray = document.querySelector('#primary-controls');
  assert.equal(tray.parentElement.id, 'sheet', 'the tray sits on the sheet, not in the controls panel');
  assert.deepEqual(trayIds(document), ['vehicle-btn', 'tour-btn', 'play-btn', 'reset-btn', 'cards-toggle']);
  assert.equal(document.querySelectorAll('#tour-btn').length, 1);
  const consoleBtn = document.querySelector('#cards-toggle');
  assert.equal(consoleBtn.textContent, 'CONSOLE');
  assert.equal(consoleBtn.className.split(' ')[0], 'btn', 'the same button as the rest of the tray');
  assert.equal(consoleBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(document.querySelector('#play-btn').hidden, false);
  // the header is the page links and the agent chip; no titles, no Session ID, no drag hint
  for (const sel of ['#hdr-right', '#hdr-left-title', '#hdr-left-sub', '#hdr-left .logo', '#hint']) assert.equal(document.querySelector(sel), null, sel);
  assert.doesNotMatch(document.body.textContent, /DRAG TO ORBIT|Session ID|Knowledge Base/);
  assert.equal(document.querySelector('#titleblock .tb-title .tb-lbl'), null, 'the title block has no TITLE label');
  assert.deepEqual([...document.querySelectorAll('.header-tools a')].map(a => a.textContent.trim()), ['AUTOLAB', 'BUILD', 'LEARN', 'CREATE']);
  assert.equal(document.querySelector('.header-tools a[aria-current="page"]').textContent, 'LEARN');
  assert.ok(document.querySelector('.header-tools #agent-chip'), 'the agent chip stays');
  // the AutoLab mark: the tab icon and the home link's mark come from the site's root
  assert.equal(new URL(document.querySelector('link[rel="icon"]').href).pathname, '/autolab/assets/brand/favicon.svg');
  assert.equal(document.querySelector('link[rel="icon"]').type, 'image/svg+xml');
  assert.equal(new URL(document.querySelector('.nav-home img').src).pathname, '/autolab/assets/brand/favicon.svg');
});

test('CONSOLE on: the tray becomes the controls panel\'s third row, TOUR goes back to MOTION, and focus follows the button', t => {
  const { document, ui } = createSheet(t, { compact: false, url: 'https://example.test/autolab/garage/' });
  ui.setVehicles(FLEET, 'roadster');
  const consoleBtn = document.querySelector('#cards-toggle');
  consoleBtn.focus();
  consoleBtn.click();
  assert.ok(!document.body.classList.contains('cards-off'));
  assert.equal(consoleBtn.getAttribute('aria-pressed'), 'true');
  assert.ok(consoleBtn.classList.contains('toggled'));
  assert.equal(document.querySelector('#primary-controls').parentElement.id, 'tray-row');
  assert.ok(document.body.classList.contains('tray-in-panel'));
  assert.equal(document.querySelector('#tour-btn').parentElement.id, 'motion-btns', 'TOUR in the MOTION row, not twice');
  assert.deepEqual(trayIds(document), ['vehicle-btn', 'play-btn', 'reset-btn', 'cards-toggle']);
  assert.equal(document.activeElement, consoleBtn, 'focus stays on CONSOLE after the move');
  assert.equal(localStorage.getItem(CONSOLE_KEY), '1', 'the choice is remembered');
  // a vehicle switch rebuilds the motion row; the tour button stays put and single
  ui.setConfig(ROADSTER_CONFIG);
  assert.equal(document.querySelectorAll('#tour-btn').length, 1);
  assert.equal(document.querySelector('#tour-btn').parentElement.id, 'motion-btns');
  consoleBtn.click();
  assert.ok(document.body.classList.contains('cards-off'));
  assert.equal(document.querySelector('#primary-controls').parentElement.id, 'sheet');
  assert.deepEqual(trayIds(document), ['vehicle-btn', 'tour-btn', 'play-btn', 'reset-btn', 'cards-toggle']);
  assert.equal(localStorage.getItem(CONSOLE_KEY), '0');
});

test('in a run the tray stays at the foot of the sheet whatever the console; a saved console preference still opens with it', t => {
  const { document, ui } = createSheet(t, { compact: false, url: 'https://example.test/autolab/garage/', cards: '1' });
  ui.setVehicles(FLEET, 'roadster');
  assert.ok(!document.body.classList.contains('cards-off'), 'the saved preference wins over the default');
  assert.equal(document.querySelector('#primary-controls').parentElement.id, 'tray-row');
  document.body.classList.add('run-active'); ui.layoutTray();
  assert.equal(document.querySelector('#primary-controls').parentElement.id, 'sheet');
  assert.equal(document.querySelector('#tour-btn').parentElement.id, 'motion-btns');
  document.body.classList.remove('run-active'); ui.layoutTray();
  assert.equal(document.querySelector('#primary-controls').parentElement.id, 'tray-row');
});

test('the old build\'s r2.cards value is ignored and cleared; standalone and framed keep separate choices', t => {
  // the earlier build saved the default on every visit, so one framed visit left r2.cards = '1'
  {
    const { document, ui } = createSheet(t, { compact: false, url: 'https://example.test/autolab/garage/', legacyCards: '1' });
    ui.setVehicles(FLEET, 'roadster');
    assert.ok(document.body.classList.contains('cards-off'), 'the standalone sheet still opens cardless');
    assert.equal(document.querySelector('#primary-controls').parentElement.id, 'sheet', 'with the tray at the foot of the sheet');
    assert.equal(localStorage.getItem(LEGACY_CONSOLE_KEY), null, 'the stale value is cleared');
    assert.equal(localStorage.getItem(CONSOLE_KEY), null, 'and nothing is written in its place');
  }
  {
    // framed: the configurator's sheet opens with its panels whatever the old key or the standalone choice says
    const { document } = createSheet(t, { framed: true, legacyCards: '0', storage: { [CONSOLE_KEY]: '0' } });
    assert.ok(!document.body.classList.contains('cards-off'), 'framed opens with the console on');
    assert.equal(localStorage.getItem(LEGACY_CONSOLE_KEY), null);
    document.querySelector('#compact-cards-btn').click();
    assert.equal(localStorage.getItem(CONSOLE_KEY_FRAMED), '0', 'a framed choice is kept under the framed key');
    assert.equal(localStorage.getItem(CONSOLE_KEY), '0', 'and leaves the standalone choice alone');
  }
  {
    // a choice made on the standalone page under the new key still wins over the default there
    const { document } = createSheet(t, { compact: false, url: 'https://example.test/autolab/garage/', storage: { [CONSOLE_KEY]: '1', [CONSOLE_KEY_FRAMED]: '0' } });
    assert.ok(!document.body.classList.contains('cards-off'));
  }
});

test('keepCards leaves the console as it is (the tray\'s RESET), and compact sheets keep their own toolbar with CONSOLE in MORE', t => {
  const { document, ui } = createSheet(t);
  ui.setCards(false);
  ui.keepCards(() => ui.setCards(true));
  assert.ok(document.body.classList.contains('cards-off'), 'held: the reset tool\'s cards-on is ignored');
  ui.setCards(true);
  assert.ok(!document.body.classList.contains('cards-off'), 'and released afterwards');
  // compact: the tray never moves into the (hidden) controls panel, TOUR lives in MORE
  assert.equal(document.querySelector('#primary-controls').parentElement.id, 'sheet');
  assert.equal(document.querySelector('#tour-btn').parentElement.id, 'motion-btns');
  assert.equal(document.querySelector('#compact-cards-btn').textContent, 'CONSOLE');
  assert.equal(document.querySelector('#compact-cards-btn').getAttribute('aria-pressed'), 'true');
});
