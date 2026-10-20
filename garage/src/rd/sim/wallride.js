// Synced from roadster-lab 064f2af (src/sim/wallride.js) by tools/sync-garage.mjs.
// Edit it in the lab and re-sync; a hand edit here makes the next sync refuse.
// The wall ride: a car on the inside of a ramp that curls past vertical.
//
// Perpendicular to the track, toward the centre of curvature, the forces must
// supply the centripetal term:
//
//     N - m g cos θ - D = m v² κ     →     N = m v² κ + m g cos θ + D
//
// N is what the track pushes back with. The car stays on while N ≥ 0. At the
// 170° lip, nearly stopped, that needs D ≥ -m g cos 170° ≈ 0.98 m g — which is
// why the HUD reads several tonnes of downforce up there while the fans run flat
// out. D is the fan's suction plus ordinary aero (∝ v²).
//
// Along the track: m dv/dt = F_drive - m g sin θ - ½ρ C_dA v² - C_rr N, with the
// drive force capped by motor power and by grip (μ N).
export const G = 9.80665;
export const FT = 0.3048;

export const DEFAULT_CAR = {
  mass: 1900,          // kg, placeholder until the published curb weight is in
  power: 900e3,        // W at the wheels, placeholder
  mu: 1.6,             // tyre grip on the ramp surface
  cdA: 0.65,           // m², drag area
  clA: 1.2,            // m², aero lift-coefficient area (downforce ∝ ½ρ ClA v²)
  crr: 0.012,
  fanMax: 4800,        // kgf of suction the fans can make at rest (HUD showed ~4,700 at the lip)
  fanSpool: 1.2,       // s to spool from 0 to full
};

const RHO = 1.2;

export function aeroDownforceN(car, v) { return 0.5 * RHO * car.clA * v * v; }

/** Normal force from the track, N (negative means the car would leave it). */
export function contactForce(car, ramp, s, v, fanN) {
  const th = ramp.pitch(s), k = ramp.curvature(s);
  return car.mass * v * v * k + car.mass * G * Math.cos(th) + fanN + aeroDownforceN(car, v);
}

/** Fan suction (N) needed to hold the car at s with speed v. */
export function requiredDownforceN(car, ramp, s, v) {
  const th = ramp.pitch(s), k = ramp.curvature(s);
  return Math.max(0, -(car.mass * v * v * k + car.mass * G * Math.cos(th)) - aeroDownforceN(car, v));
}

/**
 * Simulate one run. The script is a list of phases the driver follows:
 *   { until: 'apex' | 'ground' | seconds, throttle: 0..1, fan: 0..1, brake: 0..1 }
 * Returns a time series with everything the HUD shows and whether the car stayed on.
 */
