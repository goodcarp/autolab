import { Vector3 } from "three";
import type { LiveVehicleFocus, LiveVehicleViewPreset } from "./live-vehicle.types";

export type CameraPose = Readonly<{
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  maxDistance: number;
  minDistance: number;
}>;

/**
 * Camera rigs, one per body.
 *
 * Poses are absolute positions in the vehicle's own coordinates, so they cannot
 * be shared between bodies of different size: the reference body is 4.22 m long
 * and 1.35 m tall, the R2 is 4.72 m and 1.70 m, and its wheels, charge port and
 * driver's eye are all somewhere else. Scaling one rig to fit the other frames
 * the exterior acceptably and puts the interior camera inside the dashboard, so
 * each body names its own rig instead.
 */
export type CameraRigId = "reference" | "r2";

interface CameraRig {
  poses: Record<LiveVehicleViewPreset, CameraPose>;
  focusPoses: Partial<Record<Exclude<LiveVehicleFocus, null>, CameraPose>>;
}

const REFERENCE: CameraRig = {
  poses: {
    angle: {
      position: [4.65, 1.95, 5.85],
      target: [0, 0.84, 0],
      minDistance: 4.9,
      maxDistance: 9,
    },
    profile: {
      position: [0, 1.55, 6.85],
      target: [0, 0.82, 0],
      minDistance: 5.3,
      maxDistance: 9.5,
    },
    wheel: {
      position: [1.38, 0.58, 3.9],
      target: [1.38, 0.37, 0.81],
      minDistance: 2.1,
      maxDistance: 5.5,
    },
    interior: {
      position: [-0.95, 1.33, -0.12],
      target: [0.72, 0.86, -0.04],
      minDistance: 0.6,
      maxDistance: 3.1,
    },
  },
  focusPoses: {
    utility: {
      position: [-5.25, 1.62, 4.35],
      target: [-2.28, 0.43, 0],
      minDistance: 3.4,
      maxDistance: 8,
    },
    "charge-port": {
      position: [3.6, 1.72, 4.4],
      target: [1.03, 1.12, 0.88],
      minDistance: 3.1,
      maxDistance: 8,
    },
    paint: {
      position: [4.45, 1.8, 5.35],
      target: [0.15, 1.05, 0],
      minDistance: 4.8,
      maxDistance: 9.5,
    },
  },
};

/**
 * The R2's rig, set against the drawing's own coordinates: wheel centres at
 * x +/-1.468 and z +/-0.82, the driver's hip at x -0.14 and z -0.40, the charge
 * port on the left rear quarter at x -2.09.
 */
// Low and close, so the rim fills the frame and the arch cladding reads over it.
const R2_WHEEL: CameraPose = {
  position: [2.35, 0.62, 2.85],
  target: [1.468, 0.42, 0.82],
  minDistance: 1.5,
  maxDistance: 5.4,
};

const R2: CameraRig = {
  poses: {
    // Launch-film framing: a front three-quarter from just above the belt
    // line, so the shoulder runs the length of the car and the roof stays a
    // sliver rather than a slab.
    angle: {
      position: [5.55, 1.62, 6.05],
      target: [0.05, 0.78, 0],
      minDistance: 5.6,
      maxDistance: 12,
    },
    profile: {
      position: [0, 1.28, 8.45],
      target: [-0.04, 0.84, 0],
      minDistance: 6.6,
      maxDistance: 12.5,
    },
    wheel: R2_WHEEL,
    // A cabin view, not a strict driver's eye. Sat at the front seats the dash
    // is 600 mm away and fills the frame with one slab; from between the rows,
    // slightly high and over the driver's shoulder, the whole front cabin reads
    // at once — wheel, dash, centre screen and both seats — which is what
    // someone choosing an interior is actually trying to see.
    interior: {
      position: [-1.42, 1.52, -0.52],
      target: [0.42, 0.92, 0.14],
      minDistance: 0.6,
      maxDistance: 3.4,
    },
  },
  focusPoses: {
    wheels: R2_WHEEL,
    utility: {
      position: [-6.05, 1.85, 4.30],
      target: [-2.35, 0.52, 0],
      minDistance: 3.8,
      maxDistance: 10,
    },
    "charge-port": {
      position: [-4.95, 1.70, -4.15],
      target: [-2.02, 0.86, -0.90],
      minDistance: 2.4,
      maxDistance: 8.5,
    },
    paint: {
      position: [5.15, 2.05, 5.95],
      target: [0.10, 1.02, 0],
      minDistance: 5.4,
      maxDistance: 11.5,
    },
  },
};

const RIGS: Record<CameraRigId, CameraRig> = { reference: REFERENCE, r2: R2 };

export function getCameraPose(
  preset: LiveVehicleViewPreset,
  focus: LiveVehicleFocus,
  orbit: Readonly<{ yaw: number; pitch: number }> = { yaw: 0, pitch: 0 },
  rig: CameraRigId = "reference",
): CameraPose {
  const { poses, focusPoses } = RIGS[rig] ?? REFERENCE;
  const base = preset === "profile"
    ? poses.profile
    : preset === "wheel"
      ? poses.wheel
      : preset === "interior"
        ? poses.interior
      : focus
        ? focusPoses[focus] ?? poses.angle
        : poses.angle;
  if (orbit.yaw === 0 && orbit.pitch === 0) return base;

  const target = new Vector3(...base.target);
  const offset = new Vector3(...base.position).sub(target);
  offset.applyAxisAngle(new Vector3(0, 1, 0), orbit.yaw);
  const horizontalAxis = new Vector3().crossVectors(offset, new Vector3(0, 1, 0)).normalize();
  offset.applyAxisAngle(horizontalAxis, orbit.pitch);
  const position = target.add(offset);

  return {
    ...base,
    position: [position.x, position.y, position.z],
  };
}
