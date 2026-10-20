// The run mode's camera: where the drawing is seen from while the Roadster drives. Three ways,
// cycled by C: chase (behind and above the car, riding the curl with it), side (square on from
// the car's right: tracking it on the run-in, the whole curl as a side elevation at the ramp) and
// orbit (round the car, steered by dragging). It hands the
// Rig a free pose (camera.js setFree) and never touches the garage's views.
//
// On the deck the chase camera rides the curve itself: 7.5 m back along the ramp and 2.4 m off
// the riding surface, rolled to the car's own up, so the car stays framed and climbs the screen
// up the wall; over the top of the bend the view rolls half a turn and pulls out past the deck's
// side, so on the overhang the world is the right way up and the car hangs upside down under the
// deck with the drop below it. Off the tip it holds
// still and watches the car drop; on the ground it sits 9 m behind and 2.8 m up. The position,
// the aim and the up vector each ease (exponentially, so the same at any frame rate). A camera that would
// end up behind the deck is pulled back in front of it. Dragging turns the view round the car;
// let go, and chase and side ease back to their own angle (orbit keeps where it was left).
// The logic follows the lab's drive bench (roadster-lab src/benches/drive.js).
import * as THREE from 'three';

export const CAMERA_MODES = ['chase', 'side', 'orbit'];

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DEG = Math.PI / 180;

