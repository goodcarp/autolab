import test from 'node:test';
import assert from 'node:assert/strict';
import { placePartTooltip, partTooltipLeader } from './tooltip-layout.js';

const intersects = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const rectangle = (placed, width, height) => [placed.x, placed.y, placed.x + width, placed.y + height];

test('a 320px phone parks the card on clear paper beside its numbered badge', () => {
  const vehicle = [24, 100, 296, 240];
  const badge = { x: 35, y: 60 };
  const placed = placePartTooltip({ width: 320, height: 350, cardWidth: 176, cardHeight: 60,
    pointer: { x: 100, y: 150 }, badge, vehicle });
  assert.equal(intersects(rectangle(placed, 176, 60), vehicle), false);
  assert.equal(intersects(rectangle(placed, 176, 60), [22, 47, 48, 73]), false);
  assert.ok(Math.hypot(placed.x - badge.x, placed.y + 30 - badge.y) < 40);
});

test('a visible panel wins over the nearest badge position', () => {
  const vehicle = [18, 130, 302, 280];
  const panel = [0, 0, 320, 90];
  const placed = placePartTooltip({ width: 320, height: 390, cardWidth: 176, cardHeight: 64,
    pointer: { x: 140, y: 200 }, badge: { x: 35, y: 105 }, vehicle, obstacles: [panel] });
  assert.equal(intersects(rectangle(placed, 176, 64), panel), false);
  assert.equal(intersects(rectangle(placed, 176, 64), vehicle), false);
});

test('cards stay within phone and landscape stages for badges at every edge', () => {
  for (const [width, height] of [[320, 350], [390, 280], [740, 230]]) {
    for (const badge of [{ x: 5, y: 5 }, { x: width - 5, y: 5 },
      { x: 5, y: height - 5 }, { x: width - 5, y: height - 5 }]) {
      const placed = placePartTooltip({ width, height, cardWidth: 176, cardHeight: 76,
        pointer: badge, badge, vehicle: [40, 80, width - 40, height - 65] });
      assert.ok(placed.x >= 8 && placed.y >= 8);
      assert.ok(placed.x + 176 <= width - 8 && placed.y + 76 <= height - 8);
    }
  }
});

test('without a numbered annotation the card still clears the vehicle', () => {
  const vehicle = [30, 110, 290, 240];
  const placed = placePartTooltip({ width: 320, height: 350, cardWidth: 176, cardHeight: 68,
    pointer: { x: 140, y: 150 }, vehicle });
  assert.equal(intersects(rectangle(placed, 176, 68), vehicle), false);
});

test('an unnumbered part gets a pointer and its attachment side remains stable', () => {
  const card = { x: 8, y: 8, width: 176, height: 68 };
  const first = partTooltipLeader(card, { x: 250, y: 120 });
  const moved = partTooltipLeader(card, { x: 249, y: 121 }, first.side);
  assert.deepEqual(moved.edge, first.edge);
  assert.deepEqual(moved.elbow, first.elbow);
  assert.notDeepEqual(moved.anchor, first.anchor);
});

test('a vehicle filling the stage keeps the card bounded even when no clear area exists', () => {
  const placed = placePartTooltip({ width: 320, height: 230, cardWidth: 176, cardHeight: 84,
    pointer: { x: 300, y: 200 }, badge: { x: 290, y: 190 }, vehicle: [-100, -60, 440, 350] });
  assert.ok(placed.x >= 8 && placed.y >= 8);
  assert.ok(placed.x + 176 <= 312 && placed.y + 84 <= 222);
});

test('desktop cards cannot dock beneath Reset or the annotation toggle even when the car fills most of the stage', () => {
  const obstacles = [[960, 28, 1084, 104], [1066, 36, 1126, 94], [36, 36, 400, 116]];
  const placed = placePartTooltip({ width: 1160, height: 789, cardWidth: 280, cardHeight: 62,
    pointer: { x: 980, y: 180 }, vehicle: [30, 120, 1130, 755], obstacles });
  for (const obstacle of obstacles) assert.equal(intersects(rectangle(placed, 280, 62), obstacle), false);
});
