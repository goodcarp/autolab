// Synced from roadster-lab 3360319 (src/drive/run.js) by tools/sync-garage.mjs.
// Edit it in the lab and re-sync; a hand edit here makes the next sync refuse.
// A drive: the world, the car, a fixed-step clock and what the HUD shows.
//
//   const run = createRun();            // on the run-in, 50 m before the foot, at rest
//   run.setInputs({ throttle: 1 });     // from keys or touch, any time
//   run.advance(realDt);                // once per animation frame
//   run.state                           // pose, HUD figures, wheels, outcome
//
// advance() runs as many fixed 1/240 s steps as the real time covers (at most
// SIM.maxSteps per call; a longer backlog is dropped, so a slow machine runs slow
// rather than falling further behind). The same inputs at the same steps give the
// same states, bit for bit.
//
// state.pos and state.quat are the car-frame origin and orientation: copy them onto
// the vehicle's root. state.wheels[i].spin and .compression drive the wheel meshes
// (spin is rotation.z of the spinning part, compression the lift of the wheel
// centre along the car's y), and state.steerDeg is what vehicle.update(dt, { steer })
// expects (degrees about +y, + = left). rampS is arc length along the ramp profile
// (world.ramp.at(rampS) is the point; the foot is world.sFoot, the lip world.sLip).
//
// outcome: 'crashed' once a body point hits something at over 4 m/s or the car lies
// rolled over; 'fell' once it leaves the deck from at least 25° up the curl before
// reaching the overhang; 'summit' once a wheel reaches the overhang (168°); 'stopped'
// while it sits still on its wheels after moving; otherwise 'running'. The first three
// stick until reset, in that order of precedence; state.events has their times.
//
// Inputs (setInputs, any subset, any time): throttle -1..1, brake 0..1, steer -1..1
// (+ = right), wing 'road' | 'lowDrag' | 'highDownforce', and the booleans fans (the
// suction fans, src/drive/fans.js), boost (the rear nozzles), hop (the corner jets,
// with their attitude hold and landing burn), yawL / yawR (the nose side jets; see
// src/drive/thrust.js). state.jets has every jet for rendering ({ name, kind, on,
// level, pos, dir }: dir is where the gas goes), state.gas the tank, state.fans the
// fans, and state.mass the car's mass, which falls as the gas is spent.

import { createWorld } from './world.js';
import { createCar } from './car.js';
import { createThrusters } from './thrust.js';
import { createFans } from './fans.js';
import { SIM, G, FT, CHASSIS, THRUST, MASS } from './constants.js';
import { dot, length } from './math.js';

const R2D = 180 / Math.PI;

export const DEFAULT_START = Object.freeze({ pos: [-50, 0, 0], headingDeg: 0, speed: 0 });

/**
 * createRun({ start, world, extraForces, systems, gas }) → { reset, setInputs, advance, step, state, world, car, thrusters, fans, dt }.
 * The fans and the thrusters run every step unless systems is false; extraForces(ctx)
 * is a further per-step hook after them (see car.js step()). gas is the tank's fill
 * in kg (default a full 250 kg; 0 is a car without thrust gas, about 1,700 kg).
 */