export function createChaseCamera({ world }) {
  const pos = new THREE.Vector3(), target = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const heading = new THREE.Vector3(1, 0, 0);
  const pose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), fov: 50, near: 0.2, far: 400 };
  const q = new THREE.Quaternion(), o = new THREE.Vector3(), fwd = new THREE.Vector3(), carUp = new THREE.Vector3();
  const want = new THREE.Vector3(), look = new THREE.Vector3(), wantUp = new THREE.Vector3(), tmp = new THREE.Vector3();
  let mode = 'chase', init = false, lastDeck = -1e9, zoom = 1;
  // the drag: an extra turn about the view's up (az) and its side (el), in degrees
  const turn = { az: 0, el: 0, held: false, idle: 0 };

  const ease = (lag, dt) => (lag <= 0 ? 1 : 1 - Math.exp(-dt / lag));

  // The chase camera's up on the deck. Up the curl it is the car's own up, so the car climbs the
  // screen. Over the top of the bend (pitch 115° to 160°) the view rolls half a turn about its
  // own line of sight, so on the overhang the world is the right way up again and the car is
  // seen hanging upside down under the deck. The roll turns the up through the side of the
  // view, never through nothing, so it eases smoothly however fast the car crosses the bend,
  // and off the tip the camera is already upright.
  const side = new THREE.Vector3(), view = new THREE.Vector3();
  function rollUp(out, pitchDeg) {
    const k = THREE.MathUtils.smoothstep(pitchDeg, 115, 160);
    out.copy(carUp);
    if (k <= 0) return out;
    view.subVectors(look, want);
    if (view.lengthSq() < 1e-8) return out;
    view.normalize();
    out.addScaledVector(view, -out.dot(view));
    if (out.lengthSq() < 1e-8) return out.copy(carUp);
    out.normalize();
    side.crossVectors(view, out);
    const a = k * Math.PI;
    return out.multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)).normalize();
  }

  // the ramp's extent in its own plane, frame and tower included (ramp-props.js), for the side view
  const xs = world.ramp.points.map((q) => q[0]), ys = world.ramp.points.map((q) => q[1]);
  const ramp = { x0: Math.min(...xs.filter((x, i) => ys[i] > 0.01 || x >= 0)) - 1, x1: Math.max(...xs) + 4.2, y0: -0.5, y1: Math.max(...ys) + 2.4 };

  function update(s, dt, aspect = 1.6) {
    q.set(...s.quat); o.set(...s.pos);
    fwd.set(1, 0, 0).applyQuaternion(q); carUp.set(0, 1, 0).applyQuaternion(q);
    const fh = tmp.set(fwd.x, 0, fwd.z);
    if (fh.lengthSq() > 0.04) heading.copy(fh.normalize());
    let lag = 0.2, aimLag = 0.08, upLag = 0.3, fov = 50;
    if (mode === 'chase') {
      const sinceDeck = s.t - lastDeck;
      if (s.rampS != null) {
        lastDeck = s.t;
        // Over the top of the bend the camera eases further back, further off the deck and out past
        // its side, so on the overhang the picture holds the car hanging, the deck over it and the
        // drop under it, not just its tail against the hatching.
        const k = THREE.MathUtils.smoothstep(s.pitchDeg, 110, 160);
        const back = (7.5 + 5.5 * k) * zoom, off = (2.4 + 1.8 * k) * zoom;
        const sb = s.rampS - back, [x, y] = world.ramp.at(sb), [nx, ny] = world.ramp.normal(sb);
        want.set(x + nx * off, y + ny * off, o.z * 0.6 + 6.5 * k * zoom);
        look.copy(o).addScaledVector(carUp, 0.7);
        rollUp(wantUp, s.pitchDeg);
      } else if (sinceDeck < 1.2 && s.pos[1] > 3) {
        // off the tip, or off the wall: hold and watch it go, backing away from a car that falls
        // toward the camera (off the wall it drops onto the inside of the curl, where this sits)
        want.copy(pos); wantUp.copy(WORLD_UP); look.copy(o);
        const away = tmp.subVectors(want, o), gap = away.length();
        if (gap < 7) want.copy(o).addScaledVector(gap > 1e-3 ? away.divideScalar(gap) : WORLD_UP, 7);
      } else {
        want.copy(o).addScaledVector(heading, -9 * zoom).addScaledVector(WORLD_UP, 2.8 * zoom);
        wantUp.copy(WORLD_UP); look.copy(o).addScaledVector(WORLD_UP, 0.8);
        if (sinceDeck < 2.5) lag = 0.6;                         // ease out of the hold
      }
    } else if (mode === 'side') {
      fov = 36; wantUp.copy(WORLD_UP); lag = 0.35; aimLag = 0.35;
      // (by where the car is along the run, not how high: a hop 30 m out, or a car flying off the
      // tip toward its landing, is tracked, so it never leaves the picture)
      if (s.onRamp || (o.x > ramp.x0 - 4 && o.x < ramp.x1 + 2)) {
        // at the ramp: the whole curl square on, as a side elevation, whatever the stage's shape
        const half = 1.2 * Math.max((ramp.y1 - ramp.y0) / 2, (ramp.x1 - ramp.x0) / 2 / Math.max(aspect, 0.3));
        look.set((ramp.x0 + ramp.x1) / 2, (ramp.y0 + ramp.y1) / 2, 0);
        want.copy(look).add(tmp.set(0, 0, (half / Math.tan((fov / 2) * DEG)) * zoom));
      } else {
        // on the run-in: square on to the car, tracking it
        look.set(o.x, Math.max(0.8, o.y + 0.4), o.z);
        want.copy(look).add(tmp.set(0, 1.2, 16 * zoom));
        lag = 0.15; aimLag = 0.15;
      }
    } else {
      look.copy(o).addScaledVector(WORLD_UP, 0.6);
      const az = Math.atan2(-heading.z, -heading.x);           // start behind the car
      const el = 18 * DEG, d = 10 * zoom;
      want.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).multiplyScalar(d).add(look);
      wantUp.copy(WORLD_UP); lag = 0.25; aimLag = 0.1; fov = 40;
    }
    if (!init) { pos.copy(want); target.copy(look); up.copy(wantUp); init = true; }
    else {
      pos.lerp(want, ease(lag, dt));
      target.lerp(look, ease(aimLag, dt));
      up.lerp(wantUp, ease(upLag, dt)).normalize();
    }

    // the drag's turn about the car, then let go: chase and side ease back after a moment
    if (!turn.held && mode !== 'orbit') {
      turn.idle += dt;
      if (turn.idle > 0.8) { const k = 1 - ease(0.5, dt); turn.az *= k; turn.el *= k; }
    }
    pose.target.copy(target); pose.up.copy(up);
    pose.pos.copy(pos).sub(target);
    if (turn.az || turn.el) {
      pose.pos.applyAxisAngle(up, turn.az * DEG);
      const side = tmp.crossVectors(pose.pos, up).normalize();
      if (side.lengthSq() > 0.5) pose.pos.applyAxisAngle(side, turn.el * DEG);
    }
    pose.pos.add(target);
    // never behind the deck: a sight line from the car that enters the riding surface is cut short
    const d = tmp.subVectors(pose.pos, pose.target), len = d.length();
    if (len > 1e-6) {
      const hit = world.raycast([pose.target.x, pose.target.y, pose.target.z], [d.x / len, d.y / len, d.z / len], len + 0.6);
      if (hit && hit.surface === 'deck') pose.pos.copy(pose.target).addScaledVector(d, Math.max(0.5, hit.t - 0.6) / len);
    }
    if (pose.pos.y < 0.3) pose.pos.y = 0.3;
    pose.fov = fov;
    return pose;
  }

  return {
    get mode() { return mode; },
    // a new way of looking is a cut, as between drawings: flying across would pass through the frame
    setMode(name) { if (CAMERA_MODES.includes(name) && name !== mode) { mode = name; turn.az = turn.el = 0; init = false; } return mode; },
    next() { return this.setMode(CAMERA_MODES[(CAMERA_MODES.indexOf(mode) + 1) % CAMERA_MODES.length]); },
    reset() { init = false; lastDeck = -1e9; turn.az = turn.el = 0; turn.held = false; },
    update,
    // pointer drag in CSS px: about 0.35 deg a pixel, like the garage's orbit
    drag(dx, dy) { turn.held = true; turn.idle = 0; turn.az -= dx * 0.35; turn.el = Math.max(-60, Math.min(70, turn.el + dy * 0.3)); },
    release() { turn.held = false; turn.idle = 0; },
    zoom(f) { zoom = Math.max(0.6, Math.min(2.5, zoom * f)); return zoom; },
    get turn() { return { az: turn.az, el: turn.el, held: turn.held }; },
  };
}
