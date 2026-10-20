// Synced from roadster-lab 3360319 (src/drive/constants.js) by tools/sync-garage.mjs.
// Edit it in the lab and re-sync; a hand edit here makes the next sync refuse.
// One reconciled set of numbers for the drivable Roadster.
//
// Frame: the car frame of src/roadster/vehicle.js: x forward, y up, z to the car's
// right, metres, origin on the ground under the wheelbase midpoint. SI units
// throughout (kg, N, N·m, s); kgf only where a source quotes it.
//
// No three.js here: the geometry is copied from vehicle.js SPEC and the jet and
// fan points from buildVehicle().anchors, and test/drive-constants.test.mjs checks
// every copied number against its source so they cannot drift apart.
//
// Where the existing modules disagree (out/understand-r2.md §0.4), this is what
// the drive physics uses and why:
//   mass     SPEC 1700, sim/wallride.js 1900, hop-run.js PHYS 1700 dry + 250 gas.
//            → 1700 dry + 250 kg of nitrogen = 1950 kg, the PHYS reading (SPEC is
//            the dry car; 1900 was a placeholder). Pass 2 spends the gas.
//   tyre μ   wallride.js 1.6, PHYS 1.2, RESEARCH-specs "tyres alone about 1.26 g".
//            → peak μ 1.30 at the nominal corner load, falling slowly with load;
//            on a skidpad that comes out near the quoted 1.26 g (load transfer
//            and load sensitivity cost a few percent). 1.6 was a fan-era guess.
//   power    wallride.js 900 kW (placeholder), RESEARCH-specs "over 1 MW", 1,400 N·m.
//            → 1 MW and 1,400 N·m, two rear motors (500 kW, 700 N·m each), 8.4:1.
//   drag     wallride.js CdA 0.65, ui/session.js CdA 0.32 (a lap-sim fit with its
//            own top-speed cap). → 0.65 for Road, the only figure from a physics
//            model; Low Drag and High Downforce are scaled from it (see AERO).
//   axes     geom.js's header says "z to the car's left"; the data says right
//            (wheelFR z = +0.84). Right is used here.

import { DEFAULT_CAR, G as G_SIM } from '../sim/wallride.js';

export const G = G_SIM;        // 9.80665 m/s², sim/wallride.js
export const RHO = 1.2;        // kg/m³ air, as sim/wallride.js and ui/session.js
export const FT = 0.3048;
export const MPH = 0.44704;    // m/s

// ---------- geometry: src/roadster/vehicle.js SPEC ----------
export const GEOM = {
  wheelbase: 2.825, frontOverhang: 0.868, rearOverhang: 0.689,
  height: 1.148, width: 1.953,
  trackF: 1.679, trackR: 1.670,
  groundClearance: 0.150,
  tireRF: 0.3425, tireWF: 0.295,   // 295/30R20
  tireRR: 0.3672, tireWR: 0.335,   // 335/30R21
};
GEOM.XF = GEOM.wheelbase / 2;
GEOM.XR = -GEOM.wheelbase / 2;
GEOM.NOSE = GEOM.XF + GEOM.frontOverhang;
GEOM.TAIL = GEOM.XR - GEOM.rearOverhang;

// ---------- mass: hop-run.js PHYS ----------
export const MASS = {
  dry: 1700,                       // kg, SPEC.mass / PHYS.massDry ("just under 1,700")
  gas: 250,                        // kg of nitrogen, PHYS.gas0 (600 L at 5,500 psi)
  // Centre of mass of the loaded car, PHYS.cg: 45/55 front/rear, 0.46 m up.
  cg: [GEOM.XF - 0.55 * GEOM.wheelbase, 0.46, 0],
  // Principal moments about the centre of mass, kg·m², PHYS: roll about x (Ixx),
  // yaw about y (Iyy), pitch about z (Izz). For 1,950 kg on a 4.4 × 2.0 m car these
  // sit where mid-engined sports cars measure (k ≈ 1.2 m in yaw and pitch).
  inertia: [600, 2900, 2800],
};
MASS.total = MASS.dry + MASS.gas;

