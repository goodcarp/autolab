import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Box3, type Material, Mesh, MeshPhysicalMaterial, ShaderLib, type WebGLRenderer } from "three";
import { buildVehicle, SPEC } from "../../../src/scene/r2/vehicle.js";
import { dressForShowroom } from "../../../src/scene/r2/showroom";

describe("showroom rendering", () => {
  const vehicle = buildVehicle();
  let showroom: ReturnType<typeof dressForShowroom>;
  beforeAll(() => {
    showroom = dressForShowroom(vehicle, {
      paintColor: "#a0a4a6", rimFinish: "tungsten", caliperColor: "#222222",
      cabinColor: "#222222", lampsOn: true,
    });
    showroom.applyMaterials();
  });
  afterAll(() => {
    showroom.dispose();
    vehicle.root.traverse((object) => {
      if (object instanceof Mesh) object.geometry.dispose();
    });
  });

  it("cuts the same openings in visible panels and their shadow casters", () => {
    const panels = vehicle.order.flatMap(part => part.meshes)
      .filter(object => object.userData.cut) as Mesh[];
    expect(panels.length).toBeGreaterThan(0);
    for (const panel of panels) {
      expect(panel.customDepthMaterial).toBeDefined();
      for (const material of [panel.material as Material, panel.customDepthMaterial!]) {
        const shader = { ...ShaderLib.standard, uniforms: {} } as Parameters<Material["onBeforeCompile"]>[0];
        material.onBeforeCompile(shader, {} as WebGLRenderer);
        expect(shader.fragmentShader).toContain("if (inAperture(vObjPos)) discard;");
      }
    }
  });

  it("repaints cut shells and moving panels together without rebuilding materials", () => {
    // A render React discards must never replace materials in the live scene.
    const discarded = dressForShowroom(vehicle, {
      paintColor: "#ffffff", rimFinish: "blackSand", caliperColor: "#222222",
      cabinColor: "#222222", lampsOn: true,
    });
    showroom.paint.color.set("#123a6b");
    const paints: MeshPhysicalMaterial[] = [];
    showroom.forEachMaterial(material => {
      if (material.userData.finishRole === "paint") paints.push(material as MeshPhysicalMaterial);
    });
    expect(paints.length).toBeGreaterThan(1);
    for (const material of paints) expect(material.color).toBe(showroom.paint.color);
    const bodyPaint = (vehicle.parts.body.meshes[0] as Mesh).material as MeshPhysicalMaterial;
    expect(bodyPaint.color).toBe(showroom.paint.color);
    discarded.dispose();
  });

  it("keeps lamp optics and wheel housings within the vehicle envelope", () => {
    const bounds = new Box3().setFromObject(showroom.detail);
    expect(bounds.max.x).toBeLessThanOrEqual(SPEC.NOSE + 0.000001);
    expect(bounds.min.x).toBeGreaterThanOrEqual(SPEC.TAIL);
    expect(Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z))).toBeLessThan(SPEC.width / 2);
    expect(bounds.min.y).toBeGreaterThanOrEqual(0.2999);
  });

  it("keeps the rear window frames black when the body paint changes", () => {
    for (const id of ["doorRL", "doorRR"]) {
      const frame = vehicle.parts[id].meshes.find(mesh => mesh.userData.subId === 7) as Mesh;
      expect((frame.material as Material).userData.finishRole).toBe("gloss");
    }
  });
});
