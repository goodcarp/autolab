import { cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { useGLTF } from "@react-three/drei";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VehicleModelBoundary } from "../../../src/scene/LiveVehicleViewport";
import {
  createVehicleModelComponent,
  LICENSED_VEHICLE_MODEL_URL,
  resolveVehicleModelSource,
  type VehicleModelProps,
} from "../../../src/scene/vehicle-model-source";

const imports = vi.hoisted(() => ({ rejectR2: true, licensed: 0 }));
vi.mock("../../../src/scene/R2VehicleModel", () => ({
  // Reject the lazy loader after import resolution, then let the next fresh
  // wrapper load it. The original wrapper must retain its rejected promise.
  get R2VehicleModel() {
    if (imports.rejectR2) throw new Error("Body chunk unavailable");
    return () => <div>Loaded R2 body</div>;
  },
}));
vi.mock("../../../src/scene/LicensedVehicleModel", () => {
  imports.licensed += 1;
  return { LicensedVehicleModel: () => <div>Licensed reference body</div> };
});

const modelProps: VehicleModelProps = {
  paint: { color: "#a0a4a6" },
  wheel: { diameterInches: 20, style: "aero" },
  accessories: { towHitch: false },
  focus: null,
  mode: "showroom",
  onReady: () => {},
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("vehicle model load recovery", () => {
  it("retries a rejected body loader with a fresh viewport component without importing the licensed reference", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const source = resolveVehicleModelSource();
    const FirstBody = createVehicleModelComponent();
    const first = render(<VehicleModelBoundary fallback={<p>Load failed</p>} onFailure={() => {}}>
      <Suspense fallback={<p>Loading</p>}><FirstBody {...modelProps} /></Suspense>
    </VehicleModelBoundary>);
    await screen.findByText("Load failed");
    first.unmount();

    imports.rejectR2 = false;
    const NextBody = createVehicleModelComponent();
    render(<VehicleModelBoundary fallback={<p>Load failed</p>} onFailure={() => {}}>
      <Suspense fallback={<p>Loading</p>}><NextBody {...modelProps} /></Suspense>
    </VehicleModelBoundary>);
    await screen.findByText("Loaded R2 body");
    expect(imports.licensed).toBe(0);
    expect(resolveVehicleModelSource()).toBe(source);
  });

  it.each(["r2-engineering", "licensed-glb"] as const)("clears only a failed licensed GLTF before exposing recovery (%s)", (modelSource) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const clear = vi.spyOn(useGLTF, "clear").mockImplementation(() => {});
    const onFailure = vi.fn(() => {
      if (modelSource === "licensed-glb") expect(clear).toHaveBeenCalledWith(LICENSED_VEHICLE_MODEL_URL);
      else expect(clear).not.toHaveBeenCalled();
    });
    function FailedModel(): never { throw new Error("Model load failed"); }
    render(<VehicleModelBoundary modelSource={modelSource} fallback={<p>Load failed</p>} onFailure={onFailure}>
      <FailedModel />
    </VehicleModelBoundary>);
    expect(screen.getByText("Load failed")).toBeVisible();
    expect(onFailure).toHaveBeenCalledWith("Model load failed");
  });
});