// ---------- tyres ----------
// Combined-slip model: the slip ratio over κp and tan(slip angle) over αp make one
// slip vector S; the force is μ·Fz·shape(|S|) along it (a friction circle that
// scales with load). shape rises as 1.5S − 0.5S³ to 1 at S = 1, then eases to
// `slide` when the tyre is sliding. Relaxation lengths make the tyre a spring at
// a standstill (it holds the car parked) and a lag at speed.
export const TYRE = {
  mu: 1.30,          // peak μ at Fz0 (see the note at the top: quoted 1.26 g on tyres alone)
  Fz0: 4800,         // N, nominal corner load (1,950 kg on four corners)
  loadSens: 0.10,    // μ ∝ (Fz/Fz0)^-loadSens: 4× the load (fans) keeps 87% of μ
  kappaPeak: 0.10,   // slip ratio at the peak (road tyre, ~10%)
  alphaPeak: 0.10,   // tan(slip angle) at the peak (~5.7°)
  slide: 0.85,       // fraction of peak left when fully sliding
  sigmaX: 0.15,      // m, longitudinal relaxation length
  sigmaY: 0.45,      // m, lateral relaxation length (about one tyre radius)
  lowSpeedDamping: 0.7, // damping ratio of the parked tyre spring
  dampFade: 5,       // m/s: the parked-tyre damping fades out by this speed
  slipCap: 3,        // the slip state stops growing past 3× the peak slip
  crr: DEFAULT_CAR.crr, // 0.012 rolling resistance, sim/wallride.js
  // Spin inertia, kg·m²: wheel, tyre and carbon-ceramic disc (estimates); the rear
  // adds each motor's rotor (≈0.025 kg·m²) seen through the 8.4:1 hub: ×70.6.
  inertiaF: 1.4,
  inertiaR: 1.6 + 0.025 * 8.4 * 8.4,
};

// ---------- suspension (wheel rates, per corner) ----------
// Springs about 2.0 Hz front and 2.2 Hz rear on the corner masses, dampers about
// 0.3 of critical in bump and 0.55 in rebound, anti-roll bars bringing the roll
// gradient to about 1°/g. The spring preload is set from the static corner load so
// the car rests exactly at its design height (SPEC.groundClearance under the sills).
// `bump` is wheel travel up from the design position, `droop` down; the bump stop
// is progressive over the last `stopLen`, then the travel ends in a hard stop.
export const SUSPENSION = {
  front: { k: 70000, cBump: 3500, cRebound: 6000, bump: 0.07, droop: 0.09, arb: 40000 },
  rear: { k: 100000, cBump: 4500, cRebound: 7500, bump: 0.07, droop: 0.09, arb: 25000 },
  stopLen: 0.025,     // m of progressive bump rubber before full bump
  stopK: 400000,      // N/m, linear part of the bump stop
  stopK2: 2.0e7,      // N/m², progressive part
  hardK: 2.0e6,       // N/m past full bump (the tyre and the arch take it)
  hardC: 20000,       // N·s/m past full bump
  maxLoad: 250000,    // N, cap per corner (numerical guard only)
};

// ---------- drivetrain: docs/RESEARCH-specs.md "Performance" ----------
export const DRIVE = {
  power: 1.0e6,       // W, "over 1 MW (1,341 hp)", two rear motors
  torque: 1400,       // N·m at the motors in total, "over 1,400 Nm (1,033 lb-ft)"
  motors: 2,          // one per rear wheel, no differential
  hubRatio: 8.4,      // planetary per wheel (src/roadster/drivetrain.js HUB_RATIO)
  efficiency: 0.95,   // motor shaft to hub
  // Motor speed limit: 20,500 rpm through 8.4:1 on the 0.367 m rear tyre is 210 mph,
  // the Performance trim's top speed (Hagerty). Torque fades over the last 500 rpm.
  rpmMax: 20500, rpmFade: 500,
  reverse: 0.25,      // fraction of torque allowed in reverse
  reverseSpeed: 12,   // m/s, reverse is cut above this
};

