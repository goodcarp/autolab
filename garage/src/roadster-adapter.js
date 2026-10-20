// The Tesla Roadster on the Garage sheet.
//
// rd/roadster/vehicle.js is the roadster-lab's car, copied unchanged by the lab's
// tools/sync-garage.mjs. This adapter gives it what the sheet reads from a vehicle (the same
// fields the RX2's buildVehicle returns) without editing it:
//   - the drawing look: every mesh drawn with the RX2's white Lambert, shadows cast but not
//     received; the lab's PBR material stays on userData.pbrMat for later;
//   - lamps: a per-mesh flag (userData.lamp) the G-buffer carries, because the Roadster's lamps
//     are single meshes inside larger parts (blueprint.js lampKind);
//   - pickables, a hidden Set, bob, the shell dissolve (PANELS), callout anchors on the skin for
//     the key items, explode guide points, and the LIGHTS flash at the pop-up lamps.
// OPEN raises the gull-wing doors, DRIVE spins the wheels and EXPLODE uses the lab's own
// explode table; all three are the lab's update(), which runs first.
import * as THREE from 'three';

// The RX2's drawing material (vehicle.js), and the same with the shell's dissolve stipple.
const white = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
const dissolve = { value: 1 };
const shellWhite = white.clone();
shellWhite.onBeforeCompile = (sh) => {
  sh.uniforms.uDissolve = dissolve;
  sh.fragmentShader = 'uniform float uDissolve;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>',
    '#include <clipping_planes_fragment>\n if (uDissolve < 1.0) { float dn = fract(sin(dot(floor(gl_FragCoord.xy * 0.5), vec2(12.9898, 78.233))) * 43758.5453); if (dn > uDissolve) discard; }');
};
shellWhite.customProgramCacheKey = () => 'roadster-shell';

// Where each callout and explode guide sits: a ray from `at` + 3 m along `dir`, back toward
// `at`, onto the part's own meshes. Found on the built geometry, so a reshaped body in the lab
// still gets anchors on its skin. Mostly on the car's right (+z), the side the ISO view shows.
const AIM = {
  fasciaFront: { at: [1.94, 0.655, 0.62], dir: [1, 0.35, 0.35] },
  pods: { at: [0.95, 0.70, 0.95], dir: [0.2, 0.4, 1] },
  doorFR: { at: [0.35, 0.55, 0.93], dir: [0, 0.15, 1] },
  doorFL: { at: [0.35, 0.55, -0.93], dir: [0, 0.15, -1] },
  greenhouse: { at: [0.95, 0.95, 0.30], dir: [0.6, 1, 0.3] },
  wheelFR: { at: [1.413, 0.36, 1.0], dir: [0, 0, 1] },
  wing: { at: [-1.95, 0.87, 0.35], dir: [-0.3, 1, 0.2] },
  fans: { at: [-2.016, 0.33, 0.145], dir: [-1, 0, 0] },
  thrusters: { at: [-2.07, 0.47, 0.12], dir: [-1, 0, 0] },
  fasciaRear: { at: [-2.10, 0.81, 0.40], dir: [-1, 0.2, 0.2] },
  interior: { at: [-0.50, 0.85, 0.38], dir: [0.3, 1, 0] },
  body: { at: [1.60, 0.70, 0.90], dir: [0.3, 0.5, 1] },
  cladding: { at: [0.0, 0.25, 0.92], dir: [0, 0, 1] },
  floor: { at: [0.0, 0.15, 0.60], dir: [0, -1, 0] },
};

// The lab's lamp materials, by identity, with their names as the fallback. Amber repeaters are
// indicators, not lamps that come on with the lights, so they stay unflagged.
function lampFlag(car, mesh) {
  const m = mesh.userData.pbrMat ?? mesh.material, L = car.lamps || {};
  if (m === L.head || m?.name === 'head lamp') return 1;
  if (m === L.tail || m === car.materials?.marker || m?.name === 'tail lamp' || m?.name === 'side marker') return 2;
  return 0;
}

