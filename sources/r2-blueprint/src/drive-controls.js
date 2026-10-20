// What the driver's keys and the touch pad mean in a run, and how they become the drive's inputs.
// No physics and no three.js here: run-mode.js listens, this maps.
//
// Keys (by e.code, so they sit in the same place on every layout):
//   W / ↑ go (throttle); S / ↓ brake, and held at a standstill, reverse; A / ← and D / → steer;
//   Shift boost (the rear nozzles); Space hop (the corner jets); Q / E yaw jets nose left / right
//   (all held); F fans on/off; 1 2 3 wing road / low drag / high downforce; R retry;
//   C next camera; Esc stop the run.
// The touch pad (compact sheets) has the same held actions as press-and-hold buttons, FANS as a
// toggle, RETRY, and the tray's PLAY button as STOP. Each button follows its own pointers, so
// GO and steering can be held with two thumbs at once.

export const KEYS = Object.freeze({
  KeyW: 'go', ArrowUp: 'go', KeyS: 'brake', ArrowDown: 'brake',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'boost', ShiftRight: 'boost', Space: 'hop', KeyQ: 'yawL', KeyE: 'yawR',
  KeyF: 'fans', Digit1: 'wing:road', Digit2: 'wing:lowDrag', Digit3: 'wing:highDownforce',
  Numpad1: 'wing:road', Numpad2: 'wing:lowDrag', Numpad3: 'wing:highDownforce',
  KeyR: 'retry', KeyC: 'camera', Escape: 'stop',
});
// Actions that last as long as the key or button is held; the rest happen once per press.
export const HELD = Object.freeze(['go', 'brake', 'left', 'right', 'boost', 'hop', 'yawL', 'yawR']);
// Pressing any of these while the autopilot drives takes the car back.
export const DRIVING = Object.freeze([...HELD, 'fans', 'wing:road', 'wing:lowDrag', 'wing:highDownforce']);
export const WINGS = Object.freeze(['road', 'lowDrag', 'highDownforce']);

/** The action a key press means in a run, or null (Escape also arrives as e.key on some keyboards). */
export function keyAction(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  return KEYS[e.code] ?? (e.key === 'Escape' ? 'stop' : null);
}

/**
 * The drive's inputs (rd/drive/run.js setInputs) from what is held now (a Set of HELD actions),
 * what an agent holds (set_drive_inputs: throttle, brake, steer, boost, hop, yawL, yawR) and the
 * latched settings (fans, wing). A held pedal or steering key overrides the agent's value for
 * that axis; a held jet adds to it. Brake held at (nearly) a standstill reverses, as in the lab.
 */
export function composeInputs({ held, agent = {}, latch = {}, forwardSpeed = 0 }) {
  const has = (a) => held.has(a);
  const go = has('go'), back = has('brake'), left = has('left'), right = has('right');
  const stopped = forwardSpeed < 0.5;
  const pedals = go || back, steering = left || right;
  return {
    throttle: pedals ? (go ? 1 : back && stopped ? -1 : 0) : agent.throttle ?? 0,
    brake: pedals ? (back && !stopped ? 1 : 0) : agent.brake ?? 0,
    steer: steering ? (right ? 1 : 0) - (left ? 1 : 0) : agent.steer ?? 0,
    boost: has('boost') || !!agent.boost,
    hop: has('hop') || !!agent.hop,
    yawL: has('yawL') || !!agent.yawL,
    yawR: has('yawR') || !!agent.yawR,
    fans: !!latch.fans,
    wing: WINGS.includes(latch.wing) ? latch.wing : 'road',
  };
}

// The touch pad, in the order its grid places it: a top row of systems and the bottom row the
// thumbs live on (steer under the left thumb, BRAKE and a wide GO under the right).
export const PAD = Object.freeze([
  { action: 'fans', label: 'FANS', kind: 'toggle', title: 'Fans on or off (F)' },
  { action: 'hop', label: 'HOP', kind: 'hold', title: 'Hop on the corner jets (hold Space)' },
  { action: 'boost', label: 'BOOST', kind: 'hold', title: 'Boost on the rear nozzles (hold Shift)' },
  { action: 'retry', label: 'RETRY', kind: 'tap', title: 'Restart the run (R)' },
  { action: 'left', label: '◀', kind: 'hold', title: 'Steer left (A)', aria: 'Steer left' },
  { action: 'right', label: '▶', kind: 'hold', title: 'Steer right (D)', aria: 'Steer right' },
  { action: 'brake', label: 'BRAKE', kind: 'hold', title: 'Brake; at a standstill, reverse (S)' },
  { action: 'go', label: 'GO', kind: 'hold', title: 'Throttle (W)' },
]);