// ---------- brakes: carbon-ceramic, N·m per wheel at full pedal ----------
// Enough to lock every wheel on tyres alone (about 2.8 kN·m front, 1.6 kN·m rear
// at 1.3 g) with room for fan load; 63% front at full pedal.
export const BRAKES = { front: 6000, rear: 3500 };

// ---------- steering ----------
// Ackermann geometry from the wheelbase and front track. The lock falls with
// speed so full input stays near the grip limit: lock·vRef²/(vRef² + v²), never
// under `minDeg`. The rack turns the wheels at most `rate` rad/s.
export const STEER = { lockDeg: 32, vRef: 10, minDeg: 2.5, rate: 1.2 };

// ---------- assists (on by default; inputs.tc / inputs.abs turn them off) ----------
// Traction control caps each rear motor at what its tyre can take; ABS caps each
// brake the same way and lets go of a wheel that has locked.
export const ASSISTS = { tc: true, abs: true, tcMargin: 0.95, absMargin: 0.95 };

// ---------- aero, per wing mode (vehicle.js WING_POSE names) ----------
// cdA m² drag area, clA m² downforce area (+ = pushes the car onto its wheels),
// front = share of the downforce on the front axle. Road is sim/wallride.js
// DEFAULT_CAR (0.65 / 1.2). Low Drag: wing flush and vented, about 20% less drag
// and a third of the downforce. High Downforce: wing up 115 mm and tilted 17°,
// front wing up; 2.2 m² gives ~1,070 kgf at 200 mph, next to the 700 kg a Tesla
// wing patent quotes for the wing alone (RESEARCH-specs "Systems"). These two are
// estimates, not measurements. The coefficients ease to a new mode at the rate the
// wing moves in vehicle.js (k = 3·dt).
export const AERO = {
  road: { cdA: DEFAULT_CAR.cdA, clA: DEFAULT_CAR.clA, front: 0.42 },
  lowDrag: { cdA: 0.52, clA: 0.45, front: 0.45 },
  highDownforce: { cdA: 0.82, clA: 2.2, front: 0.38 },
  rate: 3,
  dragHeight: 0.5,    // m, car-frame height the drag acts at
};

// ---------- chassis contact (crashes, rollovers, landings) ----------
// Points on the body surface (from vehicle.js keyPoints at these stations), mirrored
// to both sides where z ≠ 0. A stiff spring-damper with sliding friction acts at any
// point that is inside the ground or the deck.
const half = [
  ['noseLow', 2.25, 0.193, 0.53], ['noseTop', 2.15, 0.53, 0.60],
  ['frontShoulder', 1.45, 0.73, 0.95], ['sillFront', 0.95, 0.15, 0.81],
  ['sillRear', -0.95, 0.15, 0.83], ['roofFront', 0.35, 1.10, 0.40],
  ['roofRear', -0.75, 1.08, 0.40], ['haunch', -1.40, 0.867, 0.97],
  ['tailLow', -2.07, 0.215, 0.72], ['tailTop', -2.07, 0.855, 0.83],
];
export const CHASSIS = {
  points: [
    { name: 'floorMid', p: [0, 0.15, 0] },
    ...half.flatMap(([n, x, y, z]) => [{ name: n + 'L', p: [x, y, -z] }, { name: n + 'R', p: [x, y, z] }]),
  ],
  k: 1.5e6,          // N/m per point
  c: 40000,          // N·s/m per point, about 0.7 of critical for the ~500 kg a corner point carries: a body landing barely bounces
  mu: 0.5,           // carbon and aluminium sliding on concrete or asphalt
  vReg: 0.3,         // m/s: below this sliding friction ramps in linearly
  crashSpeed: 4,     // m/s closing speed at a body point that counts as a crash
};

