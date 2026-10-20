import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const threeUrl = new URL('../../universal-vehicle-configurator/node_modules/three/build/three.module.js', import.meta.url).href;
const { Vector3, Mesh, BoxGeometry, Group } = await import(threeUrl);
const source = (await readFile(new URL('./overlay.js', import.meta.url), 'utf8'))
  .replace("from 'three'", `from '${threeUrl}'`)
  .replace("from './config.js'", `from '${new URL('./config.js', import.meta.url).href}'`);
const { Overlay, clearOfBadges } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function anchorHarness(t) {
  const panels = new Map();
  for (const [name, value] of Object.entries({ document: { getElementById: id => panels.get(id) },
    getComputedStyle: el => ({ opacity: '1', visibility: 'visible', display: 'block', ...el.style }) })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => { if (old) Object.defineProperty(globalThis, name, old); else delete globalThis[name]; });
  }
  const overlay = Object.create(Overlay.prototype);
  Object.assign(overlay, { w: 667, h: 700, view: 'top', callouts: [], tooltipLayout: { vehicle: [30, 120, 630, 560] },
    rig: { project: v => ({ x: v.x * 10, y: v.y * 10, behind: false }) },
    svg: { getBoundingClientRect: () => ({ left: 10, top: 20 }) } });
  const group = new Group(), mesh = new Mesh(new BoxGeometry(2, 2, 2));
  group.add(mesh); mesh.position.set(2, 3, 4); group.updateMatrixWorld(true);
  const part = { id: 31, name: 'wheelFR', meshes: [mesh], group, rest: new Vector3(), anchor: null };
  return { overlay, part, mesh, group, panels };
}

test('an unnumbered part keeps one geometry anchor across different hits and tracks part transforms', t => {
  const { overlay, part, mesh, group } = anchorHarness(t);
  const otherMesh = new Mesh(new BoxGeometry(1, 1, 1));
  otherMesh.position.set(8, 9, 10); group.add(otherMesh); part.meshes.push(otherMesh);
  group.updateMatrixWorld(true);
  const first = overlay.partTooltip(part, { object: mesh, point: new Vector3(1, 2, 0) });
  assert.deepEqual(first.anchor, { x: 20, y: 30, behind: false });
  assert.equal(first.number, null);
  assert.deepEqual(overlay.partTooltip(part, { object: otherMesh, point: new Vector3(-1, -2, 1) }).anchor, first.anchor);
  mesh.visible = false;
  assert.deepEqual(overlay.partTooltip(part).anchor, first.anchor);
  group.position.set(1, 2, 0); group.updateMatrixWorld(true);
  assert.deepEqual(overlay.partTooltip(part).anchor, { x: 30, y: 50, behind: false });
});

test('authored anchors override every mouse hit and follow opening/exploding transforms', t => {
  const { overlay, part, mesh, group } = anchorHarness(t);
  overlay.callouts = [{ part, n: 3 }];
  part.anchor = new Vector3(6, 5, 4); part.rest.set(2, 1, 0);
  const layout = overlay.partTooltip(part, { object: mesh, point: new Vector3(20, 30, 40) });
  assert.deepEqual(layout.anchor, { x: 40, y: 40, behind: false });
  assert.equal(layout.number, 3);
  assert.deepEqual(overlay.partTooltip(part, { object: mesh, point: new Vector3(-20, -30, -40) }).anchor, layout.anchor);
  assert.deepEqual(overlay.partTooltip(part).anchor, layout.anchor);
  group.position.set(1, 2, 0); group.rotation.z = Math.PI / 2; group.updateMatrixWorld(true);
  const transformed = overlay.partTooltip(part).anchor;
  assert.ok(Math.abs(transformed.x + 30) < 1e-8);
  assert.ok(Math.abs(transformed.y - 60) < 1e-8);
  part.anchorLocal = true;
  const local = overlay.partTooltip(part).anchor;
  assert.ok(Math.abs(local.x + 40) < 1e-8);
  assert.ok(Math.abs(local.y - 80) < 1e-8);
});

