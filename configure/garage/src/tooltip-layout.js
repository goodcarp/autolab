// Prefer clear paper next to the numbered badge. If that space is occupied,
// try the vehicle's edges before accepting the least obstructive placement.
export function placePartTooltip({ width, height, cardWidth, cardHeight, pointer, badge, vehicle, obstacles = [] }) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
    * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const pad = 8;
  const cw = Math.min(cardWidth, Math.max(1, width - pad * 2));
  const ch = Math.min(cardHeight, Math.max(1, height - pad * 2));
  const anchor = badge || pointer;
  const box = vehicle?.every(Number.isFinite) && vehicle[0] < vehicle[2] && vehicle[1] < vehicle[3] ? vehicle : null;
  const candidates = [
    [anchor.x + 19, anchor.y - ch / 2], [anchor.x - cw - 19, anchor.y - ch / 2],
    [anchor.x - cw / 2, anchor.y - ch - 19], [anchor.x - cw / 2, anchor.y + 19],
  ];
  if (box) candidates.push(
    [anchor.x - cw / 2, box[1] - ch - 10], [anchor.x - cw / 2, box[3] + 10],
    [box[0] - cw - 10, anchor.y - ch / 2], [box[2] + 10, anchor.y - ch / 2],
  );
  for (const panel of obstacles) candidates.push(
    [anchor.x - cw / 2, panel[1] - ch - 8], [anchor.x - cw / 2, panel[3] + 8],
    [panel[0] - cw - 8, anchor.y - ch / 2], [panel[2] + 8, anchor.y - ch / 2],
  );
  candidates.push([pad, pad], [width - cw - pad, pad], [pad, height - ch - pad], [width - cw - pad, height - ch - pad]);
  const badgeBox = [anchor.x - 15, anchor.y - 15, anchor.x + 15, anchor.y + 15];
  const ranked = candidates.map(([x, y]) => {
    // Score the final, clamped rectangle: an edge adjustment must not move a
    // supposedly clear card back over the car or the number.
    x = clamp(x, pad, Math.max(pad, width - cw - pad));
    y = clamp(y, pad, Math.max(pad, height - ch - pad));
    const rect = [x, y, x + cw, y + ch];
    const blocked = obstacles.reduce((area, panel) => area + overlap(rect, panel), 0);
    const covered = (box ? overlap(rect, box) : 0) + overlap(rect, badgeBox) * 4;
    const edge = { x: clamp(anchor.x, x, x + cw), y: clamp(anchor.y, y, y + ch) };
    return { x, y, edge, blocked, covered, distance: Math.hypot(edge.x - anchor.x, edge.y - anchor.y) };
  }).sort((a, b) => a.blocked - b.blocked || a.covered - b.covered || a.distance - b.distance);
  const best = ranked[0];
  return { x: best.x, y: best.y };
}

// The card stays docked while this line follows the point on the part. Its
// attachment side is chosen once, so small model motion cannot flip the elbow.
export function partTooltipLeader(card, anchor, side) {
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  if (!side) {
    const choices = [
      ['left', { x: card.x, y: clamp(anchor.y, card.y + 12, card.y + card.height - 12) }],
      ['right', { x: card.x + card.width, y: clamp(anchor.y, card.y + 12, card.y + card.height - 12) }],
      ['top', { x: clamp(anchor.x, card.x + 12, card.x + card.width - 12), y: card.y }],
      ['bottom', { x: clamp(anchor.x, card.x + 12, card.x + card.width - 12), y: card.y + card.height }],
    ];
    choices.sort((a, b) => Math.hypot(a[1].x - anchor.x, a[1].y - anchor.y) - Math.hypot(b[1].x - anchor.x, b[1].y - anchor.y));
    side = choices[0][0];
  }
  const horizontal = side === 'left' || side === 'right';
  const edge = horizontal
    ? { x: side === 'left' ? card.x : card.x + card.width, y: card.y + card.height / 2 }
    : { x: card.x + card.width / 2, y: side === 'top' ? card.y : card.y + card.height };
  const elbow = { x: edge.x + (horizontal ? side === 'left' ? -20 : 20 : 0), y: edge.y + (horizontal ? 0 : side === 'top' ? -20 : 20) };
  return { side, edge, elbow, anchor };
}
