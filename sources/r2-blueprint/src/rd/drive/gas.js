// Synced from roadster-lab 3360319 (src/drive/gas.js) by tools/sync-garage.mjs.
// Edit it in the lab and re-sync; a hand edit here makes the next sync refuse.
// Gas puffs for drawing the jets as cel-shaded clouds: a deterministic particle system
// fed by the drive's per-jet state (run.state.jets). No three.js and no DOM.
//
//   const gas = createGas({ world: run.world, max: 1500, seed: 7 });
//   gas.step(1 / 60, run.state.jets, run.state.vel);   // once per fixed tick
//   const v = gas.view();   // { count, pos, radius, age, life, tone }: typed arrays, live puffs first
//
// Every firing jet emits puffs at a rate proportional to its level. A puff leaves the
// jet along its gas direction (a narrow cone) at the kind's speed, plus the car's own
// velocity, and then slows in the still air (exponential drag), swells as it ages
// (the radius eases from the nozzle size toward the kind's full size), and rises a
// little. It cannot pass into the ground or the ramp deck: one that reaches either is
// held on the surface (its centre a fraction of its radius off it), loses the speed
// it had into the surface and gets some of that speed back sideways, so a jet aimed
// at the ground spreads into a sheet along it. At most `max` puffs live at once: a ring
// buffer, so when it is full a new puff takes the oldest one's place.
//
// tone is 0..1 per puff for the cel shading: low for the dense gas near the nozzle,
// rising as it ages and thins, with a per-puff random offset so a cloud does not
// band evenly. The random numbers come from mulberry32(seed), so the same seed and
// the same sequence of steps give the same puffs.

import { mulberry32 } from '../fx/util.js';

/** Per-kind emission: puffs/s at full level, speed m/s, nozzle and full radius m, life s, cone half-angle rad. */
export const PUFF = {
  hover: { rate: 110, speed: 26, r0: 0.16, r1: 0.95, life: [1.4, 2.2], cone: 0.2 },
  nozzle: { rate: 45, speed: 22, r0: 0.07, r1: 0.6, life: [0.9, 1.5], cone: 0.12 },
  front: { rate: 36, speed: 18, r0: 0.07, r1: 0.55, life: [0.8, 1.3], cone: 0.15 },
  drag: 2.4,        // 1/s: speed relative to the still air falls by e every 0.42 s
  grow: 0.55,       // s: the radius covers 63% of the way to full size in this time
  buoyancy: 0.7,    // m/s² up
  clear: 0.35,      // centre held this fraction of the radius off a surface…
  clearMax: 0.45,   // …but never more than this (m)
  spread: 0.55,     // fraction of the speed into a surface that turns sideways
};

/**
 * createGas({ world, max, seed, scale }) → { step, view, reset, count, capacity }.
 * world is the drive's createWorld() (for the deck); without it only the ground collides.
 * scale multiplies every emission rate.
 */