test('newly opened action and agent trays affect the first inspector frame', t => {
  const { overlay, part, panels } = anchorHarness(t);
  assert.deepEqual(overlay.partTooltip(part).obstacles, []);
  panels.set('compact-sheet', { getBoundingClientRect: () => ({ left: 20, top: 500, right: 650, bottom: 700, width: 630, height: 200 }) });
  panels.set('agent-tools', { getBoundingClientRect: () => ({ left: 400, top: 40, right: 660, bottom: 400, width: 260, height: 360 }) });
  assert.deepEqual(overlay.partTooltip(part).obstacles, [[-6, 464, 656, 696], [374, 4, 666, 396]]);
  panels.clear();
  assert.deepEqual(overlay.partTooltip(part).obstacles, []);
});

test('desktop Reset and annotation controls are excluded, respecting hidden ancestors', t => {
  const { overlay, part, panels } = anchorHarness(t);
  overlay.w = 1160; overlay.h = 789;
  const parent = { style: { opacity: '1' } };
  const control = { parentElement: parent, getBoundingClientRect: () => ({ left: 976, top: 44, right: 1068, bottom: 88, width: 92, height: 44 }) };
  panels.set('primary-controls', control);
  panels.set('cards-toggle', { getBoundingClientRect: () => ({ left: 1082, top: 52, right: 1110, bottom: 78, width: 28, height: 26 }) });
  assert.equal(overlay.partTooltip(part).obstacles.length, 2);
  parent.style.opacity = '0';
  assert.equal(overlay.partTooltip(part).obstacles.length, 1);
  parent.style.opacity = '1'; parent.style.display = 'none';
  assert.equal(overlay.partTooltip(part).obstacles.length, 1);
});

test('panel translation does not perturb the dock until an explicit panel or viewport change', t => {
  const { overlay, part, panels } = anchorHarness(t);
  let top = 100;
  const panel = { className: '', offsetWidth: 200, offsetHeight: 60,
    getBoundingClientRect: () => ({ left: 20, top, right: 220, bottom: top + 60, width: 200, height: 60 }) };
  panels.set('primary-controls', panel);
  const first = overlay.partTooltip(part).obstacles;
  top += 1;
  assert.deepEqual(overlay.partTooltip(part).obstacles, first);
  panel.className = 'open';
  assert.notDeepEqual(overlay.partTooltip(part).obstacles, first);
  const opened = overlay.partTooltip(part).obstacles;
  top += 1; overlay.w += 1;
  assert.notDeepEqual(overlay.partTooltip(part).obstacles, opened);
});

test('a callout badge that lands on an earlier one steps clear of it, inside the badge area', () => {
  const box = [30, 70, 1000, 600];
  const apart = ([ax, ay], [bx, by]) => Math.hypot(ax - bx, ay - by) >= 30 - 1e-9;
  // a badge clear of the others stays where it was put
  assert.deepEqual(clearOfBadges([[100, 100]], 300, 300, box), [300, 300]);
  // on top of another: it moves straight away from it, to just clear of it
  const [x, y] = clearOfBadges([[500, 300]], 510, 300, box);
  assert.deepEqual([Math.round(x), Math.round(y)], [531, 300]);
  // exactly on another: it steps sideways, toward the middle of the area
  assert.deepEqual(clearOfBadges([[100, 300]], 100, 300, box).map(Math.round), [131, 300]);
  // pinned at the area's bottom edge below another: the edge stops a step down, so it goes to a side
  const pinned = clearOfBadges([[500, 600]], 500, 600, box);
  assert.ok(apart(pinned, [500, 600]) && pinned[1] <= 600 && pinned[1] >= 70, String(pinned));
  // a panel beside it: the step that would land on the panel is passed over
  const panel = [[520, 250, 700, 350]];
  const beside = clearOfBadges([[500, 300]], 510, 300, box, panel);
  assert.ok(apart(beside, [500, 300]) && !(beside[0] > 520 && beside[1] > 250 && beside[1] < 350), String(beside));
  // pinned under a panel that covers every nearby spot: still clear of the other badge
  const under = clearOfBadges([[493, 70]], 499, 70, [30, 70, 996, 610], [[-1, 61, 653, 177]]);
  assert.ok(apart(under, [493, 70]), String(under));
  // a crowd: every badge ends clear of every earlier one
  const placed = [];
  for (const [px, py] of [[400, 200], [405, 200], [400, 205], [410, 210], [400, 200]]) placed.push(clearOfBadges(placed, px, py, box));
  for (let i = 0; i < placed.length; i++) for (let j = 0; j < i; j++) assert.ok(apart(placed[i], placed[j]), `${i}/${j}`);
});