// ---------- fans (src/drive/fans.js) ----------
// Suction and spool: sim/wallride.js DEFAULT_CAR; four rear fans of about 20 kW
// (RESEARCH-specs). Points: buildVehicle().anchors.fans (drawn only; the pull acts on
// the floor). The fans empty the space under the floor and the drop-down skirts seal
// it, so the pull is the full suction while the skirts reach the surface: the floor's
// gap to the surface under it (read at the four skirt corners, the sill stations) up
// to the ride height plus `skirtDrop`. Past that the seal leaks and the pull falls
// off over `falloff` metres; with nothing within `reach` (in the air) it is zero.
// The skirt drop is an estimate: enough for the skirts to follow the measured curl,
// where the floor's middle sits about 60 mm further from the deck than on the flat.
export const FANS = {
  maxKgf: DEFAULT_CAR.fanMax,   // 4,800 kgf
  spool: DEFAULT_CAR.fanSpool,  // 1.2 s from 0 to full, linear as in sim/wallride.js
  count: 4, powerEach: 20e3,
  points: [[-2.0165, 0.30, -0.43], [-2.0165, 0.30, -0.145], [-2.0165, 0.30, 0.145], [-2.0165, 0.30, 0.43]],
  floor: [0, 0.15, 0],          // where the pull acts: the floor centre (CHASSIS floorMid)
  skirts: [[0.95, 0.15, -0.8], [0.95, 0.15, 0.8], [-0.95, 0.15, -0.8], [-0.95, 0.15, 0.8]],
  skirtDrop: 0.10,              // m the skirts reach below the floor
  falloff: 0.04,                // m: past the skirts' reach the pull falls by e per 40 mm
  reach: 0.6,                   // m: no surface this close under a skirt corner = no seal there
};
// Thrusters: hop-run.js PHYS (corner and side jets, exhaust velocity, gas, pressure)
// and buildVehicle().anchors (hoverJets, frontJets, nozzles). All of them draw on one
// tank: the Rocket trim's 600 L of nitrogen, 250 kg at 5,500 psi. The rear nozzles
// have no published thrust; 40 kN in all (10 kN each) gives 0-60 mph in 0.85 s with
// the fans and the boost, Top Gear's and Hagerty's figure for the Thrust trim (Tesla:
// "under 0.9 s"); test/drive-thrust.test.mjs prints it.
export const THRUST = {
  corner: 24000, side: 2500, ve: 700, gas0: 250, psi0: 5500,
  rearTotal: 40000,
  hoverJets: [[1.6625, 0.2, 0.62], [1.6625, 0.2, -0.62], [-1.6625, 0.2, 0.62], [-1.6625, 0.2, -0.62]],
  frontJets: [[1.98, 0.4748, 0.7476], [1.98, 0.4748, -0.7476]],
  nozzles: [[-2.0745, 0.47, -0.36], [-2.0745, 0.47, -0.12], [-2.0745, 0.47, 0.12], [-2.0745, 0.47, 0.36]],
  // Blowdown: no regulator, so every jet's thrust scales with the tank pressure, and
  // the pressure falls with the gas left as P = psi0·(gas/gas0)^n. n = 1.4 is an ideal
  // gas expanding without taking up heat, which is close for a burn of a few seconds.
  blowdown: 1.4,
  psiMin: 300,       // below this the valve cannot feed the nozzles: the tank is spent
  valveTau: 0.04,    // s, each valve opens and closes as a first-order lag
  // Hop (the four corner jets on `hop`): the jets hold the car level, climb toward
  // `ceiling` metres above the surface under it at up to `climb` m/s, and while the
  // car is still in the air after `hop` is let go they brake the fall with a
  // constant-deceleration burn that touches down at `vTouch` m/s, engaging once it
  // needs `landG` g, or sooner when the pressure left cannot give that (hop-run.js:
  // climb ~9.8 m/s, peak 8.9 m, touchdown 1.3 m/s).
  hop: {
    ceiling: 8.5, climb: 9.8, accelG: 3.0, kv: 6, landG: 1.5, vTouch: 1.2,
    // Attitude hold: a critically damped spring on roll and pitch (corner jets) and on
    // the heading (side jets), ω = 6 rad/s.
    omega: 6, zeta: 1,
  },
};

// ---------- the integrator ----------
export const SIM = {
  hz: 240,           // fixed physics rate
  maxSteps: 12,      // most fixed steps one advance() will run (50 ms of catch-up)
  maxFrame: 0.25,    // s, a longer real frame (tab in the background) is dropped
};
