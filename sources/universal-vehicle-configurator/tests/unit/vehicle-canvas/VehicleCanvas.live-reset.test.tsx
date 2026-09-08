import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveVehicleViewportProps } from "../../../src/scene/live-vehicle.types";

const sceneMock = vi.hoisted(() => ({
  props: null as LiveVehicleViewportProps | null,
  failDuringRender: false,
}));

vi.mock("../../../src/scene/webgl-support", () => ({
  detectWebGLSupport: () => "supported",
}));

vi.mock("../../../src/scene/LiveVehicleViewport", () => ({
  default: (props: LiveVehicleViewportProps) => {
    sceneMock.props = props;
    if (sceneMock.failDuringRender) throw new Error("Renderer could not initialize");
    return (
      <>
        <output data-testid="live-camera-reset-revision" data-render-mode={props.mode} data-model-source={props.modelSource}>
          {props.resetRevision}
        </output>
        <button type="button" data-testid="signal-model-ready" onClick={props.onReady} />
        <button type="button" data-testid="signal-model-failure" onClick={() => props.onFailure("WebGL context lost")} />
      </>
    );
  },
}));

import { VehicleCanvas } from "../../../src/features/vehicle-canvas";

afterEach(() => {
  cleanup();
  sceneMock.props = null;
  sceneMock.failDuringRender = false;
  vi.restoreAllMocks();
});

function expectNoReferenceArtwork(container: HTMLElement) {
  // Hidden <img> elements still download and can flash as CSS/live state changes.
  // Absence, rather than opacity/aria-hidden, protects every startup path.
  expect(container.querySelector("img, .layered-vehicle-frame, .vc-angle-view, .vc-profile-view"))
    .not.toBeInTheDocument();
  expect(container.innerHTML).not.toMatch(/EX30|images\/layered|showroom-fallback|vehicle-side/u);
}

