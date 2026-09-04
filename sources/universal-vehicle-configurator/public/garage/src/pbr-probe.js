// PBR probe — a throwaway experiment, enabled only with ?pbr=1.
//
// The question this answers: the body is lofted from hand-fitted section
// curves, and flat white Lambert hides curvature discontinuities completely.
// A reflective environment amplifies them into visible banding across a door
// skin. You cannot tell whether the surfacing is good enough until reflections
// are on, and that single fact decides whether a photoreal path is half a day
// or three days of resurfacing.
//
// Nothing here edits the blueprint pipeline. It swaps the stashed beauty
// materials, adds an environment, and monkeypatches render() to draw the scene
// straight to the canvas — skipping the G-buffer and the ink composite. Drop
// the ?pbr=1 and everything behaves exactly as before.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Part name → material role. Anything unlisted falls back by category.
const ROLE = {
  body: 'paint', hood: 'paint', tailgate: 'paint', pillars: 'paint',
  fasciaFront: 'paint', fasciaRear: 'paint',
  greenhouse: 'glass', roofGlass: 'glass',
  headlamps: 'lamp', lightBar: 'lamp', tailPills: 'lamp',
  cladding: 'trim', chargePort: 'trim',
  floor: 'trim', cargoFloor: 'trim', frunkFloor: 'trim',
};

const CATEGORY_ROLE = {
  shell: 'paint',
  chassis: 'metal',
  running: 'tyre',
  interior: 'cabin',
};

function makeMaterials(paintHex) {
  const paint = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(paintHex),
    metalness: 0.62,
    roughness: 0.30,
    // The clearcoat layer is what makes it read as automotive paint rather
    // than coloured plastic: a second specular lobe over the flake.
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.25,
    side: THREE.DoubleSide,
  });

  const glass = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#11181c'),
    metalness: 0.0,
    roughness: 0.06,
    transmission: 0.0,
    opacity: 0.62,
    transparent: true,
    envMapIntensity: 1.9,
    side: THREE.DoubleSide,
  });

  const lamp = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#eef6ff'),
    emissive: new THREE.Color('#cfe6ff'),
    emissiveIntensity: 0.35,
    metalness: 0.1,
    roughness: 0.12,
    envMapIntensity: 1.6,
    side: THREE.DoubleSide,
  });

  const trim = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#15181a'),
    metalness: 0.2,
    roughness: 0.72,
    envMapIntensity: 0.7,
    side: THREE.DoubleSide,
  });

  const metal = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#6d757a'),
    metalness: 0.9,
    roughness: 0.42,
    envMapIntensity: 1.0,
    side: THREE.DoubleSide,
  });

  const tyre = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#0e1113'),
    metalness: 0.0,
    roughness: 0.92,
    envMapIntensity: 0.4,
    side: THREE.DoubleSide,
  });

  const cabin = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#2a2d2b'),
    metalness: 0.05,
    roughness: 0.85,
    envMapIntensity: 0.6,
    side: THREE.DoubleSide,
  });

  return { paint, glass, lamp, trim, metal, tyre, cabin };
}

export function enablePbrProbe(bp, vehicle, paintHex = '#4A5D3A') {
  const mats = makeMaterials(paintHex);

  // Studio environment for reflections. Car paint is mostly reflection, so this
  // does more for realism than any amount of extra geometry.
  const pmrem = new THREE.PMREMGenerator(bp.renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  bp.scene.environment = env;
  bp.scene.background = null;

  // The blueprint path writes raw linear colour for its own composite; a real
  // render needs sRGB out and a filmic curve.
  bp.renderer.outputColorSpace = THREE.SRGBColorSpace;
  bp.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  bp.renderer.toneMappingExposure = 1.05;
  bp.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Softer, warmer key than the drawing pass wants.
  bp.sun.intensity = 2.4;
  const ambient = bp.scene.children.find((o) => o.isAmbientLight);
  if (ambient) ambient.intensity = 0.35;

  bp.ground.material = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d9d6cd'),
    roughness: 0.94,
    metalness: 0.0,
  });

  let swapped = 0;
  for (const part of vehicle.order) {
    const role = ROLE[part.name] ?? CATEGORY_ROLE[part.category] ?? 'trim';
    const material = mats[role] ?? mats.trim;
    for (const mesh of part.meshes) {
      mesh.userData.beautyMat = material;
      mesh.material = material;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      swapped += 1;
    }
  }

  // Straight to the canvas: no G-buffer, no ink composite.
  bp.render = (camera) => {
    const r = bp.renderer;
    r.setRenderTarget(null);
    r.setClearColor(0xf2f0e9, 1);
    r.clear(true, true, true);
    bp.ground.visible = true;
    r.render(bp.scene, camera);
  };

  return { swapped, roles: Object.keys(mats) };
}
