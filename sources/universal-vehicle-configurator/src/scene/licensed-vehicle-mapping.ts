import {
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
} from "three";
import type {
  LiveVehicleFocus,
  LiveVehiclePaint,
  LiveVehicleRenderMode,
  LiveVehicleWheel,
} from "./live-vehicle.types";

export const LICENSED_VEHICLE_NODE_MAP = {
  body: "Body",
  wheels: ["Wheel_0_0", "Wheel_0_1", "Wheel_1_0", "Wheel_1_1"],
  frontLights: ["Light_Low_Beam_Left_0", "Light_Low_Beam_Right_0"],
  rearLights: [
    "Light_Brake_Center_0",
    "Light_Brake_Left_0",
    "Light_Brake_Left_1",
    "Light_Brake_Right_0",
    "Light_Brake_Right_1",
    "Light_Tail_Left_0",
    "Light_Tail_Right_0",
  ],
  licensePlate: "License_Plate_0",
} as const;

export const LICENSED_VEHICLE_MATERIAL_MAP = {
  paint: "Body",
  glass: "BodyGlass",
  plastic: "BodyPlastic",
  mirror: "BodyMirror",
  frontLights: "Material.009",
  rearLights: "Material.007",
  tire: "MA_tire_003.001",
  rim: "Material.011",
  rimInset: "Material.012",
} as const;

type StandardMaterialSnapshot = Readonly<{
  color: number;
  emissive: number;
  emissiveIntensity: number;
  metalness: number;
  roughness: number;
  envMapIntensity: number;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  wireframe: boolean;
  clearcoat?: number;
  clearcoatRoughness?: number;
}>;

const BASE_MATERIAL_STATE = "uvcLicensedBaseMaterial";

const captureMaterialState = (material: Material) => {
  if (!(material instanceof MeshStandardMaterial)) return;
  const snapshot: StandardMaterialSnapshot = {
    color: material.color.getHex(),
    emissive: material.emissive.getHex(),
    emissiveIntensity: material.emissiveIntensity,
    metalness: material.metalness,
    roughness: material.roughness,
    envMapIntensity: material.envMapIntensity,
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
    wireframe: material.wireframe,
    ...(material instanceof MeshPhysicalMaterial
      ? {
          clearcoat: material.clearcoat,
          clearcoatRoughness: material.clearcoatRoughness,
        }
      : {}),
  };
  material.userData[BASE_MATERIAL_STATE] = snapshot;
};

const restoreMaterialState = (material: MeshStandardMaterial) => {
  const snapshot = material.userData[BASE_MATERIAL_STATE] as StandardMaterialSnapshot | undefined;
  if (!snapshot) {
    captureMaterialState(material);
    return;
  }
  material.color.setHex(snapshot.color);
  material.emissive.setHex(snapshot.emissive);
  material.emissiveIntensity = snapshot.emissiveIntensity;
  material.metalness = snapshot.metalness;
  material.roughness = snapshot.roughness;
  material.envMapIntensity = snapshot.envMapIntensity ?? 1;
  material.opacity = snapshot.opacity;
  material.transparent = snapshot.transparent;
  material.depthWrite = snapshot.depthWrite;
  material.wireframe = snapshot.wireframe;
  if (material instanceof MeshPhysicalMaterial) {
    material.clearcoat = snapshot.clearcoat ?? 0;
    material.clearcoatRoughness = snapshot.clearcoatRoughness ?? 0;
  }
};

const cloneMaterial = (material: Material, clones: Map<Material, Material>) => {
  const existing = clones.get(material);
  if (existing) return existing;
  const cloned = material.clone();
  captureMaterialState(cloned);
  clones.set(material, cloned);
  return cloned;
};

export function cloneLicensedVehicleScene(source: Group) {
  const clone = source.clone(true);
  const materialClones = new Map<Material, Material>();

  clone.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => cloneMaterial(material, materialClones))
      : cloneMaterial(object.material, materialClones);
    object.castShadow = true;
    object.receiveShadow = true;
  });

  clone.getObjectByName(LICENSED_VEHICLE_NODE_MAP.licensePlate)?.removeFromParent();
  return clone;
}