describe("VehicleCanvas live loading and camera contract", () => {
  it("increments the live reset revision even when pan is already zero", async () => {
    render(<VehicleCanvas defaultViewPreset="angle" />);
    const revision = await screen.findByTestId("live-camera-reset-revision");
    expect(revision).toHaveTextContent("0");
    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(revision).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(revision).toHaveTextContent("2");
  });

  it("shows only a neutral loading state for every preset, then the requested RX2 with live Blueprint", async () => {
    const describeBody = vi.fn();
    const { container } = render(<VehicleCanvas onRenderedBodyChange={describeBody} />);
    const liveScene = await screen.findByTestId("live-camera-reset-revision");
    const canvas = screen.getByRole("region", { name: "Interactive vehicle configurator" });
    for (const name of ["Angle", "Profile", "Wheel", "Interior"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(canvas).toHaveAttribute("data-renderer", "loading");
      expect(canvas).toHaveAttribute("aria-busy", "true");
      expectNoReferenceArtwork(container);
      expect(container.querySelector(".vc-interior-view")).not.toBeInTheDocument();
    }
    expect(describeBody).toHaveBeenLastCalledWith(expect.objectContaining({
      id: "loading", representsConfiguredVehicle: false, canOpen: false,
    }));
    fireEvent.click(screen.getByTestId("signal-model-ready"));
    await waitFor(() => expect(canvas).toHaveAttribute("data-renderer", "live_3d"));
    expect(canvas).toHaveAttribute("aria-busy", "false");
    expect(liveScene).toHaveAttribute("data-model-source", "r2-engineering");
    expect(describeBody).toHaveBeenLastCalledWith(expect.objectContaining({
      id: "r2-engineering", representsConfiguredVehicle: true,
    }));
    expect(screen.getByLabelText("Black Crater representative interior material preview")).toBeVisible();
    expectNoReferenceArtwork(container);
    fireEvent.keyDown(screen.getByRole("application"), { key: "b" });
    expect(liveScene).toHaveAttribute("data-render-mode", "blueprint");
    expect(canvas).toHaveAttribute("data-renderer", "live_3d");
    expectNoReferenceArtwork(container);
  });

  it.each([false, true])("keeps renderer failure neutral (previously ready: %s), including late ready callbacks", async (previouslyReady) => {
    const describeBody = vi.fn();
    const onAssetStatusChange = vi.fn();
    const { container } = render(<VehicleCanvas onRenderedBodyChange={describeBody} onAssetStatusChange={onAssetStatusChange}
      headerAside={<div aria-label="Current vehicle total">$48,790</div>} />);
    await screen.findByTestId("live-camera-reset-revision");
    const staleReady = sceneMock.props!.onReady;
    if (previouslyReady) fireEvent.click(screen.getByTestId("signal-model-ready"));
    fireEvent.click(screen.getByTestId("signal-model-failure"));
    const canvas = screen.getByRole("region", { name: "Interactive vehicle configurator" });
    expect(canvas).toHaveAttribute("data-renderer", "unavailable");
    expect(canvas).toHaveAttribute("aria-busy", "false");
    expect(within(screen.getByRole("status")).getByText("Vehicle view unavailable")).toBeVisible();
    expect(screen.getByLabelText("Current vehicle total").closest(".vc-hud")).toBeInTheDocument();
    expect(screen.queryByTestId("live-camera-reset-revision")).not.toBeInTheDocument();
    expect(describeBody).toHaveBeenLastCalledWith(expect.objectContaining({ id: "unavailable", representsConfiguredVehicle: false, canOpen: false }));
    expect(onAssetStatusChange).toHaveBeenLastCalledWith("fallback");
    act(staleReady);
    for (const name of ["Profile", "Wheel", "Interior", "Angle"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(canvas).toHaveAttribute("data-renderer", "unavailable");
      expectNoReferenceArtwork(container);
    }
  });

  it("retries a failed renderer with a fresh attempt and ignores the failed attempt's callbacks", async () => {
    const { container } = render(<VehicleCanvas />);
    await screen.findByTestId("live-camera-reset-revision");
    const failedAttempt = sceneMock.props!;
    fireEvent.click(screen.getByTestId("signal-model-failure"));
    const retry = screen.getByRole("button", { name: "Retry preview" });
    retry.focus();
    fireEvent.click(retry);
    const canvas = screen.getByRole("region", { name: "Interactive vehicle configurator" });
    expect(canvas).toHaveAttribute("data-renderer", "loading");
    expect(screen.getByRole("application")).toHaveFocus();
    expectNoReferenceArtwork(container);
    await screen.findByTestId("live-camera-reset-revision");
    act(() => {
      failedAttempt.onReady();
      failedAttempt.onFailure("Late error");
    });
    expect(canvas).toHaveAttribute("data-renderer", "loading");
    fireEvent.click(screen.getByTestId("signal-model-ready"));
    expect(canvas).toHaveAttribute("data-renderer", "live_3d");
    expectNoReferenceArtwork(container);
  });

  it("catches a renderer initialization exception without falling back to another car", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sceneMock.failDuringRender = true;
    const { container } = render(<VehicleCanvas />);
    await waitFor(() => expect(screen.getByRole("region", { name: "Interactive vehicle configurator" })).toHaveAttribute("data-live-status", "failed"));
    expect(within(screen.getByRole("status")).getByText("Vehicle view unavailable")).toBeVisible();
    expectNoReferenceArtwork(container);
  });

  it("does not carry readiness or delayed callbacks across model source changes", async () => {
    const describeBody = vi.fn();
    const { rerender } = render(<VehicleCanvas modelSource="r2-engineering" onRenderedBodyChange={describeBody} />);
    await screen.findByTestId("live-camera-reset-revision");
    const original = sceneMock.props!;
    fireEvent.click(screen.getByTestId("signal-model-ready"));
    rerender(<VehicleCanvas modelSource="licensed-glb" onRenderedBodyChange={describeBody} />);
    const canvas = screen.getByRole("region", { name: "Interactive vehicle configurator" });
    expect(canvas).toHaveAttribute("data-renderer", "loading");
    expect(describeBody).toHaveBeenLastCalledWith(expect.objectContaining({ id: "loading" }));
    act(() => original.onFailure("Old renderer closed"));
    expect(canvas).toHaveAttribute("data-renderer", "loading");
    await screen.findByTestId("signal-model-ready");
    fireEvent.click(screen.getByTestId("signal-model-ready"));
    expect(describeBody).toHaveBeenLastCalledWith(expect.objectContaining({ id: "licensed-glb", representsConfiguredVehicle: false }));
    rerender(<VehicleCanvas modelSource="r2-engineering" onRenderedBodyChange={describeBody} />);
    act(original.onReady);
    expect(canvas).toHaveAttribute("data-renderer", "loading");
    await screen.findByTestId("signal-model-ready");
    fireEvent.click(screen.getByTestId("signal-model-ready"));
    expect(describeBody).toHaveBeenLastCalledWith(expect.objectContaining({ id: "r2-engineering", representsConfiguredVehicle: true }));
  });

  it("keeps live interior material and focus details tied to the selected configuration", async () => {
    const onHotspotChange = vi.fn();
    const { rerender } = render(<VehicleCanvas defaultViewPreset="interior" onHotspotChange={onHotspotChange} />);
    await screen.findByTestId("live-camera-reset-revision");
    fireEvent.click(screen.getByTestId("signal-model-ready"));
    rerender(<VehicleCanvas defaultViewPreset="interior" onHotspotChange={onHotspotChange}
      interior={{ id: "coastal", label: "Coastal Cloud", color: "#e6e0d4", material: "vegan-leather", tone: "light" }} />);
    expect(screen.getByLabelText("Coastal Cloud representative interior material preview")).toHaveAttribute("data-interior-material", "vegan-leather");
    fireEvent.click(screen.getByRole("button", { name: "Profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Focus Exterior finish" }));
    expect(onHotspotChange).toHaveBeenLastCalledWith("paint");
    expect(screen.getByText("Exterior finish")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onHotspotChange).toHaveBeenLastCalledWith(null);
  });
});
