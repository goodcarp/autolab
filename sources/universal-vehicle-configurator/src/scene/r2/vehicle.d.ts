import type { Group, Object3D, Vector3 } from "three";

/**
 * Declarations for the vendored R2 body.
 *
 * The builder is plain JavaScript carried over verbatim from the engineering
 * drawing so the two stay diffable; only the shape the configurator actually
 * consumes is typed here.
 */

export interface R2Part {
  name: string;
  label: string;
  desc: string;
  category: "shell" | "chassis" | "running" | "interior";
  id: number;
  group: Group;
  meshes: Object3D[];
  rest: Vector3;
  explode: Vector3;
}

export interface R2WheelRef {
  part: R2Part;
  spin: Group;
  sgn: 1 | -1;
  xa: number;
  front: boolean;
}

export interface R2UpdateState {
  time: number;
  speed: number;
  steer: number;
  run: boolean;
  drive: boolean;
}

export interface R2Vehicle {
  root: Group;
  body: Group;
  parts: Record<string, R2Part>;
  order: R2Part[];
  wheels: R2WheelRef[];
  hidden: Set<string>;
  SPEC: Readonly<Record<string, number>>;
  explodeT: number;
  openT: number;
  panelsT: number;
  spinAngle: number;
  update(dt: number, state: R2UpdateState): void;
}

export declare const SPEC: {
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  track: number;
  tireR: number;
  tireW: number;
  rimR: number;
  NOSE: number;
  TAIL: number;
  XF: number;
  XR: number;
};

export declare const CUT: Record<string, unknown>;
export declare function buildVehicle(): R2Vehicle;
