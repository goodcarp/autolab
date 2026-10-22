// Synced from roadster-lab c9e9c53 (src/drive/car.js) by tools/sync-garage.mjs.
// Edit it in the lab and re-sync; a hand edit here makes the next sync refuse.
// The drivable Roadster as a rigid body on four ray-cast wheels.
//
// State: the centre of mass position, the orientation (car frame → world), and the
// linear and angular velocity in the world frame. The inertia is diagonal in the car
// frame (roll, yaw, pitch). One call to step(dt) is one fixed step of semi-implicit
// Euler: every force is worked out from the current state, then the velocities are
// updated, then the positions with the new velocities.
//
// Ahead of the tyre forces, the steering and the stability control:
//   steering  the steer-by-wire shapes the input (a speed-dependent rate limit away
//             from the centre, then a short lag: a key's ±1 reaches full over 0.26 s at
//             25 m/s, and comes back at once), the lock falls with speed and rises with
//             the wing's downforce (not the fans' pull) so that full input asks for about
//             what the tyres can give, the rack moves at its rate, and Ackermann splits the
//             angle between the wheels.
//             Every source of input (keys, touch, agents, the autopilots) goes through
//             it, and inputs.steer keeps the raw value.
//   ESC       the yaw rate about the car's own up against the bicycle model's for this
//             steer, held to the friction limit and lagged as the car's yaw lags on the
//             tyres' loads of the moment, and the body slip against a slide's; past either dead band the outside front wheel
//             is braked and the rear drive cut, in proportion. On the ground only (not on
//             the ramp), forward, near level, and not while the nose jets fire.
//             inputs.esc = false turns it off; car.esc says what it did last step.
//   Why: with a key's instant full lock, 1 MW at the rear and the first lock law, the
//   car spun at every speed from 15 m/s when the steering was swung left and right with
//   the throttle held (docs/DRIVE.md §3.6 has the numbers before and after).
//
// The forces, in the order they are added:
//   wheels    a ray from each wheel's top of travel along the car's -y finds the
//             ground or the deck; spring, damper, bump stop and anti-roll bar give
//             the load; the tyre turns slip into force (see the tyre notes below);
//   aero      drag against the velocity, downforce along the car's -y, both from the
//             wing mode's coefficients;
//   chassis   points on the body outline that are inside the ground or the deck are
//             pushed out by a stiff spring-damper with sliding friction (crashes,
//             rollovers, landings on the floor);
//   extra     an optional callback adds anything else (thrusters, fans: pass 2);
//   gravity.
//
// Tyres. Each tyre has a contact-patch deflection along and across the wheel that
// relaxes over a relaxation length, so at speed the slip is the usual slip ratio and
// tan(slip angle), and at a standstill the tyre is a stiff spring (a parked car stays
// parked). The two slips, each over its peak value, make one slip vector; the force is
// μ·Fz·shape(|S|) along it, which is a friction circle that grows with the load. The
// wheel's spin is solved implicitly against its own tyre force each step (bisection on
// a monotone function), which keeps a light wheel on a stiff tyre stable at 240 Hz and
// lets the brakes hold a wheel still.

import { G, RHO, GEOM, MASS, TYRE, SUSPENSION, DRIVE, BRAKES, STEER, ASSISTS, ESC, AERO, CHASSIS } from './constants.js';
import { add, sub, scale, dot, cross, length, normalize, clamp, quatAxisAngle, quatIntegrate, quatToMat, matVec, matTVec } from './math.js';

const D2R = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

/** The tyre's force curve over the combined slip S, divided by S (finite at 0). */
function shapeOverS(S) {
  if (S <= 1) return 1.5 - 0.5 * S * S;
  const d = S - 1;
  return (TYRE.slide + (1 - TYRE.slide) / (1 + 2 * d * d)) / S;
}

/** Root of an increasing function on [lo, hi] with fn(lo) ≤ 0 ≤ fn(hi). */
function bisect(fn, lo, hi) {
  for (let i = 0; i < 48 && hi - lo > 1e-9 * (1 + Math.abs(lo)); i++) {
    const m = 0.5 * (lo + hi);
    if (fn(m) > 0) hi = m; else lo = m;
  }
  return 0.5 * (lo + hi);
}