// The wide sheet's key legend, two columns of key and what it does.
export const LEGEND = Object.freeze([
  ['W S', 'GO · BRAKE'], ['A D', 'STEER'], ['SHIFT', 'BOOST'], ['SPACE', 'HOP'], ['Q E', 'YAW JETS'],
  ['F', 'FANS'], ['1 2 3', 'WING'], ['C', 'CAMERA'], ['R', 'RETRY'], ['ESC', 'STOP'],
]);

/**
 * The touch pad's buttons, added to `container` (the tray) before `before` (its STOP button).
 * onPress(action, down) is called for each held button going down or up, and once (down) for a
 * toggle or a tap. Returns { buttons, setPressed(action, on), releaseAll(), dispose() }; every
 * listener goes with the signal or with dispose().
 */
export function createDrivePad({ container, before = null, onPress, signal }) {
  const doc = container.ownerDocument;
  const wrap = doc.createElement('div');
  wrap.id = 'drive-pad'; wrap.className = 'drive-pad';
  wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', 'Drive controls');
  const ac = new (doc.defaultView?.AbortController ?? AbortController)();
  const opts = { signal: ac.signal };
  signal?.addEventListener('abort', () => ac.abort(), { once: true });
  const buttons = {}, letGo = [];
  for (const b of PAD) {
    const el = doc.createElement('button');
    el.type = 'button'; el.className = `btn drive-btn drive-${b.action}`; el.dataset.drive = b.action;
    el.textContent = b.label; el.title = b.title;
    if (b.aria) el.setAttribute('aria-label', b.aria);
    if (b.kind !== 'tap') el.setAttribute('aria-pressed', 'false');
    buttons[b.action] = el;
    const pointers = new Set();
    const release = (e) => {
      if (!pointers.delete(e.pointerId)) return;
      if (b.kind === 'hold' && pointers.size === 0) { el.classList.remove('held'); el.setAttribute('aria-pressed', 'false'); onPress(b.action, false); }
      if (b.kind === 'tap' && e.type === 'pointerup') onPress(b.action, true);
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();   // no focus, no text selection, no emulated mouse: the button keeps no keyboard focus
      try { el.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
      const first = pointers.size === 0;
      pointers.add(e.pointerId);
      if (b.kind === 'hold' && first) { el.classList.add('held'); el.setAttribute('aria-pressed', 'true'); onPress(b.action, true); }
      if (b.kind === 'toggle') onPress(b.action, true);
    }, opts);
    for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) el.addEventListener(type, release, opts);
    // every pointer at once, as if each had lifted (the window lost focus mid-press)
    letGo.push(() => {
      if (!pointers.size) return;
      for (const id of pointers) { try { el.releasePointerCapture(id); } catch { /* already gone */ } }
      pointers.clear();
      if (b.kind === 'hold') { el.classList.remove('held'); el.setAttribute('aria-pressed', 'false'); onPress(b.action, false); }
    });
    // keyboard activation (Enter or Space on a focused button arrives as a click with no detail)
    el.addEventListener('click', (e) => {
      if (e.detail !== 0) return;
      if (b.kind === 'hold') { onPress(b.action, true); setTimeout(() => onPress(b.action, false), 250); } else onPress(b.action, true);
    }, opts);
    wrap.append(el);
  }
  wrap.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
  container.insertBefore(wrap, before);
  return {
    el: wrap, buttons,
    setPressed(action, on) {
      const el = buttons[action]; if (!el) return;
      el.classList.toggle('toggled', !!on); el.setAttribute('aria-pressed', String(!!on));
    },
    /** Let go of every held button (the page lost focus, so their pointers' ups may never come). */
    releaseAll() { for (const f of letGo) f(); },
    dispose() { ac.abort(); wrap.remove(); },
  };
}