const raycaster = new THREE.Raycaster();
function onSkin(part, aim) {
  const d = new THREE.Vector3(...aim.dir).normalize();
  raycaster.set(new THREE.Vector3(...aim.at).addScaledVector(d, 3), d.clone().negate());
  const hit = raycaster.intersectObjects(part.meshes, false)[0];
  if (!hit) return null;
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  if (n.dot(d) < 0) n.negate();   // a double-sided hit can report the inner face
  return { point: part.group.parent.worldToLocal(hit.point.clone()), normal: n };
}
function centre(part) {
  const box = new THREE.Box3();
  for (const m of part.meshes) box.expandByObject(m);
  return box.isEmpty() ? part.rest.clone() : part.group.parent.worldToLocal(box.getCenter(new THREE.Vector3()));
}

export function adaptRoadster(car) {
  const { root, body, order, parts } = car;
  // At rest, so a point found in world space is also its parent's rest-space point.
  car.explodeT = 0; car.openT = 0;
  car.update(0, { speed: 0, steer: 0 });
  root.updateMatrixWorld(true);

  car.pickables = [];
  for (const p of order) for (const m of p.meshes) {
    m.userData.pbrMat = m.material;
    m.userData.lamp = lampFlag(car, m);
    m.material = p.category === 'shell' ? shellWhite : white;
    m.receiveShadow = false;
    car.pickables.push(m);
  }

  // Callout anchors: in the part's parent space at rest, like the RX2's (overlay.js anchorWorld).
  for (const p of order) {
    const aim = AIM[p.name]; if (!aim) continue;
    const hit = onSkin(p, aim);
    p.anchor = hit ? hit.point : centre(p);
    p.anchorN = hit ? hit.normal : new THREE.Vector3(...aim.dir).normalize();
  }
  // Explode guides run from where a part sat to where it is now, from a point in its own frame.
  car.guideAnchors = {};
  for (const p of order) {
    if (!p.explode.lengthSq()) continue;
    const at = (p.anchor ?? centre(p)).clone().sub(p.rest);
    car.guideAnchors[p.name] = [at.x, at.y, at.z];
  }
  // LIGHTS flash: the pop-up lamps, just ahead of their pockets.
  const S = car.SPEC, head = [];
  for (const p of order) for (const m of p.meshes) {
    if (m.userData.lamp !== 1) continue;
    const c = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());
    if (Math.abs(c.z) > 0.1) head.push({ p, c });
  }
  const flashPart = head[0]?.p ?? parts.fasciaFront;
  car.lampFlash = { part: flashPart, locals: head.filter((h) => h.p === flashPart).map(({ c }) => [c.x + 0.05, c.y, c.z]) };
  if (!car.lampFlash.locals.length) car.lampFlash.locals = [[S.NOSE, 0.6, -0.6], [S.NOSE, 0.6, 0.6]];

  car.lampIds = []; car.tailIds = [];   // lamps are flagged per mesh above
  car.shellNames = order.filter((p) => p.category === 'shell').map((p) => p.name);
  car.hidden = new Set();
  car.dissolve = dissolve;
  car.bob = 0; car.ride = 0; car.panelsT = 1;

  const labUpdate = car.update;
  car.update = function (dt, st = {}) {
    labUpdate.call(this, dt, st);
    // The RX2's idle and drive bob (vehicle.js), on the body only: the wheels stay on the ground.
    const t = st.time ?? 0;
    const runB = st.run ? Math.sin(t * 1.7) * 0.004 + Math.sin(t * 2.9) * 0.002 : 0;
    const driveB = st.drive ? Math.sin(t * 6.3) * 0.010 + Math.sin(t * 9.1) * 0.006 : 0;
    this.bob = runB + driveB;
    body.position.y = this.bob;
    body.rotation.z = st.drive ? Math.sin(t * 2.2) * 0.006 : 0; body.rotation.x = st.drive ? Math.sin(t * 3.1) * 0.004 : 0;
    // ?hide= / ?only= and PANELS. The brakes' meshes hang inside the wheels, so a part is hidden
    // mesh by mesh as well as by its group.
    for (const p of this.order) {
      const hidden = this.hidden.has(p.name);
      p.group.visible = !hidden && (p.category !== 'shell' || this.panelsT > 0.001);
      for (const m of p.meshes) m.visible = !hidden;
    }
    dissolve.value = this.panelsT;
  };
  car.update(0, { speed: 0, steer: 0 });
  root.updateMatrixWorld(true);
  return car;
}