const forEachMaterial = (root: Group, callback: (material: Material) => void) => {
  const visited = new Set<Material>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (visited.has(material)) continue;
      visited.add(material);
      callback(material);
    }
  });
};

export function getLicensedWheelRimScale(diameterInches: number) {
  return Math.min(Math.max(diameterInches / 20, 0.94), 1.06);
}

export function getLicensedWheelColors(style: LiveVehicleWheel["style"]) {
  if (style === "terrain") return { rim: "#48504b", inset: "#141a17", roughness: 0.46 } as const;
  if (style === "sport") return { rim: "#c5cdc8", inset: "#4e5853", roughness: 0.18 } as const;
  return { rim: "#959e99", inset: "#252d29", roughness: 0.3 } as const;
}

const BODY_EDGE_MATERIALS = new Set([
  LICENSED_VEHICLE_MATERIAL_MAP.paint,
  "BodyAlt",
  "BodyAlt2",
  LICENSED_VEHICLE_MATERIAL_MAP.glass,
  LICENSED_VEHICLE_MATERIAL_MAP.plastic,
  LICENSED_VEHICLE_MATERIAL_MAP.mirror,
]);

export function createLicensedVehicleBlueprintEdges(root: Group) {
  const edgeRoot = new Group();
  edgeRoot.name = "LicensedVehicleBlueprintEdges";
  edgeRoot.visible = false;
  root.updateMatrixWorld(true);

  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some(({ name }) => BODY_EDGE_MATERIALS.has(name))) return;

    const geometry = new EdgesGeometry(object.geometry, 28);
    const material = new LineBasicMaterial({
      color: "#78e9ff",
      transparent: true,
      opacity: 0.84,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
    const lines = new LineSegments(geometry, material);
    lines.name = `BlueprintEdges:${object.name}`;
    lines.matrixAutoUpdate = false;
    lines.matrix.copy(object.matrixWorld);
    lines.frustumCulled = false;
    lines.renderOrder = 8;
    edgeRoot.add(lines);
  });

  return edgeRoot;
}

