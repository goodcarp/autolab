// Synced from roadster-lab 3360319 (src/drive/thrust.js) by tools/sync-garage.mjs.
// Edit it in the lab and re-sync; a hand edit here makes the next sync refuse.
// The cold-gas system: one nitrogen tank (the COPVs) feeding ten jets.
//
//   hover   the four corner jets under the car (anchors.hoverJets, keys fl fr rl rr):
//           gas down the car's -y, thrust up its +y. `hop` fires them through a small
//           autopilot: an attitude hold that keeps the car level, a climb toward
//           THRUST.hop.ceiling, and, once `hop` is let go with the car still in the air,
//           a landing burn (the same constant-deceleration law as hop-run.js). While it
//           flies, the side jets hold the car's heading unless the driver is yawing.
//   front   the two side jets on the nose corners (anchors.frontJets, frontL frontR):
//           gas outward, thrust inward, so either one alone yaws the car. `yawL` fires
//           the right-hand jet, whose thrust pushes the nose left; `yawR` the left one.
//   nozzle  the four gold nozzles above the diffuser (anchors.nozzles, nozzle0..3):
//           gas out of the back, thrust along +x. They sit at 0.47 m, just above the
//           centre of mass (0.46 m), so `boost` also leans the nose down a little.
//
// The tank holds THRUST.gas0 kg at THRUST.psi0. There is no regulator: each jet's
// thrust is its valve opening times its full-pressure thrust times P/psi0, and the
// pressure falls with the gas left (P = psi0·(gas/gas0)^n). The gas leaves at the
// exhaust velocity, so the mass flow is the total thrust over THRUST.ve, and the car
// gets lighter as it goes. Below THRUST.psiMin the tank counts as spent.
//
// Jet keys are the ones src/fx/jets.js update() takes, so levels() can drive it.

import { G, MASS, THRUST } from './constants.js';
import { clamp, cross, length, scale, matTVec, quatFromMat } from './math.js';

const transpose = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const matMul = (a, b) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j]));

const keyHover = (p) => (p[0] > 0 ? 'f' : 'r') + (p[2] > 0 ? 'r' : 'l');

/** Tank pressure (psi) for a gas mass. */
export function tankPsi(gas) {
  return THRUST.psi0 * Math.pow(Math.max(0, gas) / THRUST.gas0, THRUST.blowdown);
}

/** Gas left (kg) when the tank reaches THRUST.psiMin: what can never be used. */
export const GAS_RESERVE = THRUST.gas0 * Math.pow(THRUST.psiMin / THRUST.psi0, 1 / THRUST.blowdown);

/**
 * createThrusters({ gas }) → { jets, tank, hop, reset, apply(ctx), states(car), levels() }.
 * gas is the fill in kg (default THRUST.gas0, a full tank). apply(ctx) is the per-step
 * part of car.js extraForces (ctx as there).
 */
