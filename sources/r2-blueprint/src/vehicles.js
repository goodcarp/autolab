// The vehicles the Garage can show, and what changes with each: its sheet text (config.js), its
// camera presets and presentation fit, its compact height floor, and how to build it. The RX2 is
// in the page from the start; the Roadster's modules are fetched the first time it is chosen.
// Each car is built once and kept, so switching back is instant and keeps nothing stale: the
// sheet resets motions, selection and camera on every switch (main.js setVehicle).
import { CONFIG, ROADSTER_CONFIG } from './config.js';
import { PRESETS, PRESENTATION } from './camera.js';
import { buildVehicle } from './vehicle.js';

// The RX2's presets scaled to the Roadster: 4.382 m long against 4.72, 1.148 m tall against 1.70,
// 2.005 m over its tyres against 2.15 over the RX2's mirrors. The targets sit lower with the roof.
export const ROADSTER_PRESETS = {
  iso:   { ...PRESETS.iso,   fitW: 6.15, ty: 0.50 },
  q34f:  { ...PRESETS.q34f,  fitW: 5.6,  ty: 0.52 },
  q34r:  { ...PRESETS.q34r,  fitW: 5.8,  ty: 0.52 },
  side:  { ...PRESETS.side,  fitW: 6.4,  groundFrac: 0.66 },
  front: { ...PRESETS.front, fitW: 4.5,  groundFrac: 0.68 },
  top:   { ...PRESETS.top,   fitW: 6.9 },
};
// Its explode stack is short (the canopy lifts 0.7 m, the doors 0.3 m), and the open gull-wings
// stand about 2 m tall, so it needs less pull-back than the RX2's 2 m stack.
export const ROADSTER_PRESENTATION = { explodeQ34: 0.45, explode: 0.35, openQ34: 0.22, open: 0.14, liftElevation: 0.20, lift: 0.25 };

export const VEHICLES = [
  {
    id: 'rx2', label: 'Hudian RX2', short: 'RX2', config: CONFIG,
    presets: PRESETS, presentation: PRESENTATION, fitHeight: 4.8, play: false,
    build: async () => {
      const v = buildVehicle();
      const S = v.SPEC;
      v.lampFlash = { part: v.parts.headlamps, locals: [[S.NOSE + 0.05, 0.875, -0.595], [S.NOSE + 0.05, 0.875, 0.595]] };
      return v;
    },
  },
  {
    id: 'roadster', label: 'Tesla Roadster', short: 'ROADSTER', config: ROADSTER_CONFIG,
    presets: ROADSTER_PRESETS, presentation: ROADSTER_PRESENTATION, fitHeight: 3.6, play: true,
    build: async () => {
      const [{ buildVehicle }, { adaptRoadster }] = await Promise.all([import('./rd/roadster/vehicle.js'), import('./roadster-adapter.js')]);
      return adaptRoadster(buildVehicle());
    },
  },
];

export const vehicleEntry = (id) => VEHICLES.find((v) => v.id === id) || null;

const built = new Map();
// Build a car once; later calls get the same object (and a failed build is retried next time).
export function loadVehicle(id) {
  const entry = vehicleEntry(id);
  if (!entry) return Promise.reject(new Error(`unknown vehicle "${id}"; one of: ${VEHICLES.map((v) => v.id).join(', ')}`));
  if (!built.has(id)) built.set(id, entry.build().catch((err) => { built.delete(id); throw err; }));
  return built.get(id);
}