export function disposeLicensedVehicleBlueprintEdges(root: Group) {
  root.traverse((object) => {
    if (!(object instanceof LineSegments)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

const applyBlueprintMaterial = (
  material: MeshStandardMaterial,
  paint: LiveVehiclePaint,
  focus: LiveVehicleFocus,
) => {
  const isPaint = material.name === LICENSED_VEHICLE_MATERIAL_MAP.paint;
  const isGlass = material.name === LICENSED_VEHICLE_MATERIAL_MAP.glass;
  const isTire = material.name === LICENSED_VEHICLE_MATERIAL_MAP.tire;
  const isPlastic = material.name === LICENSED_VEHICLE_MATERIAL_MAP.plastic;
  const isRim = material.name === LICENSED_VEHICLE_MATERIAL_MAP.rim;
  const isRimInset = material.name === LICENSED_VEHICLE_MATERIAL_MAP.rimInset;
  const isLight = material.name === LICENSED_VEHICLE_MATERIAL_MAP.frontLights
    || material.name === LICENSED_VEHICLE_MATERIAL_MAP.rearLights;

  material.transparent = false;
  material.opacity = 1;
  material.depthWrite = true;
  material.wireframe = false;

  if (isLight) {
    material.color.set("#bff7ff");
    material.emissive.set("#5be2ff");
    material.emissiveIntensity = 2.1;
    material.metalness = 0.05;
    material.roughness = 0.24;
  } else if (isPaint) {
    material.color.copy(new Color("#0a3447").lerp(new Color(paint.color), 0.22));
    material.emissive.set(focus === "paint" ? "#1596b9" : "#0b6884");
    material.emissiveIntensity = focus === "paint" ? 0.62 : 0.34;
    material.metalness = 0.08;
    material.roughness = 0.38;
  } else if (isGlass) {
    material.color.set("#061923");
    material.emissive.set("#0c4054");
    material.emissiveIntensity = 0.25;
    material.metalness = 0.2;
    material.roughness = 0.16;
  } else if (isTire || isPlastic || isRimInset) {
    material.color.set("#071820");
    material.emissive.set("#0a3545");
    material.emissiveIntensity = 0.12;
    material.metalness = isRimInset ? 0.38 : 0.04;
    material.roughness = isTire ? 0.74 : 0.5;
  } else if (isRim) {
    material.color.set("#69c9d9");
    material.emissive.set("#185e73");
    material.emissiveIntensity = 0.28;
    material.metalness = 0.58;
    material.roughness = 0.24;
  } else {
    material.color.set("#0d3040");
    material.emissive.set("#0a4c61");
    material.emissiveIntensity = 0.2;
    material.metalness = 0.12;
    material.roughness = 0.44;
  }

  if (material instanceof MeshPhysicalMaterial) {
    material.clearcoat = 0.35;
    material.clearcoatRoughness = 0.28;
  }
};

export function applyLicensedVehicleConfiguration(
  root: Group,
  paint: LiveVehiclePaint,
  wheel: LiveVehicleWheel,
  focus: LiveVehicleFocus,
  mode: LiveVehicleRenderMode = "showroom",
) {
  const rimScale = getLicensedWheelRimScale(wheel.diameterInches);
  const wheelColors = getLicensedWheelColors(wheel.style);

  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const isRimPart = materials.some(({ name }) => (
      name === LICENSED_VEHICLE_MATERIAL_MAP.rim
      || name === LICENSED_VEHICLE_MATERIAL_MAP.rimInset
    ));
    if (isRimPart) object.scale.setScalar(rimScale);
  });

  forEachMaterial(root, (material) => {
    if (!(material instanceof MeshStandardMaterial)) return;

    restoreMaterialState(material);

    if (material.name === LICENSED_VEHICLE_MATERIAL_MAP.paint) {
      // Automotive paint is two layers: a flake base under a clear coat. The
      // previous 0.08 metalness made it one glossy dielectric, which reads as
      // coloured plastic however good the model is. Metalness stays moderate
      // because the studio environment is soft and a metal tints what it
      // reflects — push it high and the body goes muddy. The near-smooth
      // clearcoat is what supplies the sharp highlight.
      material.color.set(paint.color);
      material.metalness = 0.34;
      material.roughness = 0.29;
      material.envMapIntensity = 1.75;
      material.emissive.set(focus === "paint" ? paint.color : "#000000");
      material.emissiveIntensity = focus === "paint" ? 0.06 : 0;
      if (material instanceof MeshPhysicalMaterial) {
        material.clearcoat = 1;
        material.clearcoatRoughness = 0.035;
      }
    }

    if (material.name === LICENSED_VEHICLE_MATERIAL_MAP.glass) {
      material.color.set("#1b2c31");
      material.metalness = 0.05;
      material.roughness = 0.045;
      material.envMapIntensity = 2.1;
    }

    if (material.name === LICENSED_VEHICLE_MATERIAL_MAP.rim) {
      material.color.set(wheelColors.rim);
      material.metalness = 0.84;
      material.roughness = wheelColors.roughness;
    }

    if (material.name === LICENSED_VEHICLE_MATERIAL_MAP.rimInset) {
      material.color.set(wheelColors.inset);
      material.metalness = 0.72;
      material.roughness = Math.min(wheelColors.roughness + 0.08, 1);
    }

    if (material.name === LICENSED_VEHICLE_MATERIAL_MAP.frontLights) {
      material.color.set("#effff7");
      material.emissive.set("#d7fff0");
      material.emissiveIntensity = 1.45;
    }

    if (material.name === LICENSED_VEHICLE_MATERIAL_MAP.rearLights) {
      material.color.set("#d83a31");
      material.emissive.set("#ff3429");
      material.emissiveIntensity = 1.25;
    }

    if (mode === "blueprint") applyBlueprintMaterial(material, paint, focus);

    material.needsUpdate = true;
  });
}

export function disposeLicensedVehicleMaterials(root: Group) {
  forEachMaterial(root, (material) => material.dispose());
}