export function createThrusters({ gas: fill = THRUST.gas0 } = {}) {
  const jets = [
    ...THRUST.hoverJets.map((p) => ({ name: keyHover(p), kind: 'hover', p, thrust: [0, 1, 0], fmax: THRUST.corner })),
    ...THRUST.frontJets.map((p) => ({ name: p[2] > 0 ? 'frontR' : 'frontL', kind: 'front', p, thrust: [0, 0, p[2] > 0 ? -1 : 1], fmax: THRUST.side })),
    ...THRUST.nozzles.map((p, i) => ({ name: 'nozzle' + i, kind: 'nozzle', p, thrust: [1, 0, 0], fmax: THRUST.rearTotal / THRUST.nozzles.length })),
  ];
  for (const j of jets) Object.assign(j, { cmd: 0, open: 0, force: 0, level: 0 });
  const byName = Object.fromEntries(jets.map((j) => [j.name, j]));
  const hover = ['fl', 'fr', 'rl', 'rr'].map((k) => byName[k]);

  // Lever arms of the corner jets about the centre of mass (car frame).
  const cg = MASS.cg;
  const xf = (byName.fl.p[0] + byName.fr.p[0]) / 2 - cg[0];
  const xr = (byName.rl.p[0] + byName.rr.p[0]) / 2 - cg[0];
  const zh = hover.reduce((m, j) => m + Math.abs(j.p[2]), 0) / 4;

  const tank = {};
  // armed: the autopilot is flying the corner jets (from a press of `hop` until the
  // car is back on its wheels); burn: the landing burn has engaged; h: height of the
  // car's origin above the surface under its centre of mass; heading: the one it holds.
  const hop = { armed: false, burn: false, h: 0, lift: 0, heading: null };

  function reset() {
    for (const j of jets) { j.cmd = 0; j.open = 0; j.force = 0; j.level = 0; }
    const psi = tankPsi(fill);
    Object.assign(tank, { gas: fill, psi, ratio: psi / THRUST.psi0, empty: psi < THRUST.psiMin, flow: 0, thrustN: 0, impulse: 0 });
    Object.assign(hop, { armed: false, burn: false, h: 0, lift: 0, heading: null });
  }
  reset();

  /**
   * Corner-jet forces (N, before the pressure limit) for a total lift L along the car's
   * +y and a roll and pitch torque (car frame, N·m) about the centre of mass. The lift
   * is split between the axles to give the pitch torque, and across each axle to give
   * the roll torque. The jets can only push, so L is raised to what the torques need.
   */
  function allocate(L, tx, tz) {
    L = Math.max(L, Math.abs(tx) / zh, tz > 0 ? tz / xf : tz / xr, 0);
    if (L <= 0) return [0, 0, 0, 0];
    const Ff = (tz - xr * L) / (xf - xr), Fr = L - Ff;
    // a force f up at (x, z) gives torque (-z·f, 0, x·f): the right side up rolls -x
    const D = -tx / zh;
    const Df = (D * Ff) / L, Dr = (D * Fr) / L;
    return [(Ff - Df) / 2, (Ff + Df) / 2, (Fr - Dr) / 2, (Fr + Dr) / 2]; // fl fr rl rr
  }

  /**
   * allocate() within each jet's limit `cap` (N): when the lift asked for is more than
   * the jets can give, give up lift and keep the torques (the attitude comes first);
   * when even the torques are too much, scale them down together.
   */
  function allocateWithin(L, tx, tz, cap) {
    const most = (f) => Math.max(f[0], f[1], f[2], f[3]);
    let f = allocate(L, tx, tz);
    if (most(f) <= cap) return f;
    const f0 = allocate(0, tx, tz);
    if (most(f0) >= cap) return f0.map((v) => (v * cap) / most(f0));
    let lo = 0, hi = L;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (most(allocate(m, tx, tz)) > cap) hi = m; else lo = m; }
    return allocate(lo, tx, tz);
  }

  /** The hop autopilot: corner-jet forces for this step, or null when it is off. r is P/psi0. */
  function autopilot(car, world, inputs, r) {
    const P = THRUST.hop;
    const hold = inputs.hop > 0;
    const onWheels = car.wheels.filter((w) => w.hit).length >= 3;
    if (hold) hop.armed = true;
    else if (onWheels) { hop.armed = false; hop.burn = false; hop.heading = null; }
    if (!hop.armed || tank.empty) return null;

    const R = car.R, up = [R[1], R[4], R[7]];
    const hit = world.raycast(car.pos, [0, -1, 0], 80);
    const h = (hop.h = hit ? hit.t - car.cg[1] : 80);
    const vy = car.vel[1];
    let lift = 0;
    if (hold) {
      // climb toward the ceiling at up to `climb` m/s, braking at 0.8 g to arrive there
      // at rest; on the braking part the profile's own deceleration is fed forward
      const d = P.ceiling - h, ab = 0.8 * G, vb = Math.sqrt(2 * ab * Math.abs(d));
      const vt = Math.sign(d) * Math.min(P.climb, vb), ff = vb < P.climb ? -Math.sign(d) * ab : 0;
      lift = car.mass * (G + clamp(ff + P.kv * (vt - vy), -G, P.accelG * G));
      hop.burn = false;
    } else if (vy < 0) {
      // let go: fall freely until a constant-deceleration burn to vTouch is needed, at
      // landG or at 60% of what the jets can still give level at this pressure (it
      // falls during the burn); the wheels, hanging at full droop, touch at h ≈ 0.08 m.
      // The rear pair carries more of the lift (the centre of mass is behind the middle),
      // so they reach their limit first.
      const aReq = (vy * vy - P.vTouch * P.vTouch) / (2 * Math.max(h - 0.08, 0.05));
      const aCan = (2 * THRUST.corner * r * (xf - xr)) / Math.max(xf, -xr) / car.mass - G;
      if (!hop.burn && aReq > 0 && aReq >= Math.min(P.landG * G, 0.6 * aCan)) hop.burn = true;
      if (hop.burn) lift = car.mass * (G + Math.max(0, aReq));
    }
    // tilted, the jets need more thrust for the same lift; upside down they give none
    lift = up[1] > 0.2 ? lift / Math.max(0.5, up[1]) : 0;
    hop.lift = lift;

    // Attitude hold: turn the car level, keeping the way its nose points. Upside down
    // that is a roll about the long axis (its easiest axis, 600 against 2,800 kg·m² in
    // pitch), as the reveal's car turned over. With the nose near vertical there is no
    // heading to keep, so the car's up is simply swung to the world's up. The error is
    // that rotation (axis × angle) in the car frame; the corner jets act on its roll and
    // pitch parts (yaw is the side jets' job, in apply()).
    const nose = [R[0], R[3], R[6]], lh = Math.hypot(nose[0], nose[2]);
    let eW;
    if (lh > 0.2) {
      const x = [nose[0] / lh, 0, nose[2] / lh], z = [-x[2], 0, x[0]];
      const Rt = [x[0], 0, z[0], x[1], 1, z[1], x[2], 0, z[2]];
      const q = quatFromMat(matMul(Rt, transpose(R)));
      const sv = Math.hypot(q[0], q[1], q[2]);
      eW = sv > 1e-9 ? scale([q[0], q[1], q[2]], (2 * Math.atan2(sv, q[3])) / sv) : [0, 0, 0];
    } else {
      const ax = cross(up, [0, 1, 0]), s = length(ax);
      eW = s > 1e-9 ? scale(ax, Math.atan2(s, up[1]) / s) : [0, 0, 0];
    }
    const e = matTVec(R, eW), w = matTVec(R, car.angVel), I = car.inertia;
    const k = P.omega * P.omega, c = 2 * P.zeta * P.omega;
    return allocateWithin(lift, I[0] * (k * e[0] - c * w[0]), I[2] * (k * e[2] - c * w[2]), THRUST.corner * r);
  }

  /** One step: commands, valves, forces at the jets, gas spent, the car's new mass. */
  function apply(ctx) {
    const { car, world, dt, inputs } = ctx;
    const r = tank.ratio;
    const want = autopilot(car, world, inputs, r);
    hover.forEach((j, i) => { j.cmd = want && r > 0 ? clamp(want[i] / (j.fmax * r), 0, 1) : 0; });
    byName.frontR.cmd = inputs.yawL > 0 ? 1 : 0;
    byName.frontL.cmd = inputs.yawR > 0 ? 1 : 0;
    // While the autopilot flies, the side jets hold the heading it took over with (or
    // the one the driver last yawed to), since the corner jets cannot turn the car
    // about its own up axis: the reveal's car lit its nose markers during the fall
    // (docs/RESEARCH-wallride.md). With the nose near vertical they only damp the spin.
    const userYaw = inputs.yawL > 0 || inputs.yawR > 0;
    if (want && r > 0) {
      const R = car.R, lh = Math.hypot(R[0], R[6]);
      const heading = lh > 0.3 ? Math.atan2(-R[6], R[0]) : null; // + = nose left, as run.js headingDeg
      if (userYaw || hop.heading == null) hop.heading = heading;
      if (!userYaw) {
        const P = THRUST.hop, Iy = car.inertia[1];
        let tq = -Iy * 2 * P.zeta * P.omega * matTVec(R, car.angVel)[1]; // + turns the nose left
        if (hop.heading != null && heading != null) {
          let e = hop.heading - heading;
          e -= 2 * Math.PI * Math.round(e / (2 * Math.PI));
          tq += Iy * P.omega * P.omega * e;
        }
        const j = tq > 0 ? byName.frontR : byName.frontL;
        j.cmd = clamp(Math.abs(tq) / (Math.abs(j.p[0] - MASS.cg[0]) * j.fmax * r), 0, 1);
      }
    }
    for (let i = 0; i < THRUST.nozzles.length; i++) byName['nozzle' + i].cmd = inputs.boost > 0 ? clamp(inputs.boost, 0, 1) : 0;

    const kv = 1 - Math.exp(-dt / THRUST.valveTau);
    let total = 0;
    for (const j of jets) {
      j.open += (j.cmd - j.open) * kv;
      if (j.open < 1e-6 && j.cmd === 0) j.open = 0;
      j.force = tank.empty ? 0 : j.open * j.fmax * r;
      j.level = j.force / j.fmax;
      if (j.force > 0) ctx.applyBodyForce(scale(j.thrust, j.force), j.p);
      total += j.force;
    }
    tank.thrustN = total;
    tank.flow = total / THRUST.ve;
    tank.impulse += total * dt;
    if (total > 0) {
      tank.gas = Math.max(0, tank.gas - tank.flow * dt);
      tank.psi = tankPsi(tank.gas);
      tank.empty = tank.psi < THRUST.psiMin;
      tank.ratio = tank.empty ? 0 : tank.psi / THRUST.psi0;
      car.setMassProps({ mass: MASS.dry + tank.gas });
    }
  }

  /** Per-jet state for rendering: { name, kind, on, level 0..1, pos (world), dir (world, the gas's direction) }. */
  function states(car) {
    return jets.map((j) => ({
      name: j.name, kind: j.kind, on: j.level > 0.01, level: j.level,
      pos: car.toWorld(j.p), dir: car.dirToWorld(scale(j.thrust, -1)),
    }));
  }

  /** { fl, fr, …, nozzle3 } levels: what src/fx/jets.js update() takes. */
  function levels() { return Object.fromEntries(jets.map((j) => [j.name, j.level])); }

  return { jets, byName, tank, hop, reset, apply, states, levels, allocate };
}