export function simulate(ramp, opts = {}) {
  const car = { ...DEFAULT_CAR, ...(opts.car || {}) };
  const dt = opts.dt ?? 1 / 120;
  const tMax = opts.tMax ?? 40;
  const holdAtApex = opts.holdAtApex ?? 2.0; // s parked at the lip on the fans
  let s = opts.s0 ?? 0, v = opts.v0 ?? 0, fan = 0, t = 0;
  const entry = opts.entrySpeed ?? 22; // m/s the driver brings to the foot of the curl
  const fanTarget = opts.fanLevel ?? 1;
  const sApex = opts.sApex ?? ramp.length - 0.5;
  const series = [];
  let phase = 'approach', held = 0, minN = Infinity, slipped = false, fell = false, fallsOff = null;
  const sCurl = ramp.sAtPitch(2);

  while (t < tMax) {
    const th = ramp.pitch(s);
    // Spool the fans before the curl and keep them up until back on the flat.
    const fanWanted = phase === 'approach' && s < sCurl - 25 ? 0 : fanTarget;
    fan += Math.sign(fanWanted - fan) * Math.min(Math.abs(fanWanted - fan), dt / car.fanSpool);
    const fanN = fan * car.fanMax * G;
    const N = contactForce(car, ramp, s, v, fanN);
    minN = Math.min(minN, N);
    if (N < 0) {
      // Contact is lost here: the run on the ramp ends. Report where, and stop integrating.
      fell = true;
      const [fx, fy] = ramp.at(s);
      fallsOff = { t, s, pitchDeg: (th * 180) / Math.PI, altitudeFt: fy / FT, x: fx };
      break;
    }

    let drive = 0;
    const grip = Math.max(0, N) * car.mu;
    if (phase === 'approach') {
      // Accelerate to the entry speed, then hold it.
      const want = v < entry ? car.power / Math.max(v, 3) : car.mass * G * Math.sin(Math.max(0, th));
      drive = Math.min(want, grip);
      if (s >= sCurl) phase = 'climb';
    } else if (phase === 'climb') {
      // Power up the curl; ease off so the car arrives at the lip slowly.
      const remaining = sApex - s;
      const vWanted = Math.max(1.0, Math.min(entry, Math.sqrt(2 * 2.5 * Math.max(0, remaining))));
      const hold = car.mass * G * Math.sin(th) + 0.5 * RHO * car.cdA * v * v;
      drive = v < vWanted ? Math.min(car.power / Math.max(v, 3), grip) : Math.max(-grip, Math.min(grip, hold - car.mass * (v - vWanted) / 0.4));
      if (s >= sApex - 0.05) { phase = 'hold'; v = 0; s = sApex; }
    } else if (phase === 'hold') {
      drive = Math.min(grip, car.mass * G * Math.sin(th));
      v = 0;
      held += dt;
      if (held >= holdAtApex) phase = 'descent';
    } else if (phase === 'descent') {
      // Roll back down under control: brake force opposes motion (v < 0).
      const wantV = -Math.min(14, 2 + 0.5 * (sApex - s));
      const need = car.mass * (wantV - v) / 0.5 + car.mass * G * Math.sin(th);
      drive = Math.max(-grip, Math.min(grip, need));
      if (s <= 0.5) phase = 'done';
    }
    if (Math.abs(drive) >= grip - 1e-6 && N > 0 && phase !== 'approach') slipped ||= Math.abs(drive) > grip;

    const drag = 0.5 * RHO * car.cdA * v * Math.abs(v);
    const roll = car.crr * Math.max(0, N) * Math.sign(v);
    const a = phase === 'hold' ? 0 : (drive - car.mass * G * Math.sin(th) - drag - roll) / car.mass;
    if (phase !== 'hold') { v += a * dt; s = Math.min(ramp.length, Math.max(0, s + v * dt)); }

    const [x, y] = ramp.at(s);
    series.push({
      t, s, v, x, y, phase,
      pitchDeg: (th * 180) / Math.PI,
      altitudeFt: y / FT,
      downforceKg: (fanN + aeroDownforceN(car, v)) / G,
      contactN: N,
      // Felt load through the seat, in g: 1.0 parked on the flat, ~v²κ/g on the wall.
      gForce: Math.max(0, (car.mass * v * v * ramp.curvature(s) + car.mass * G * Math.cos(th)) / (car.mass * G)),
    });
    t += dt;
    if (phase === 'done') break;
  }
  return { series, stayedOn: !fell, fallsOff, minContactN: minN, slipped, car };
}

/** Sample a recorded or simulated series at time t (linear, clamped). */
export function sampleSeries(series, t, keys) {
  if (!series.length) return null;
  if (t <= series[0].t) return { ...series[0] };
  const last = series[series.length - 1];
  if (t >= last.t) return { ...last };
  let lo = 0, hi = series.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (series[m].t <= t) lo = m; else hi = m; }
  const a = series[lo], b = series[hi], u = (t - a.t) / (b.t - a.t || 1);
  const out = { ...a, t };
  for (const k of keys || Object.keys(a)) {
    if (typeof a[k] === 'number' && typeof b[k] === 'number') out[k] = a[k] + (b[k] - a[k]) * u;
  }
  return out;
}
