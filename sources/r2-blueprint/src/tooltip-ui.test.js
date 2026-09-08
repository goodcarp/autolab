import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { UI } from './ui.js';

const require = createRequire(new URL('../../universal-vehicle-configurator/package.json', import.meta.url));
const { JSDOM } = require('jsdom');

function tooltipHarness(t) {
  const dom = new JSDOM('<body class="framed cards-off"><div id="stage"><svg id="overlay" style="display:none"></svg><div id="tooltip"><div class="tt-name"></div><div class="tt-desc"></div></div></div><p id="selected-part"></p></body>');
  const before = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
  t.after(() => { if (before) Object.defineProperty(globalThis, 'document', before); else delete globalThis.document; dom.window.close(); });
  const doc = dom.window.document, tt = doc.getElementById('tooltip'), ui = { tt };
  const size = { width: 390, height: 400 };
  doc.getElementById('stage').getBoundingClientRect = () => size;
  Object.defineProperties(tt, { offsetWidth: { get: () => tt.classList.contains('compact') ? 176 : 260 }, offsetHeight: { value: 70 } });
  const show = layout => UI.prototype.tooltip.call(ui, -1, -1, 'BATTERY PACK', 'Existing part description.', layout);
  return { doc, tt, ui, size, show };
}

test('every stage width gets a pointer on the first visible frame, without global annotations or a number', t => {
  const { doc, tt, size, show } = tooltipHarness(t);
  for (const width of [320, 390, 667, 1200]) {
    size.width = width;
    show({ partId: 21, anchor: { x: width / 2, y: 200 }, vehicle: [20, 90, width - 20, 310], obstacles: [] });
    assert.ok(tt.classList.contains('show'));
    const pointer = doc.getElementById('part-pointer');
    assert.ok(pointer.classList.contains('show'));
    assert.ok(pointer.querySelector('path').getAttribute('d').startsWith(`M ${(width / 2).toFixed(1)} 200.0`));
    assert.equal(pointer.querySelector('text'), null);
    assert.equal(tt.querySelector('.tt-name').textContent, 'BATTERY PACK');
    assert.equal(tt.querySelector('.tt-desc').textContent, 'Existing part description.');
    assert.ok(Number.parseFloat(tt.style.left) >= 8);
    assert.ok(Number.parseFloat(tt.style.left) + tt.offsetWidth <= width - 8);
  }
});

test('small movement cannot send a card from the top to the bottom; only its pointer tracks', t => {
  const { doc, tt, show } = tooltipHarness(t);
  const initial = { partId: 21, anchor: { x: 195, y: 200 }, vehicle: [20, 90, 370, 310], obstacles: [] };
  show(initial);
  const position = [tt.style.left, tt.style.top];
  const before = doc.getElementById('part-pointer').querySelector('path').getAttribute('d');
  show({ ...initial, anchor: { x: 195, y: 201 }, vehicle: [21, 91, 371, 311] });
  assert.deepEqual([tt.style.left, tt.style.top], position);
  assert.notEqual(doc.getElementById('part-pointer').querySelector('path').getAttribute('d'), before);
});

test('a new selected part gets its own number and anchor immediately, without a duplicate strip', t => {
  const { doc, tt, ui, show } = tooltipHarness(t);
  show({ partId: 21, anchor: { x: 180, y: 200 }, vehicle: [20, 90, 370, 310], obstacles: [] });
  UI.prototype.selectPart.call(ui, { label: 'WHEEL', desc: 'Wheel description.' });
  assert.equal(doc.getElementById('selected-part').hidden, false);
  assert.equal(doc.getElementById('selected-part').textContent, 'WHEEL · Wheel description.');
  UI.prototype.tooltip.call(ui, -1, -1, 'WHEEL', 'Wheel description.', {
    partId: 28, anchor: { x: 220, y: 240 }, number: 3, vehicle: [20, 90, 370, 310], obstacles: [],
  });
  assert.equal(tt.querySelector('.tt-name').textContent, 'WHEEL');
  const pointer = doc.getElementById('part-pointer');
  assert.equal(pointer.querySelector('text').textContent, '3');
  assert.ok(pointer.querySelector('path').getAttribute('d').startsWith('M 220.0 240.0'));
  UI.prototype.tooltip.call(ui);
  assert.equal(tt.classList.contains('show'), false);
  assert.equal(pointer.classList.contains('show'), false);
});
