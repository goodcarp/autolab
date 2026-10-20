import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { CONFIG, ROADSTER_CONFIG, toggleMotionState } from './config.js';
import { UI, garageSiteBase } from './ui.js';

const require = createRequire(new URL('../../universal-vehicle-configurator/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function createSheet(t) {
  const dom = new JSDOM(html, { url: 'https://example.test/autolab/configure/garage/' });
  const win = dom.window;
  win.matchMedia = () => ({ matches: true, addEventListener() {} });
  win.HTMLDialogElement.prototype.show = function () { this.open = true; this.presentation = 'nonmodal'; };
  win.HTMLDialogElement.prototype.showModal = function () { this.open = true; this.presentation = 'modal'; };
  win.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new win.Event('close')); };
  for (const [name, value] of Object.entries({ window: win, document: win.document, location: win.location, localStorage: win.localStorage, requestAnimationFrame: fn => fn() })) {
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
  assert.equal(document.querySelector('#hdr-right-title').textContent, ROADSTER_CONFIG.hdrRight.title);
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
