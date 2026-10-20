// Synced from roadster-lab 3360319 (src/drive/fans.js) by tools/sync-garage.mjs.
// Edit it in the lab and re-sync; a hand edit here makes the next sync refuse.
// The fan-car suction: four fans in the rear bumper pull the air out from under the
// floor, and the drop-down skirts seal it, so the floor is pulled toward whatever
// surface is under it. That is what holds the car on the wall and upside down on the
// overhang.
//
// The fans spool linearly from 0 to full in FANS.spool seconds (sim/wallride.js does
// the same). The pull is FANS.maxKgf at full spool and a full seal, acting at the floor
// centre along the car's -y. The seal is read at the four skirt corners: a ray from each
// along the car's -y finds the gap to the ground or the deck; a corner seals fully while
// its gap is within the ride height plus the skirts' drop, leaks with e^(-excess/falloff)
// past that, and counts for nothing when no surface is within FANS.reach. The pull is
// the full suction times the mean of the four, so it is strong sitting at ride height,
// falls off quickly as the car lifts, and is zero in the air.
//
// The electric power the fans draw is not modelled.

import { G, FANS } from './constants.js';
import { clamp } from './math.js';

/** createFans() → { state, reset, apply(ctx) }. apply(ctx) is the per-step part of car.js extraForces. */
export function createFans() {
  const seal0 = FANS.skirts[0][1] + FANS.skirtDrop; // gap a corner seals at: ride height + skirt drop
  const state = { level: 0, seal: 0, forceN: 0, gaps: FANS.skirts.map(() => null) };

  function reset() { Object.assign(state, { level: 0, seal: 0, forceN: 0, gaps: FANS.skirts.map(() => null) }); }

  /** How well one skirt corner seals, 0..1, for its gap to the surface (null: nothing within reach). */
  function sealOf(gap) {
    if (gap == null) return 0;
    return gap <= seal0 ? 1 : Math.exp(-(gap - seal0) / FANS.falloff);
  }

  function apply(ctx) {
    const { car, dt, inputs } = ctx;
    const target = inputs.fans > 0 ? clamp(inputs.fans, 0, 1) : 0;
    state.level += clamp(target - state.level, -dt / FANS.spool, dt / FANS.spool);
    let seal = 0;
    FANS.skirts.forEach((p, i) => {
      const hit = car.probe(p, [0, -1, 0], FANS.reach);
      state.gaps[i] = hit ? hit.t : null;
      seal += sealOf(state.gaps[i]) / FANS.skirts.length;
    });
    state.seal = seal;
    state.forceN = FANS.maxKgf * G * state.level * seal;
    if (state.forceN > 0) {
      ctx.applyBodyForce([0, -state.forceN, 0], FANS.floor);
      ctx.addDownforce(state.forceN);
    }
  }

  return { state, reset, apply, sealOf };
}
