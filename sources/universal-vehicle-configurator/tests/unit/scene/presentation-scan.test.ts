import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, ShaderLib, type WebGLRenderer } from "three";
import { createPresentationScan } from "../../../src/scene/r2/presentation-scan";
import { buildVehicle } from "../../../src/scene/r2/vehicle.js";
import { dressForShowroom } from "../../../src/scene/r2/showroom";

function fixture() {
  const root = new Group();
  const material = new MeshStandardMaterial();
  const mesh = new Mesh(new BoxGeometry(4.72, 1.7, 1.9), material);
  root.add(mesh);
  const scan = createPresentationScan([root], [material]);
  scan.attach();
  const wire = mesh.children[0] as Mesh<BoxGeometry, MeshStandardMaterial>;
  return { root, material, mesh, scan, wire };
}

function compile(material: MeshStandardMaterial) {
  const shader = {
    vertexShader: ShaderLib.standard.vertexShader,
    fragmentShader: ShaderLib.standard.fragmentShader,
    uniforms: {},
  } as Parameters<typeof material.onBeforeCompile>[0];
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return shader;
}

describe("material presentation scan", () => {
  it("sweeps in 1.1 seconds and returns to the original wireframe/solid endpoints without extra draws", () => {
    const { scan, material, wire } = fixture();
    scan.setBlueprint(true, false, 100);
    expect(scan.advance(600)).toBe(true);
    expect(scan.progress).toBeCloseTo(500 / 1100);
    expect(wire.visible).toBe(true);
    expect(material.wireframe).toBe(false);
    expect(scan.advance(1200)).toBe(false);
    expect(material.wireframe).toBe(true);
    expect(wire.visible).toBe(false);
    expect(scan.advance(9999)).toBe(false);
    scan.setBlueprint(false, false, 10000);
    scan.advance(10500);
    expect(scan.progress).toBeCloseTo(1 - 500 / 1100);
    expect(scan.advance(11100)).toBe(false);
    expect(material.wireframe).toBe(false);
    scan.dispose();
  });

  it("reverses without jumping and repeated requests do not restart the sweep", () => {
    const { scan } = fixture();
    scan.setBlueprint(true, false, 0);
    scan.setBlueprint(true, false, 250);
    scan.setBlueprint(false, false, 550);
    expect(scan.progress).toBe(0.5);
    scan.advance(825);
    expect(scan.progress).toBe(0.25);
    expect(scan.advance(1100)).toBe(false);
    expect(scan.progress).toBe(0);
    scan.dispose();
  });

  it("snaps both ways under reduced motion, including a preference change mid-scan", () => {
    const { scan, material, wire } = fixture();
    scan.setBlueprint(true, false, 0);
    scan.setBlueprint(true, true, 500);
    expect(scan.progress).toBe(1);
    expect(scan.active).toBe(false);
    expect(material.wireframe).toBe(true);
    expect(wire.visible).toBe(false);
    scan.setBlueprint(false, true, 600);
    expect(scan.progress).toBe(0);
    expect(scan.advance(1000)).toBe(false);
    scan.dispose();
  });

  it("preserves the real shell aperture/flake patches on both complementary passes", () => {
    const vehicle = buildVehicle();
    const showroom = dressForShowroom(vehicle, {
      paintColor: "#c0bdb8", paintId: "paint.esker_silver", rimFinish: "tungsten",
      caliperColor: "#222222", cabinColor: "#222222", lampsOn: true,
    });
    showroom.scan.attach();
    showroom.scan.setBlueprint(true, false, 0);
    const shell = vehicle.parts.body.meshes[0] as Mesh<BoxGeometry, MeshStandardMaterial>;
    const wire = shell.children.find((child) => child.name === "PresentationScanWire") as Mesh<BoxGeometry, MeshStandardMaterial>;
    for (const material of [shell.material, wire.material]) {
      const shader = compile(material);
      expect(shader.fragmentShader).toContain("if (inAperture(vObjPos)) discard;");
      expect(shader.fragmentShader).toContain("uniform float uFlake;");
      expect(shader.vertexShader).toContain("modelMatrix * vec4(transformed, 1.0)");
    }
    expect(compile(shell.material).fragmentShader).toContain("vScanX <= uScanFront) discard;");
    expect(compile(wire.material).fragmentShader).toContain("vScanX > uScanFront) discard;");
    expect(shell.material.customProgramCacheKey()).not.toBe(wire.material.customProgramCacheKey());
    showroom.dispose();
    vehicle.root.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose(); });
  });

  it("tracks refitted geometry, refreshes materials, and disposes only owned resources", () => {
    const { scan, material, mesh, wire } = fixture();
    const originalGeometry = mesh.geometry;
    const disposeGeometry = vi.spyOn(originalGeometry, "dispose");
    const disposeMaterial = vi.spyOn(material, "dispose");
    const disposeWire = vi.spyOn(wire.material, "dispose");
    mesh.geometry = new BoxGeometry(4, 1, 2);
    material.color.set("#336699");
    scan.setBlueprint(true, false, 0);
    expect(wire.geometry).toBe(mesh.geometry);
    expect(wire.material.color.equals(material.color)).toBe(true);
    scan.dispose();
    expect(mesh.children).toHaveLength(0);
    expect(disposeWire).toHaveBeenCalledOnce();
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(disposeMaterial).not.toHaveBeenCalled();
    originalGeometry.dispose();
    mesh.geometry.dispose();
    material.dispose();
  });

  it("restores complementary hooks when StrictMode replays setup after cleanup", () => {
    const { scan, material, mesh, wire } = fixture();
    scan.dispose();
    expect(compile(material).fragmentShader).not.toContain("uScanFront");
    scan.attach();
    scan.setBlueprint(true, false, 0);
    scan.advance(500);
    expect(mesh.children).toEqual([wire]);
    expect(compile(material).fragmentShader).toContain("vScanX <= uScanFront) discard;");
    expect(compile(wire.material).fragmentShader).toContain("vScanX > uScanFront) discard;");
    scan.dispose();
    mesh.geometry.dispose();
    material.dispose();
  });
});
