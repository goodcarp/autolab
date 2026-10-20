// Synced from roadster-lab 3360319 (src/drive/scripts.js) by tools/sync-garage.mjs.
// Edit it in the lab and re-sync; a hand edit here makes the next sync refuse.
// Scripted drives: input sequences for the drive bench's ?script= and the tests, so a
// headless capture and a test see the same run. A script is { start, duration,
// inputs(state, mem, run) }: inputs gets the run's state after the last step and
// returns the inputs for the next one (mem is a scratch object that lives for the
// drive; run is the createRun() object, for its world).
// Everything depends only on the state, so a scripted drive is deterministic.

import { FT } from './constants.js';
import { clamp } from './math.js';

/** Throttle and brake that hold a forward speed: proportional, plus what the slope takes. */
function cruise(state, target) {
  const e = target - state.forwardSpeed;
  const slope = Math.max(0, Math.sin((state.pitchDeg * Math.PI) / 180)) * 0.65; // 1 g of slope is ~65% of full throttle
  return { throttle: clamp(slope + 0.8 * e, 0, 1), brake: clamp(-0.5 * e, 0, 1) };
}

/**
 * The broadcast's run 2 (docs/RESEARCH-wallride.md §5): fans spooled on the run-in,
 * a full-throttle launch, then about 20 ft/s held up the wall, through the bend and
 * along the overhang, brakes on a few metres from the tip, a hang upside down, then
 * off the tip with the corner jets armed (a tap of hop) to turn the car over and brake
 * the fall. `opts.fans: false` runs the same inputs without the fans.
 */
export function wallride(opts = {}) {
  const fans = opts.fans ?? true;
  const climb = opts.climbSpeed ?? 20 * FT;   // 6.1 m/s up the wall (broadcast: ~20 ft/s)
  const hang = opts.hang ?? 2.5;               // s parked on the overhang before driving off
  const drop = opts.drop ?? true;              // drive off the tip after the hang
  const stopShort = opts.stopShort ?? 3.2;     // brake when the front wheels are this far from the tip (m)
  return {
    name: 'wallride',
    start: { pos: [-8, 0, 0], headingDeg: 0, speed: 0 },
    duration: opts.duration ?? 16,
    inputs(s, m, run) {
      const out = { fans, wing: 'road', steer: 0, boost: false, yawL: false, yawR: false, hop: false };
      if (s.t < 1.5) return { ...out, throttle: 0, brake: 1 };             // spool the fans on the brakes
      if (m.phase == null) m.phase = 'launch';
      if (m.phase === 'launch') {
        if (s.forwardSpeed >= climb) m.phase = 'climb';
        else return { ...out, throttle: 1, brake: 0 };
      }
      if (m.phase === 'climb') {
        if (s.rampS != null && s.rampS >= run.world.sLip - stopShort) { m.phase = 'hang'; m.t0 = s.t; }
        else return { ...out, ...cruise(s, climb) };
      }
      if (m.phase === 'hang') {
        if (drop && s.t - m.t0 >= hang && s.speed < 0.2) m.phase = 'off';
        else return { ...out, throttle: 0, brake: 1 };
      }
      // off the tip: power on to the lip; once in the air, fans off and a tap of hop so
      // the corner jets turn the car over and brake the fall (they stay armed until it
      // is on its wheels); then brake to a stop
      if (s.airborne && m.tapped == null) m.tapped = s.t;
      if (m.tapped == null) return { ...out, throttle: 0.6, brake: 0 };
      return { ...out, fans: false, throttle: 0, brake: s.gas.hop ? 0 : 1, hop: s.t - m.tapped < 0.05 };
    },
  };
}

/**
 * The thruster hop (hop-run.js, the reveal's pillar hop, without the roll): parked,
 * `hop` held for `hold` seconds, a yaw tap each way on the jets near the top, then let
 * go for the landing burn; after it, a short boost on the ground to show the nozzles.
 */
export function hop(opts = {}) {
  const hold = opts.hold ?? 3;
  const t0 = 0.5;
  const yaw = opts.yaw ?? true, boost = opts.boost ?? true;
  return {
    name: 'hop',
    start: { pos: [-30, 0, 0], headingDeg: 0, speed: 0 },
    duration: opts.duration ?? 10.5,
    inputs(s) {
      const t = s.t;
      const out = { fans: false, wing: 'road', steer: 0, throttle: 0, brake: 0, boost: false, yawL: false, yawR: false, hop: t >= t0 && t < t0 + hold };
      if (yaw) { out.yawL = t > t0 + 1.6 && t < t0 + 2.0; out.yawR = t > t0 + 2.2 && t < t0 + 2.6; }
      if (boost && t > t0 + hold + 4 && t < t0 + hold + 4.8) { out.throttle = 0.4; out.boost = true; }
      if (boost && t >= t0 + hold + 4.8) out.brake = 1;
      return out;
    },
  };
}

export const SCRIPTS = { wallride, hop };

/** Drive a run through a script for `seconds` (default the script's duration), calling each(state, mem) after every step (return false to stop). */
export function runScript(run, script, { seconds, each } = {}) {
  const mem = {};
  run.reset(script.start);
  const tEnd = seconds ?? script.duration;
  while (run.state.t < tEnd - 1e-9) {
    run.setInputs(script.inputs(run.state, mem, run));
    run.step();
    if (each && each(run.state, mem) === false) break;
  }
  return run.state;
}
