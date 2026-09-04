import type { LiveVehicleWheel } from "./live-vehicle.types";

export type WheelVisualProfile = Readonly<{
  radius: number;
  rimRadius: number;
  spokeCount: number;
  spokeLength: number;
  spokeWidth: number;
  rimColor: string;
  tireRoughness: number;
}>;

export function getWheelVisualProfile(wheel: LiveVehicleWheel): WheelVisualProfile {
  const diameterScale = Math.min(Math.max(wheel.diameterInches / 21, 0.9), 1.1);
  const style = wheel.style;
  return {
    radius: (style === "terrain" ? 0.425 : 0.405) * diameterScale,
    rimRadius: (style === "terrain" ? 0.275 : 0.29) * diameterScale,
    spokeCount: style === "sport" ? 10 : style === "terrain" ? 6 : 5,
    spokeLength: style === "sport" ? 0.235 : style === "terrain" ? 0.215 : 0.245,
    spokeWidth: style === "sport" ? 0.025 : style === "terrain" ? 0.055 : 0.08,
    rimColor: style === "aero" ? "#9da5a0" : style === "sport" ? "#c4cbc6" : "#6f7772",
    tireRoughness: style === "terrain" ? 0.98 : 0.9,
  };
}