export function createRun({ start = DEFAULT_START, world, extraForces = null, systems = true, gas } = {}) {
  const W = world ?? createWorld();
  const dt = 1 / SIM.hz;
  const thrusters = createThrusters({ gas });
  const fans = createFans();
  const hook = (ctx) => {
    if (systems) { fans.apply(ctx); thrusters.apply(ctx); }
    if (extraForces) extraForces(ctx);
  };
  const car = createCar({ world: W, start, extraForces: hook });
  car.setMassProps({ mass: MASS.dry + thrusters.tank.gas });
  const sWall = W.ramp.sAtPitch(25);     // the deck is about 1 m up here: off the side from here on is a fall
  const sSummit = W.ramp.sAtPitch(168);  // on the overhang straight
  let acc = 0, startPose = start, track, state;

  function freshTrack() {
    return { pitch: 0, gF: 1, odometer: 0, still: 0, airborne: 0, inverted: 0, lastDeckS: null, maxDeckS: null, maxAltitudeFt: 0, summit: null, fell: null, crashed: null, alpha: 0 };
  }

  function reset(st) {
    if (st) startPose = st;
    car.reset(startPose);
    thrusters.reset();
    fans.reset();
    car.setMassProps({ mass: MASS.dry + thrusters.tank.gas });
    acc = 0;
    track = freshTrack();
    update();
    return state;
  }

  function setInputs(inp) { return { ...car.setInputs(inp) }; }

  /** One fixed step. */
  function step() { car.step(dt); update(); return state; }

  /** Run the fixed steps that `realDt` seconds of real time cover; returns how many ran. */
  function advance(realDt) {
    acc += Math.min(Math.max(0, +realDt || 0), SIM.maxFrame);
    let n = 0;
    while (acc >= dt && n < SIM.maxSteps) { car.step(dt); acc -= dt; n++; update(); }
    if (acc >= dt) acc %= dt;
    track.alpha = acc / dt;
    if (state) state.alpha = track.alpha;
    return n;
  }

  function update() {
    const R = car.R, o = car.origin();
    const f = [R[0], R[3], R[6]], u = [R[1], R[4], R[7]], r = [R[2], R[5], R[8]];
    const speed = length(car.vel);

    // Pitch against the horizon as the broadcast HUD reads it: the angle of the car's
    // nose in its own pitch plane, atan2(nose·y, roof·y). It runs on past 90° up the
    // curl (170° on the overhang, upside down) and is unwrapped step to step; while
    // the car is on its side the pitch plane is undefined and the last value is held.
    if (Math.hypot(f[1], u[1]) > 0.2) {
      let p = Math.atan2(f[1], u[1]);
      while (p - track.pitch > Math.PI) p -= 2 * Math.PI;
      while (p - track.pitch < -Math.PI) p += 2 * Math.PI;
      track.pitch = p;
    }
    // Felt load in g (an accelerometer's magnitude), smoothed over 0.1 s like a gauge.
    const gNow = length(car.last.specificForce) / G;
    track.gF += (gNow - track.gF) * (1 - Math.exp(-dt / 0.1));

    const wheels = car.wheels.map((w) => ({
      name: w.name,
      contact: w.hit ? w.hit.surface : null,
      compression: Math.max(-w.susp.droop, Math.min(w.susp.bump, w.compression)),
      spin: w.spin,
      omega: w.omega,
      steer: w.steer,
      slip: { ratio: w.slipRatio, angleDeg: w.slipAngle * R2D, combined: w.slip },
      load: w.load,
    }));
    const deckHits = car.wheels.filter((w) => w.hit?.surface === 'deck').map((w) => w.hit.s);
    const wheelContacts = car.wheels.filter((w) => w.hit).length;
    const chassis = car.last.chassis;
    const onRamp = deckHits.length > 0 || chassis.some((c) => c.surface === 'deck');
    const airborne = wheelContacts === 0 && chassis.length === 0;
    const altitudeFt = (car.pos[1] - car.cg[1]) / FT;

    // --- outcome
    const t = car.t;
    track.odometer += speed * dt;
    track.maxAltitudeFt = Math.max(track.maxAltitudeFt, altitudeFt);
    if (deckHits.length) {
      const s = Math.max(...deckHits);
      track.lastDeckS = s;
      track.maxDeckS = Math.max(track.maxDeckS ?? s, s);
      if (s >= sSummit && track.summit == null) track.summit = t;
    } else if (wheelContacts > 0) track.lastDeckS = null;
    track.airborne = airborne ? track.airborne + dt : 0;
    if (track.fell == null && track.summit == null && track.airborne > 0.25 && track.lastDeckS != null && track.lastDeckS >= sWall) track.fell = t;
    // Rolled over: a body point is touching something the car's roof is tipped more than
    // 60° away from (on its side or its roof) for 0.3 s.
    const rolled = chassis.some((c) => dot(u, c.normal) < 0.5);
    track.inverted = rolled ? track.inverted + dt : 0;
    if (track.crashed == null && (car.last.maxClosing > CHASSIS.crashSpeed || track.inverted > 0.3)) track.crashed = t;
    track.still = speed < 0.15 && wheelContacts >= 3 ? track.still + dt : 0;
    const stopped = track.still > 1 && track.odometer > 2;
    const outcome = track.crashed != null ? 'crashed' : track.fell != null ? 'fell' : track.summit != null ? 'summit' : stopped ? 'stopped' : 'running';

    const front = (car.wheels[0].steer + car.wheels[1].steer) / 2;
    const tk = thrusters.tank;
    state = {
      t,
      pos: o,
      quat: [...car.quat],
      cg: [...car.pos],
      vel: [...car.vel],
      angVel: [...car.angVel],
      speed,
      speedKmh: speed * 3.6,
      forwardSpeed: dot(car.vel, f),
      pitchDeg: track.pitch * R2D,
      rollDeg: Math.atan2(-r[1], u[1]) * R2D,
      headingDeg: Math.atan2(-f[2], f[0]) * R2D,
      altitudeFt,
      downforceKg: (car.last.aeroDownforceN + car.last.extraDownforceN) / G,
      gForce: track.gF,
      steerDeg: front * R2D,
      wheels,
      onRamp,
      rampS: deckHits.length ? Math.max(...deckHits) : null,
      airborne,
      chassisContacts: chassis.map((c) => c.name),
      outcome,
      events: { summit: track.summit, fell: track.fell, crashed: track.crashed, maxDeckS: track.maxDeckS, maxAltitudeFt: track.maxAltitudeFt, odometer: track.odometer },
      inputs: { ...car.inputs },
      alpha: track.alpha,
      mass: car.mass,
      jets: thrusters.states(car),
      gas: { kg: tk.gas, psi: tk.psi, fraction: tk.gas / THRUST.gas0, empty: tk.empty, flowKgS: tk.flow, thrustN: tk.thrustN, hop: thrusters.hop.armed ? (thrusters.hop.burn ? 'landing' : 'flying') : null },
      fans: { level: fans.state.level, seal: fans.state.seal, forceKgf: fans.state.forceN / G },
    };
  }

  track = freshTrack();
  update();
  return {
    reset, setInputs, advance, step,
    get state() { return state; },
    world: W, car, dt, thrusters, fans,
    sSummit, sWall,
  };
}
