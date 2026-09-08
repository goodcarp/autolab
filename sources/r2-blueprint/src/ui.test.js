import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { CONFIG, toggleMotionState } from './config.js';
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
  const callbacks = { onView: v => ui.setView(v), onMotion: m => { for (const [id, on] of Object.entries(toggleMotionState(st, m))) ui.setToggle(id, on); }, onKeyHover() {}, onKeySelect: t.mock.fn(), onReset: t.mock.fn(), onTour: t.mock.fn() };
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