/** What the stability control did in one step (car.esc, run.state.esc). */
const freshEsc = () => ({ active: false, wheel: null, brakeNm: 0, cut: 0, yaw: 0, ref: 0, over: 0 });

/** A tyre's cornering stiffness at load Fz (N/rad): the slope of its curve at zero slip, 1.5·μ(Fz)·Fz/αp. */
function corneringStiffness(Fz) {
  return (1.5 * TYRE.mu * Math.pow(Math.max(Fz, 0.25 * TYRE.Fz0) / TYRE.Fz0, -TYRE.loadSens) * Fz) / TYRE.alphaPeak;
}

/**
 * The linear bicycle model of this car at the corner loads fz = [FL, FR, RL, RR] (N; the
 * static loads when left out): Cf and Cr each axle's cornering stiffness; a and b the
 * centre of mass to the front and rear axle; the understeer gradient K = (m/L)(b/Cf − a/Cr)
 * in rad per m/s² (steady yaw rate v·δ/(L + K·v²)); and the yaw time constant per unit
 * speed, Iz/(a²Cf + b²Cr), so τ = tauPerV·v. At the static loads τ is 0.10 s at 25 m/s;
 * under the fans' full pull the tyres are about three times stiffer and τ a third of that.
 */
export function bicycle(fz = null) {
  const m = MASS.total, L = GEOM.wheelbase;
  const a = GEOM.XF - MASS.cg[0], b = MASS.cg[0] - GEOM.XR;
  const sf = (m * G * b) / L / 2, sr = (m * G * a) / L / 2;
  const [fl, fr, rl, rr] = fz ?? [sf, sf, sr, sr];
  const Cf = corneringStiffness(fl) + corneringStiffness(fr), Cr = corneringStiffness(rl) + corneringStiffness(rr);
  return { a, b, Cf, Cr, K: (m / L) * (b / Cf - a / Cr), tauPerV: MASS.inertia[1] / (a * a * Cf + b * b * Cr) };
}
const BIKE = bicycle();

const WHEEL_LAYOUT = [
  { name: 'FL', front: true, side: -1 },
  { name: 'FR', front: true, side: 1 },
  { name: 'RL', front: false, side: -1 },
  { name: 'RR', front: false, side: 1 },
];

export const DEFAULT_INPUTS = Object.freeze({ throttle: 0, brake: 0, steer: 0, fans: 0, boost: 0, hop: 0, yawL: 0, yawR: 0, wing: 'road', tc: ASSISTS.tc, abs: ASSISTS.abs, esc: ASSISTS.esc });

/**
 * createCar({ world, start, extraForces }) → the car. `world` is createWorld().
 * `start` as for reset(). `extraForces(ctx)` runs once per step after the built-in
 * forces (see step()).
 */
