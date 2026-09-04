import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial } from "three";
import { getCameraPose } from "../../../src/scene/camera-presets";
import {
  applyLicensedVehicleConfiguration,
  createLicensedVehicleBlueprintEdges,
  disposeLicensedVehicleBlueprintEdges,
  getLicensedWheelColors,
  getLicensedWheelRimScale,
  LICENSED_VEHICLE_MATERIAL_MAP,
  LICENSED_VEHICLE_NODE_MAP,
} from "../../../src/scene/licensed-vehicle-mapping";
import { createLoftGeometry } from "../../../src/scene/vehicle-geometry";
import { getWheelVisualProfile } from "../../../src/scene/vehicle-visuals";
import { detectWebGLSupport } from "../../../src/scene/webgl-support";

describe("live vehicle scene", () => {
  it("builds a closed, normalled continuous loft instead of stacked body primitives", () => {
    const geometry = createLoftGeometry([
      { x: -2, bottom: 0.3, shoulder: 1.2, top: 1.35, halfWidth: 0.9 },
      { x: 2, bottom: 0.4, shoulder: 1.05, top: 1.15, halfWidth: 0.7 },
    ]);

    expect(geometry.getAttribute("position").count).toBe(42);
    expect(geometry.getAttribute("normal").count).toBe(42);
    expect(geometry.index?.count).toBe(120);
    expect(geometry.boundingBox?.min.x).toBe(-2);
    expect(geometry.boundingBox?.max.x).toBe(2);
    geometry.dispose();
  });

  it("defines genuinely distinct camera compositions for every vehicle view", () => {
    const angle = getCameraPose("angle", null);
    const profile = getCameraPose("profile", null);
    const wheel = getCameraPose("wheel", null);
    const interior = getCameraPose("interior", null);

    expect(angle.position).not.toEqual(profile.position);
    expect(profile.position).not.toEqual(wheel.position);
    expect(interior.position).not.toEqual(angle.position);
    // Interior is no longer a tighter exterior shot: the camera sits inside the
    // cabin, so its entire dolly range is closer than the exterior views reach.
    expect(interior.maxDistance).toBeLessThan(angle.minDistance);
    expect(interior.position[1]).toBeGreaterThan(1);
    expect(Math.abs(interior.position[0])).toBeLessThan(1.6);
    expect(wheel.target[0]).toBeGreaterThan(1);
    expect(wheel.maxDistance).toBeLessThan(profile.maxDistance);
    expect(Math.hypot(
      wheel.position[0] - wheel.target[0],
      wheel.position[1] - wheel.target[1],
      wheel.position[2] - wheel.target[2],
    )).toBeGreaterThan(1.5);
    expect(wheel.position[0]).toBeCloseTo(wheel.target[0], 2);
  });

  it("keeps Profile square to the vehicle even when a prior focus remains active", () => {
    const cleanProfile = getCameraPose("profile", null);
    const focusedProfile = getCameraPose("profile", "paint");

    expect(focusedProfile).toEqual(cleanProfile);
    expect(focusedProfile.position[0]).toBe(0);
    expect(focusedProfile.target[0]).toBe(0);
  });

  it("moves the camera to configuration-linked focus points", () => {
    const chargePort = getCameraPose("angle", "charge-port");
    const utility = getCameraPose("angle", "utility");

    expect(chargePort.target[0]).toBeGreaterThan(0);
    expect(utility.target[0]).toBeLessThan(-2);
    expect(chargePort.position).not.toEqual(utility.position);
  });

  it("applies keyboard orbit without changing the camera-to-target distance", () => {
    const base = getCameraPose("angle", null);
    const moved = getCameraPose("angle", null, { yaw: 0.2, pitch: 0.08 });
    const distance = (pose: typeof base) => Math.hypot(
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    );

    expect(moved.position).not.toEqual(base.position);
    expect(distance(moved)).toBeCloseTo(distance(base), 8);
  });

  it("turns wheel size and style into visibly different live geometry", () => {
    const aero = getWheelVisualProfile({ diameterInches: 21, style: "aero" });
    const sport = getWheelVisualProfile({ diameterInches: 22, style: "sport" });
    const terrain = getWheelVisualProfile({ diameterInches: 20, style: "terrain" });

    expect(sport.radius).toBeGreaterThan(aero.radius);
    expect(sport.spokeCount).toBe(10);
    expect(terrain.spokeCount).toBe(6);
    expect(terrain.spokeWidth).not.toBe(aero.spokeWidth);
  });

  it("maps verified licensed body and wheel materials without changing stock tire geometry", () => {
    const root = new Group();
    const bodyMaterial = new MeshPhysicalMaterial({ color: "#ffffff" });
    bodyMaterial.name = LICENSED_VEHICLE_MATERIAL_MAP.paint;
    const body = new Mesh(new BoxGeometry(1, 1, 1), bodyMaterial);
    body.name = LICENSED_VEHICLE_NODE_MAP.body;

    const rimMaterial = new MeshStandardMaterial({ color: "#ffffff" });
    rimMaterial.name = LICENSED_VEHICLE_MATERIAL_MAP.rim;
    const rim = new Mesh(new BoxGeometry(1, 1, 1), rimMaterial);
    const tireMaterial = new MeshStandardMaterial({ color: "#111111" });
    tireMaterial.name = LICENSED_VEHICLE_MATERIAL_MAP.tire;
    const tire = new Mesh(new BoxGeometry(1, 1, 1), tireMaterial);
    root.add(body, rim, tire);

    applyLicensedVehicleConfiguration(
      root,
      { color: "#2f4436" },
      { diameterInches: 19, style: "sport" },
      "paint",
    );

    expect(bodyMaterial.color.getHexString()).toBe("2f4436");
    expect(bodyMaterial.clearcoat).toBe(1);
    expect(rim.scale.x).toBeCloseTo(getLicensedWheelRimScale(19));
    expect(tire.scale.x).toBe(1);
    expect(rimMaterial.color.getHexString()).toBe(
      new MeshStandardMaterial({ color: getLicensedWheelColors("sport").rim }).color.getHexString(),
    );

    body.geometry.dispose();
    rim.geometry.dispose();
    tire.geometry.dispose();
    bodyMaterial.dispose();
    rimMaterial.dispose();
    tireMaterial.dispose();
  });

  it("derives technical linework from the same licensed geometry and restores showroom paint", () => {
    const root = new Group();
    const geometry = new BoxGeometry(4, 1.5, 2);
    const bodyMaterial = new MeshPhysicalMaterial({ color: "#ffffff" });
    bodyMaterial.name = LICENSED_VEHICLE_MATERIAL_MAP.paint;
    const body = new Mesh(geometry, bodyMaterial);
    body.name = "Object_12";
    root.add(body);

    const edges = createLicensedVehicleBlueprintEdges(root);
    expect(edges.children).toHaveLength(1);
    expect(edges.children[0]?.name).toBe("BlueprintEdges:Object_12");
    expect(body.geometry).toBe(geometry);

    applyLicensedVehicleConfiguration(
      root,
      { color: "#2f4436" },
      { diameterInches: 21, style: "aero" },
      null,
      "blueprint",
    );
    expect(bodyMaterial.color.getHexString()).not.toBe("2f4436");
    expect(bodyMaterial.emissiveIntensity).toBeGreaterThan(0);

    applyLicensedVehicleConfiguration(
      root,
      { color: "#2f4436" },
      { diameterInches: 21, style: "aero" },
      null,
      "showroom",
    );
    expect(bodyMaterial.color.getHexString()).toBe("2f4436");
    expect(bodyMaterial.emissiveIntensity).toBe(0);
    expect(bodyMaterial.clearcoat).toBe(1);

    disposeLicensedVehicleBlueprintEdges(edges);
    geometry.dispose();
    bodyMaterial.dispose();
  });

  it("reports the authored fallback when WebGL is unavailable", () => {
    expect(detectWebGLSupport()).toBe("unsupported");
  });
});
