import type { VehicleModelSourceId } from "./vehicle-model-source";

export type LiveVehicleViewPreset = "angle" | "profile" | "wheel" | "interior";
export type LiveVehicleFocus = "paint" | "charge-port" | "wheels" | "utility" | null;
export type LiveVehicleRenderMode = "showroom" | "blueprint";

export type LiveVehiclePaint = Readonly<{
  color: string;
}>;

export type LiveVehicleWheel = Readonly<{
  /** Catalog option id, so a body can render the exact finish being sold. */
  id?: string;
  diameterInches: number;
  style: "aero" | "terrain" | "sport";
}>;

export type LiveVehicleAccessories = Readonly<{
  towHitch: boolean;
}>;

export type LiveVehicleInterior = Readonly<{
  color: string;
  accentColor?: string;
  material?: "textile" | "vegan-leather" | "leather";
  tone?: "light" | "dark";
}>;

export type LiveVehicleViewportProps = Readonly<{
  paint: LiveVehiclePaint;
  wheel: LiveVehicleWheel;
  accessories: LiveVehicleAccessories;
  interior: LiveVehicleInterior;
  /** Which registered body draws the vehicle. Defaults to the licensed GLB. */
  modelSource?: VehicleModelSourceId;
  mode: LiveVehicleRenderMode;
  /** 0 shut, 1 fully open. Ignored by bodies that cannot open. */
  bodyOpen?: number;
  viewPreset: LiveVehicleViewPreset;
  focus: LiveVehicleFocus;
  keyboardOrbit: Readonly<{ yaw: number; pitch: number }>;
  resetRevision: number;
  reducedMotion: boolean;
  onReady: () => void;
  onFailure: (reason: string) => void;
  onInteraction: () => void;
}>;
