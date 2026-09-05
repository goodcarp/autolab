import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { fitCameraToAspect, getCameraPose } from "../../../src/scene/camera-presets";

describe("R2 exterior framing", () => {
  it("pulls the opening pose back along the existing bearing and elevation", () => {
    const pose = getCameraPose("angle", null, undefined, "r2");
    const previous = new Vector3(6.93, 1.83, 7.56).sub(new Vector3(...pose.target));
    const next = new Vector3(...pose.position).sub(new Vector3(...pose.target));
    expect(next.length() / previous.length()).toBeCloseTo(1.04);
    expect(next.normalize().distanceTo(previous.normalize())).toBeLessThan(1e-10);
  });

  it("compensates a narrow canvas without changing the target or constraining the pose", () => {
    const pose = getCameraPose("angle", null, undefined, "r2");
    expect(fitCameraToAspect(pose, 1.5)).toBe(pose);
    const phone = fitCameraToAspect(pose, 0.95);
    const distance = new Vector3(...phone.position).distanceTo(new Vector3(...phone.target));
    expect(phone.target).toEqual(pose.target);
    expect(distance).toBeGreaterThan(phone.minDistance);
    expect(distance).toBeLessThan(phone.maxDistance);
    expect(phone.maxDistance / pose.maxDistance).toBeCloseTo(1.205 / 0.95);
  });
});