export function createCar({ world, start, extraForces = null } = {}) {
  const cg = [...MASS.cg];
  const mass0 = MASS.total;
  const L = GEOM.wheelbase;
  // Static corner loads at the design height: the springs are preloaded to carry
  // exactly these, so the car rests at its design ride height.
  const staticLoad = {
    front: (mass0 * G * (cg[0] - GEOM.XR)) / L / 2,
    rear: (mass0 * G * (GEOM.XF - cg[0])) / L / 2,
  };

  const wheels = WHEEL_LAYOUT.map(({ name, front, side }) => {
    const s = front ? SUSPENSION.front : SUSPENSION.rear;
    const r = front ? GEOM.tireRF : GEOM.tireRR;
    const x = front ? GEOM.XF : GEOM.XR, z = (side * (front ? GEOM.trackF : GEOM.trackR)) / 2;
    return {
      name, front, side, r, susp: s,
      I: front ? TYRE.inertiaF : TYRE.inertiaR,
      centre0: [x, r, z],                 // wheel centre at the design height (car frame)
      top: [x, r + s.bump, z],            // where the ray starts: the centre at full bump
      reach: s.bump + s.droop + r,        // ray length
      preload: front ? staticLoad.front : staticLoad.rear,
      maxBrake: front ? BRAKES.front : BRAKES.rear,
      // live state
      omega: 0, spin: 0, steer: 0, u: 0, y: 0,
      hit: null, compression: -s.droop, rate: 0, load: 0,
      Fx: 0, Fy: 0, Fmax: 0, slipRatio: 0, slipAngle: 0, slip: 0, driveTorque: 0, brakeTorque: 0,
    };
  });

  const car = {
    world, wheels, cg, staticLoad,
    mass: mass0, inertia: [...MASS.inertia],
    pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], angVel: [0, 0, 0],
    R: quatToMat([0, 0, 0, 1]),
    inputs: { ...DEFAULT_INPUTS },
    steerAngle: 0,                       // rack position as a mean front-wheel angle about +y (rad, + = left)
    steerShaped: 0,                      // the steer input after the steer-by-wire's rate limit (-1..1, + = right)
    steerLagged: 0,                      // ... and after its lag: what the lock is asked for
    yawRef: 0,                           // the stability control's reference yaw rate (rad/s, + = nose left)
    esc: freshEsc(),                     // what the stability control did in the last step
    aero: { ...AERO.road },              // current coefficients, easing toward the wing mode's
    extraForces,
    t: 0,
    // what the last step saw, for telemetry and outcome logic
    last: { aeroDownforceN: 0, extraDownforceN: 0, dragN: 0, specificForce: [0, G, 0], chassis: [], maxClosing: 0 },
    reset, step, setInputs, setMassProps,
    toWorld, dirToWorld, origin, pointVelocity, applyForce, applyBodyForce, probe,
  };

  /** Car-frame point → world. */
  function toWorld(p) { return add(car.pos, matVec(car.R, sub(p, cg))); }
  /** Car-frame direction → world. */
  function dirToWorld(d) { return matVec(car.R, d); }
  /** World position of the car-frame origin (what the renderer's car.root.position is). */
  function origin() { return sub(car.pos, matVec(car.R, cg)); }
  /** Velocity of a world point fixed to the body. */
  function pointVelocity(p) { return add(car.vel, cross(car.angVel, sub(p, car.pos))); }

  let F = [0, 0, 0], T = [0, 0, 0];
  /** Add a world-frame force at a world point (valid inside step and its callback). */
  function applyForce(f, p) {
    F[0] += f[0]; F[1] += f[1]; F[2] += f[2];
    const r = sub(p, car.pos), t = cross(r, f);
    T[0] += t[0]; T[1] += t[1]; T[2] += t[2];
  }
  /** Add a car-frame force at a car-frame point. */
  function applyBodyForce(fLocal, pLocal) { applyForce(dirToWorld(fLocal), toWorld(pLocal)); }

  /** Ray from a car-frame point along a car-frame direction into the world. */
  function probe(pLocal, dLocal, maxDist) { return world.raycast(toWorld(pLocal), normalize(dirToWorld(dLocal)), maxDist); }

  /**
   * reset({ pos, quat, headingDeg, speed, vel, angVel }): pos is the car-frame origin
   * in the world (default [-50, 0, 0]: on the run-in 50 m before the foot);
   * quat the orientation, or headingDeg a turn about +y (three.js rotation.y:
   * + turns the nose to the left); speed (m/s) along the car's nose.
   */
  function reset(st = {}) {
    car.quat = st.quat ? [...st.quat] : quatAxisAngle([0, 1, 0], (st.headingDeg ?? 0) * D2R);
    car.R = quatToMat(car.quat);
    const o = st.pos ?? [-50, 0, 0];
    car.pos = add(o, matVec(car.R, cg));
    const fwd = dirToWorld([1, 0, 0]);
    car.vel = st.vel ? [...st.vel] : scale(fwd, st.speed ?? 0);
    car.angVel = st.angVel ? [...st.angVel] : [0, 0, 0];
    const vFwd = dot(car.vel, fwd);
    for (const w of wheels) {
      Object.assign(w, { omega: vFwd / w.r, spin: 0, steer: 0, u: 0, y: 0, hit: null, compression: -w.susp.droop, rate: 0, load: 0, Fx: 0, Fy: 0, Fmax: 0, slipRatio: 0, slipAngle: 0, slip: 0, driveTorque: 0, brakeTorque: 0 });
    }
    car.steerAngle = 0; car.steerShaped = 0; car.steerLagged = 0; car.yawRef = 0;
    car.esc = freshEsc();
    car.mass = mass0; car.inertia = [...MASS.inertia]; // a full tank again
    car.inputs = { ...DEFAULT_INPUTS };
    car.aero = { ...AERO.road };
    car.t = 0;
    car.last = { aeroDownforceN: 0, extraDownforceN: 0, dragN: 0, specificForce: [0, G, 0], chassis: [], maxClosing: 0 };
    return car;
  }

  /** Merge new inputs: throttle -1..1 (negative = reverse), brake 0..1, steer -1..1 (+ = right), wing mode; fans, boost, hop, yawL and yawR (booleans or 0..1) are passed through to extraForces; tc, abs and esc (booleans) switch the assists. */
  function setInputs(inp = {}) {
    const i = car.inputs;
    if (inp.throttle != null) i.throttle = clamp(+inp.throttle || 0, -1, 1);
    if (inp.brake != null) i.brake = clamp(+inp.brake || 0, 0, 1);
    if (inp.steer != null) i.steer = clamp(+inp.steer || 0, -1, 1);
    if (inp.fans != null) i.fans = clamp(+inp.fans || 0, 0, 1);
    if (inp.boost != null) i.boost = clamp(+inp.boost || 0, 0, 1);
    if (inp.hop != null) i.hop = +inp.hop || 0;
    if (inp.yawL != null) i.yawL = clamp(+inp.yawL || 0, 0, 1);
    if (inp.yawR != null) i.yawR = clamp(+inp.yawR || 0, 0, 1);
    if (inp.wing != null && AERO[inp.wing]?.cdA != null) i.wing = inp.wing;
    if (inp.tc != null) i.tc = !!inp.tc;
    if (inp.abs != null) i.abs = !!inp.abs;
    if (inp.esc != null) i.esc = !!inp.esc;
    return i;
  }

  /** Change the mass (and optionally the inertia) without moving the centre of mass, e.g. as gas is spent. */
  function setMassProps({ mass, inertia } = {}) {
    if (mass > 0) car.mass = mass;
    if (inertia) car.inertia = [...inertia];
  }

  // ---------------------------------------------------------------------------
  // One wheel's tyre and spin over one step. Body velocities are held at their
  // start-of-step values; the spin is solved implicitly.
  function tyreStep(w, Fz, vx, vy, Td, Tb, dt) {
    const r = w.r, I = w.I;
    if (Fz <= 0) {
      // In the air: the drive and the brake act on the wheel alone (Coulomb brake).
      const free = w.omega + (dt * Td) / I, lock = (dt * Tb) / I;
      w.omega = Math.abs(free) <= lock ? 0 : free - Math.sign(free) * lock;
      w.u = 0; w.y = 0; w.Fx = 0; w.Fy = 0; w.Fmax = 0; w.slipRatio = 0; w.slipAngle = 0; w.slip = 0;
      return;
    }
    const sx = TYRE.sigmaX, sy = TYRE.sigmaY;
    const mu = TYRE.mu * Math.pow(Math.max(Fz, 0.25 * TYRE.Fz0) / TYRE.Fz0, -TYRE.loadSens);
    const Fmax = mu * Fz;
    const V = Math.abs(vx);
    const ex = Math.exp((-V * dt) / sx), bx = V > 1e-6 ? (sx * (1 - ex)) / V : dt;
    const ey = Math.exp((-V * dt) / sy), by = V > 1e-6 ? (sy * (1 - ey)) / V : dt;
    const yN = ey * w.y + by * vy;
    const kx = 1 / (sx * TYRE.kappaPeak), ky = 1 / (sy * TYRE.alphaPeak);
    // Damping of the parked-tyre spring: fades out by dampFade m/s, where the
    // relaxation itself damps it.
    const fade = clamp(1 - V / TYRE.dampFade, 0, 1);
    const mShare = Math.min(Fz / G, car.mass / 4);
    const cx = fade * 2 * TYRE.lowSpeedDamping * Math.sqrt(1.5 * Fmax * kx * mShare);
    const cy = fade * 2 * TYRE.lowSpeedDamping * Math.sqrt(1.5 * Fmax * ky * mShare);
    let fy = 0, uN = 0;
    const fxOf = (om) => {
      uN = ex * w.u + bx * (om * r - vx);
      const Sx = uN * kx, Sy = yN * ky;
      const k = Fmax * shapeOverS(Math.hypot(Sx, Sy));
      let fx = k * Sx + (cx * (uN - w.u)) / dt;
      let f2 = -k * Sy - (cy * (yN - w.y)) / dt;
      const m = Math.hypot(fx, f2);
      if (m > Fmax) { fx *= Fmax / m; f2 *= Fmax / m; }
      fy = f2;
      return fx;
    };
    // I(ω' − ω)/dt = Td − r·Fx(ω') − brake, the brake opposing ω' up to Tb.
    const g = (om) => (I * (om - w.omega)) / dt - Td + r * fxOf(om);
    const base = w.omega + (dt * Td) / I, span = (dt * r * Fmax) / I;
    let om;
    if (Tb > 0) {
      const g0 = g(0);
      if (g0 >= -Tb && g0 <= Tb) om = 0;
      else if (g0 < -Tb) om = bisect((o) => g(o) + Tb, 0, Math.max(0, base - (dt * Tb) / I + span));
      else om = bisect((o) => g(o) - Tb, Math.min(0, base + (dt * Tb) / I - span), 0);
    } else om = bisect(g, base - span, base + span);
    const fx = fxOf(om);
    w.omega = om;
    // Keep the slip state from winding up while the tyre slides.
    let u = uN, y = yN;
    const S = Math.hypot(u * kx, y * ky);
    if (S > TYRE.slipCap) { u *= TYRE.slipCap / S; y *= TYRE.slipCap / S; }
    w.u = u; w.y = y; w.Fx = fx; w.Fy = fy;
    w.slipRatio = u / sx; w.slipAngle = Math.atan(y / sy); w.slip = Math.min(S, TYRE.slipCap);
    w.Fmax = Fmax;
  }

  /**
   * One fixed step. extraForces(ctx), if set, is called after the built-in forces
   * with ctx = { car, world, dt, t, inputs, applyForce(Fworld, Pworld),
   * applyBodyForce(Fcar, Pcar), applyTorque(Tworld), addDownforce(N) }; anything it
   * adds goes into this step. addDownforce only feeds the HUD figure.
   */
  function step(dt) {
    const R = (car.R = quatToMat(car.quat));
    const up = [R[1], R[4], R[7]], fwd = [R[0], R[3], R[6]];
    const down = [-up[0], -up[1], -up[2]];
    F = [0, 0, 0]; T = [0, 0, 0];
    const inp = car.inputs;
    const speed = length(car.vel);
    const vFwd = dot(car.vel, fwd);

    // --- steering: the steer-by-wire shapes the input (a rate limit away from the centre,
    // then a short lag), the lock falls with speed and rises with the wing's downforce, the
    // rack moves at its rate, and Ackermann splits it between the wheels.
    // grip counts all the downforce (the ESC's cap below); wingGrip only the wing's, which
    // is what the lock follows. The fans' pull (up to 4,800 kgf, 2.5 times the car's weight)
    // stays out of the lock: it sits mid-wheelbase, ahead of the centre of mass, so it loads
    // the front more than the rear in proportion (48.5% front against the weight's 45%), and
    // under that load μ falls 12%. The rear then reaches its limit first, so a lock grown
    // with the pull (10.0° in place of 3.7° at 25 m/s) slid the tail out. With the same lock
    // as on tyres alone, the car under the pull corners at 1.2-1.9 g with under 3° of body slip.
    const grip = 1 + Math.max(0, car.last.aeroDownforceN + car.last.extraDownforceN) / (car.mass * G);
    const wingGrip = 1 + Math.max(0, car.last.aeroDownforceN) / (car.mass * G);
    const target = inp.steer;
    let sh = car.steerShaped;
    if (target * sh < 0) sh = 0;                              // a reversal starts from straight ahead
    else if (Math.abs(target) < Math.abs(sh)) sh = target;    // back toward the centre at once
    const ramp = (STEER.rampTime * speed * speed) / (speed * speed + STEER.rampSpeed * STEER.rampSpeed);
    sh = ramp > 1e-4 ? sh + clamp(target - sh, -dt / ramp, dt / ramp) : target;
    car.steerShaped = sh;
    car.steerLagged += (sh - car.steerLagged) * (STEER.lag > 0 ? 1 - Math.exp(-dt / STEER.lag) : 1);
    const lock = Math.max(STEER.minDeg, STEER.lockDeg / (1 + (speed * speed) / (STEER.vRef * STEER.vRef * wingGrip))) * D2R;
    const want = -car.steerLagged * lock;
    car.steerAngle += clamp(want - car.steerAngle, -STEER.rate * dt, STEER.rate * dt);
    const d = car.steerAngle;
    if (Math.abs(d) < 1e-6) { wheels[0].steer = d; wheels[1].steer = d; } else {
      const Rt = L / Math.tan(Math.abs(d)), h = GEOM.trackF / 2;
      const inner = Math.atan(L / (Rt - h)), outer = Math.atan(L / (Rt + h)), sg = Math.sign(d);
      wheels[0].steer = sg * (d > 0 ? inner : outer); // FL is the inside wheel of a left turn
      wheels[1].steer = sg * (d > 0 ? outer : inner);
    }

    // --- suspension: rays, compressions and the rate the wheel moves into the arch
    for (const w of wheels) {
      const hp = toWorld(w.top);
      const hit = world.raycast(hp, down, w.reach);
      w.hit = hit;
      if (hit) {
        w.compression = w.susp.bump - (hit.t - w.r);
        const dn = Math.max(0.3, -dot(down, hit.normal));
        w.rate = -dot(pointVelocity(hp), hit.normal) / dn;
      } else { w.compression = -w.susp.droop; w.rate = 0; }
    }
    const loads = wheels.map((w) => {
      if (!w.hit) return 0;
      const s = w.susp, c = w.compression, v = w.rate;
      let f = Math.max(0, w.preload + s.k * c);
      const x = c - (s.bump - SUSPENSION.stopLen);
      if (x > 0) f += SUSPENSION.stopK * x + SUSPENSION.stopK2 * x * x;
      if (c > s.bump) f += SUSPENSION.hardK * (c - s.bump) + SUSPENSION.hardC * Math.max(0, v);
      f += v > 0 ? s.cBump * v : s.cRebound * v;
      return f;
    });
    for (const [a, b] of [[0, 1], [2, 3]]) {
      const wa = wheels[a], wb = wheels[b];
      if (!wa.hit || !wb.hit) continue;
      const ca = clamp(wa.compression, -wa.susp.droop, wa.susp.bump), cb = clamp(wb.compression, -wb.susp.droop, wb.susp.bump);
      const f = wa.susp.arb * (ca - cb);
      loads[a] += f; loads[b] -= f;
    }

    // --- stability control: the yaw rate the car has against the one the steering asks
    // for (the bicycle model, held inside what the tyres can give). When the nose swings
    // further than that, brake the outside front wheel in proportion and cut the rear drive.
    const esc = car.esc;
    Object.assign(esc, freshEsc());
    const yaw = matTVec(R, car.angVel)[1];                   // about the car's own up, + = nose left
    esc.yaw = yaw;
    let escWheel = -1, escTb = 0, escCut = 0;
    // It works on the ground, on at least three wheels, rolling forward, near level: the
    // bicycle model takes a flat road with gravity along the car's up. On the ramp it
    // stands aside (the curl and its side edges turn the car in ways no steering asked for).
    const onGround = wheels.reduce((n, w) => n + (w.hit?.surface === 'ground' ? 1 : 0), 0);
    const onDeck = wheels.some((w) => w.hit?.surface === 'deck');
    const inPlay = onGround >= 3 && !onDeck && vFwd > ESC.minSpeed && up[1] > Math.cos(ESC.maxTiltDeg * D2R);
    if (inPlay) {
      // the steady yaw rate for this steer, held to what the tyres can give (μ at the mean
      // corner load, downforce counted), reached with the car's own yaw lag at the tyres'
      // loads now. The fans' pull makes the tyres about three times stiffer and the car
      // answers the wheel that much sooner: a lag worked out from the static loads (0.18 s at
      // 45 m/s, against 0.06 s under the pull) trailed the car, and the ESC braked and cut
      // the drive in every reversal.
      const Fz1 = (car.mass * G * grip) / 4;
      const muN = TYRE.mu * Math.pow(Math.max(Fz1, 0.25 * TYRE.Fz0) / TYRE.Fz0, -TYRE.loadSens);
      const rMax = (ESC.grip * muN * G * grip) / vFwd;
      const ss = clamp((vFwd * d) / (L + ESC.kus * vFwd * vFwd), -rMax, rMax);
      const Cn = (i) => corneringStiffness(clamp(loads[i], 0, SUSPENSION.maxLoad));
      const tau = (car.inertia[1] * vFwd) / (BIKE.a * BIKE.a * (Cn(0) + Cn(1)) + BIKE.b * BIKE.b * (Cn(2) + Cn(3)));
      car.yawRef += (ss - car.yawRef) * (1 - Math.exp(-dt / tau));
    } else car.yawRef = yaw;
    // Nor does it fight the nose jets: a driver firing yawL or yawR asks for the rotation.
    if (inp.esc && inPlay && !(inp.yawL > 0 || inp.yawR > 0)) {
      const ref = car.yawRef;
      // two signs of a car turning more than asked: a yaw rate past the reference, and a
      // body slip past betaDeg the same way round (a slow drift under power, whose yaw rate
      // stays steady while the tail swings out); the larger one counts
      const sg = Math.sign(yaw);
      const beta = Math.atan2(dot(car.vel, [R[2], R[5], R[8]]), vFwd);
      const overYaw = sg * (yaw - ref) - ESC.margin - ESC.marginFrac * Math.abs(ref);
      const overBeta = ESC.betaGain * (sg * beta - ESC.betaDeg * D2R);
      const over = Math.max(overYaw, overBeta);
      esc.ref = ref; esc.over = over;
      if (over > 0) {
        escWheel = yaw > 0 ? 1 : 0;                           // FR while the nose swings left
        const w = wheels[escWheel];
        escTb = Math.min(w.maxBrake, ((car.inertia[1] * ESC.gain * over) / (GEOM.trackF / 2)) * w.r);
        escCut = clamp(over / ESC.cutSpan, 0, 1);
        esc.active = true; esc.wheel = w.name; esc.cut = escCut;
      }
    }

    // --- tyres, drive and brakes
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const Fz = w.hit ? clamp(loads[i], 0, SUSPENSION.maxLoad) : 0;
      w.load = Fz;
      // Drive: rear motors, power and torque limited, fading at the speed limit.
      let Td = 0;
      if (!w.front && inp.throttle !== 0) {
        const wm = Math.abs(w.omega) * DRIVE.hubRatio;
        const rpm = (wm * 60) / TWO_PI;
        const per = Math.min(DRIVE.torque / DRIVE.motors, DRIVE.power / DRIVE.motors / Math.max(wm, 1));
        const fadeRpm = clamp((DRIVE.rpmMax - rpm) / DRIVE.rpmFade, 0, 1);
        let tm = inp.throttle > 0 ? inp.throttle * per * fadeRpm : inp.throttle * per * DRIVE.reverse * (vFwd > -DRIVE.reverseSpeed ? 1 : 0);
        Td = tm * DRIVE.hubRatio * DRIVE.efficiency;
      }
      // Grip left for the drive or the brake once the side force is paid for.
      const muNow = Fz > 0 ? TYRE.mu * Math.pow(Math.max(Fz, 0.25 * TYRE.Fz0) / TYRE.Fz0, -TYRE.loadSens) : 0;
      const avail = Math.sqrt(Math.max(0, (muNow * Fz) ** 2 - w.Fy * w.Fy));
      if (escCut > 0 && !w.front && Td > 0) Td *= 1 - escCut;
      if (inp.tc && Td !== 0) Td = Math.sign(Td) * Math.min(Math.abs(Td), ASSISTS.tcMargin * w.r * avail);
      let Tb = inp.brake * w.maxBrake;
      if (inp.abs && Tb > 0 && Fz > 0) {
        Tb = Math.min(Tb, ASSISTS.absMargin * w.r * avail);
        if (w.slipRatio < -0.5 && Math.abs(vFwd) > 2) Tb *= 0.2; // a locked wheel: let it go
      }
      // the stability control's brake fills up to the grip left, never past it (it does
      // its own pressure control, ABS or not)
      if (i === escWheel && Fz > 0) {
        const e = Math.min(escTb, Math.max(0, ASSISTS.absMargin * w.r * avail - Tb));
        Tb += e; esc.brakeNm = e;
      }
      Tb += TYRE.crr * Fz * w.r;
      w.driveTorque = Td; w.brakeTorque = Tb;

      if (!w.hit) { tyreStep(w, 0, 0, 0, Td, Tb, dt); continue; }
      const n = w.hit.normal;
      const head = dirToWorld([Math.cos(w.steer), 0, -Math.sin(w.steer)]);
      const along = sub(head, scale(n, dot(head, n)));
      if (length(along) < 1e-6) { tyreStep(w, 0, 0, 0, Td, Tb, dt); continue; }
      const f = normalize(along), sDir = cross(f, n);
      const P = w.hit.point, vc = pointVelocity(P);
      tyreStep(w, Fz, dot(vc, f), dot(vc, sDir), Td, Tb, dt);
      applyForce([n[0] * Fz + f[0] * w.Fx + sDir[0] * w.Fy, n[1] * Fz + f[1] * w.Fx + sDir[1] * w.Fy, n[2] * Fz + f[2] * w.Fx + sDir[2] * w.Fy], P);
    }
    for (const w of wheels) { w.spin -= w.omega * dt; w.spin -= TWO_PI * Math.round(w.spin / TWO_PI); }

    // --- aero: ease toward the wing mode, then drag and downforce
    const tgt = AERO[inp.wing] || AERO.road, ka = Math.min(1, AERO.rate * dt);
    for (const k of ['cdA', 'clA', 'front']) car.aero[k] += (tgt[k] - car.aero[k]) * ka;
    const q = 0.5 * RHO * vFwd * vFwd;
    const downN = q * car.aero.clA;
    applyForce(scale(down, downN * car.aero.front), toWorld([GEOM.XF, cg[1], 0]));
    applyForce(scale(down, downN * (1 - car.aero.front)), toWorld([GEOM.XR, cg[1], 0]));
    const dragN = 0.5 * RHO * car.aero.cdA * speed * speed;
    if (speed > 1e-6) applyForce(scale(car.vel, -dragN / speed), toWorld([cg[0], AERO.dragHeight, 0]));

    // --- chassis points against the ground and the deck
    const touching = [];
    let maxClosing = 0;
    for (const cp of CHASSIS.points) {
      const p = toWorld(cp.p);
      const c = world.contact(p);
      if (!c) continue;
      const vp = pointVelocity(p), n = c.normal, vn = dot(vp, n);
      const fn = CHASSIS.k * c.depth - CHASSIS.c * vn;
      touching.push({ name: cp.name, surface: c.surface, depth: c.depth, closing: -vn, normal: n });
      maxClosing = Math.max(maxClosing, -vn);
      if (fn <= 0) continue;
      const vt = sub(vp, scale(n, vn)), st = length(vt);
      const ft = scale(vt, (-CHASSIS.mu * fn) / Math.max(st, CHASSIS.vReg));
      applyForce(add(scale(n, fn), ft), p);
    }

    // --- anything else (pass 2: thrusters, fans, gas)
    let extraDown = 0;
    if (car.extraForces) {
      car.extraForces({
        car, world, dt, t: car.t, inputs: inp,
        applyForce, applyBodyForce,
        applyTorque: (tw) => { T[0] += tw[0]; T[1] += tw[1]; T[2] += tw[2]; },
        addDownforce: (n) => { extraDown += n; },
      });
    }

    // --- integrate (semi-implicit Euler): velocities first, then positions
    const m = car.mass;
    const spec = [F[0] / m, F[1] / m, F[2] / m]; // everything but gravity: what an accelerometer reads
    car.vel = [car.vel[0] + spec[0] * dt, car.vel[1] + (spec[1] - G) * dt, car.vel[2] + spec[2] * dt];
    const I = car.inertia;
    const wb = matTVec(R, car.angVel), tb = matTVec(R, T);
    const gyro = cross(wb, [I[0] * wb[0], I[1] * wb[1], I[2] * wb[2]]);
    const wb2 = [wb[0] + ((tb[0] - gyro[0]) / I[0]) * dt, wb[1] + ((tb[1] - gyro[1]) / I[1]) * dt, wb[2] + ((tb[2] - gyro[2]) / I[2]) * dt];
    car.angVel = matVec(R, wb2);
    car.pos = [car.pos[0] + car.vel[0] * dt, car.pos[1] + car.vel[1] * dt, car.pos[2] + car.vel[2] * dt];
    car.quat = quatIntegrate(car.quat, car.angVel, dt);
    car.R = quatToMat(car.quat);
    car.t += dt;
    car.last = { aeroDownforceN: downN, extraDownforceN: extraDown, dragN, specificForce: spec, chassis: touching, maxClosing };
    return car;
  }

  reset(start);
  return car;
}