export function createGas({ world = null, max = 1500, seed = 7, scale = 1 } = {}) {
  const N = max;
  // state, structure of arrays
  const px = new Float64Array(N), py = new Float64Array(N), pz = new Float64Array(N);
  const vx = new Float64Array(N), vy = new Float64Array(N), vz = new Float64Array(N);
  const age = new Float64Array(N), life = new Float64Array(N), r0 = new Float64Array(N), r1 = new Float64Array(N);
  const toneBase = new Float64Array(N), rad = new Float64Array(N);
  const alive = new Uint8Array(N);
  // the deck normal a puff last touched (0 = none): to keep it off the deck as it swells
  const nx = new Float64Array(N), ny = new Float64Array(N), nz = new Float64Array(N);
  // output, compacted
  const out = { count: 0, pos: new Float32Array(3 * N), radius: new Float32Array(N), age: new Float32Array(N), life: new Float32Array(N), tone: new Float32Array(N) };

  // The deck's bounds (with a margin): puffs outside them never ask the world about it.
  let box = null;
  if (world) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let s = world.sFoot; s <= world.sLip + 1e-9; s += 0.25) {
      const [x, y] = world.ramp.at(Math.min(s, world.sLip));
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    box = { x0: x0 - 2, x1: x1 + 2, y0: y0 - 2, y1: y1 + 2, z: world.halfWidth + 1.5 };
  }

  let rand, head, emitAcc;
  function reset() {
    rand = mulberry32(seed);
    head = 0;
    emitAcc = new Map();
    alive.fill(0); nx.fill(0); ny.fill(0); nz.fill(0);
    out.count = 0;
  }
  reset();

  const clearOf = (r) => Math.min(PUFF.clearMax, PUFF.clear * r);

  function emit(j, kind, carVel, dt, u) {
    const i = head;
    head = (head + 1) % N;
    // a direction in the cone about the gas direction
    const d = j.dir;
    const a = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let ex = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
    const el = Math.hypot(...ex); ex = ex.map((v) => v / el);
    const ey = [d[1] * ex[2] - d[2] * ex[1], d[2] * ex[0] - d[0] * ex[2], d[0] * ex[1] - d[1] * ex[0]];
    const th = kind.cone * Math.sqrt(rand()), ph = 2 * Math.PI * rand();
    const c = Math.cos(th), s = Math.sin(th);
    const dir = [0, 1, 2].map((k) => d[k] * c + (ex[k] * Math.cos(ph) + ey[k] * Math.sin(ph)) * s);
    const sp = kind.speed * (0.8 + 0.4 * rand()) * (0.6 + 0.4 * j.level);
    vx[i] = dir[0] * sp + carVel[0]; vy[i] = dir[1] * sp + carVel[1]; vz[i] = dir[2] * sp + carVel[2];
    // spread over the step: as if it had left the nozzle u·dt ago (and met whatever
    // surface is in the way on the way out)
    const back = u * dt;
    const ox = j.pos[0] + dir[0] * 0.04, oy = j.pos[1] + dir[1] * 0.04, oz = j.pos[2] + dir[2] * 0.04;
    px[i] = ox + (vx[i] - carVel[0]) * back;
    py[i] = oy + (vy[i] - carVel[1]) * back;
    pz[i] = oz + (vz[i] - carVel[2]) * back;
    age[i] = back;
    life[i] = kind.life[0] + (kind.life[1] - kind.life[0]) * rand();
    r0[i] = kind.r0; r1[i] = kind.r1 * (0.8 + 0.4 * rand());
    rad[i] = kind.r0;
    toneBase[i] = rand();
    nx[i] = 0; ny[i] = 0; nz[i] = 0;
    alive[i] = 1;
    collide(i, ox, oy, oz);
  }

  /** Hold puff i on a surface with normal n at a point q on it; turn its speed into the surface sideways. */
  function land(i, q, n) {
    const c = clearOf(rad[i]);
    px[i] = q[0] + n[0] * c; py[i] = q[1] + n[1] * c; pz[i] = q[2] + n[2] * c;
    const vn = vx[i] * n[0] + vy[i] * n[1] + vz[i] * n[2];
    if (vn >= 0) return;
    vx[i] -= vn * n[0]; vy[i] -= vn * n[1]; vz[i] -= vn * n[2];
    // sideways: along what is left of its motion, or a random way along the surface
    let tx = vx[i], ty = vy[i], tz = vz[i];
    let tl = Math.hypot(tx, ty, tz);
    if (tl < 0.3 * -vn) {
      const ph = 2 * Math.PI * rand();
      const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const e1 = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
      const l1 = Math.hypot(...e1);
      const e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
      tx = (e1[0] * Math.cos(ph) + e2[0] * Math.sin(ph)) / l1; ty = (e1[1] * Math.cos(ph) + e2[1] * Math.sin(ph)) / l1; tz = (e1[2] * Math.cos(ph) + e2[2] * Math.sin(ph)) / l1;
      tl = 1;
    }
    const k = (-vn * PUFF.spread * (0.6 + 0.8 * rand())) / tl;
    vx[i] += tx * k; vy[i] += ty * k; vz[i] += tz * k;
  }

  const inBox = (x, y, z) => box && x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1 && Math.abs(z) < box.z;

  /** Puff i moved from (ox, oy, oz) to where it is: stop it at the deck or the ground. */
  function collide(i, ox, oy, oz) {
    const c = clearOf(rad[i]);
    // the deck: the path (and the clearance past its end) against the riding surface
    if (inBox(px[i], py[i], pz[i]) || inBox(ox, oy, oz)) {
      const dx = px[i] - ox, dy = py[i] - oy, dz = pz[i] - oz, L = Math.hypot(dx, dy, dz);
      if (L > 1e-9) {
        const hit = world.raycast([ox, oy, oz], [dx / L, dy / L, dz / L], L + c);
        if (hit && hit.surface === 'deck') { land(i, hit.point, hit.normal); nx[i] = hit.normal[0]; ny[i] = hit.normal[1]; nz[i] = hit.normal[2]; }
      }
      if (nx[i] || ny[i] || nz[i]) {
        // swelling against the deck it touched: keep the clearance
        const hit = world.raycast([px[i], py[i], pz[i]], [-nx[i], -ny[i], -nz[i]], c);
        if (hit && hit.surface === 'deck') { land(i, hit.point, hit.normal); nx[i] = hit.normal[0]; ny[i] = hit.normal[1]; nz[i] = hit.normal[2]; }
      }
    }
    // the ground
    if (py[i] < c) land(i, [px[i], 0, pz[i]], [0, 1, 0]);
  }

  /**
   * Advance dt seconds: emit from `jets` (run.state.jets: { kind, level, pos, dir }),
   * with the car's velocity `carVel`, then move, swell and collide every puff.
   */
  function step(dt, jets = [], carVel = [0, 0, 0]) {
    // emission: a fractional count per jet carried from step to step
    for (const j of jets) {
      const kind = PUFF[j.kind];
      if (!kind) continue;
      let acc = (emitAcc.get(j.name) ?? 0) + (j.level > 0.01 ? kind.rate * scale * j.level * dt : 0);
      while (acc >= 1) { acc -= 1; emit(j, kind, carVel, dt, rand()); }
      emitAcc.set(j.name, acc);
    }
    const damp = Math.exp(-PUFF.drag * dt);
    for (let i = 0; i < N; i++) {
      if (!alive[i]) continue;
      age[i] += dt;
      if (age[i] >= life[i]) { alive[i] = 0; continue; }
      rad[i] = r0[i] + (r1[i] - r0[i]) * (1 - Math.exp(-age[i] / PUFF.grow));
      vx[i] *= damp; vy[i] = vy[i] * damp + PUFF.buoyancy * dt; vz[i] *= damp;
      const ox = px[i], oy = py[i], oz = pz[i];
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      collide(i, ox, oy, oz);
    }
  }

  /** The live puffs, compacted into the output arrays (shared; read them before the next call). */
  function view() {
    let n = 0;
    // oldest first: from the ring's head round to just before it
    for (let k = 0; k < N; k++) {
      const i = (head + k) % N;
      if (!alive[i]) continue;
      out.pos[3 * n] = px[i]; out.pos[3 * n + 1] = py[i]; out.pos[3 * n + 2] = pz[i];
      out.radius[n] = rad[i] || r0[i];
      out.age[n] = age[i];
      out.life[n] = life[i];
      out.tone[n] = Math.min(1, Math.max(0, 0.1 + 0.65 * (age[i] / life[i]) + 0.25 * toneBase[i]));
      n++;
    }
    out.count = n;
    return out;
  }

  return { step, view, reset, get capacity() { return N; }, get count() { let n = 0; for (let i = 0; i < N; i++) n += alive[i]; return n; } };
}
