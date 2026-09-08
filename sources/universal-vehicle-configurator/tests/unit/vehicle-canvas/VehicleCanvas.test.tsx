import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VehicleCanvas,
  type VehicleInteriorSelection,
  type VehiclePaintSelection,
  type VehicleWheelSelection,
} from "../../../src/features/vehicle-canvas";

const clayPaint: VehiclePaintSelection = {
  id: "clay",
  label: "Warm clay",
  color: "#9b4f38",
  accuracy: "representative",
};

const sportWheel: VehicleWheelSelection = {
  id: "sport-22",
  label: "22-inch sport wheel",
  diameterInches: 22,
  style: "sport",
  accuracy: "representative",
};

const coastalInterior: VehicleInteriorSelection = {
  id: "interior.coastal_cloud",
  label: "Coastal Cloud Signature",
  color: "#e6e0d4",
  accentColor: "#b7a77e",
  material: "vegan-leather",
  tone: "light",
  accuracy: "representative",
};

afterEach(cleanup);

describe("VehicleCanvas", () => {
  it("keeps configuration controls available without substituting another car when WebGL is unavailable", () => {
    render(<VehicleCanvas />);

    expect(screen.getByRole("region", { name: "Interactive vehicle configurator" }))
      .toHaveAttribute("data-preset", "angle");
    expect(screen.getByRole("button", { name: "Angle" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Profile" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Wheel" })).toBeVisible();
    expect(within(screen.getByRole("status")).getByText("Vehicle view unavailable")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry preview" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Interactive vehicle configurator" }))
      .toHaveAttribute("data-renderer", "unavailable");
  });

  it("carries configuration-linked accessories into the render contract", () => {
    const { rerender } = render(<VehicleCanvas accessories={{ towHitch: false }} />);
    const canvas = screen.getByRole("region", { name: "Interactive vehicle configurator" });

    expect(canvas).not.toHaveAttribute("data-tow-hitch");
    rerender(<VehicleCanvas accessories={{ towHitch: true }} />);
    expect(canvas).toHaveAttribute("data-tow-hitch", "true");
  });

  it("visibly reflects parent-driven paint and wheel selections", () => {
    const { rerender } = render(<VehicleCanvas defaultViewPreset="profile" />);
    const canvas = screen.getByRole("region", { name: "Interactive vehicle configurator" });

    rerender(
      <VehicleCanvas
        defaultViewPreset="profile"
        paint={clayPaint}
        wheel={sportWheel}
      />,
    );

    expect(canvas).toHaveAttribute("data-paint", "clay");
    expect(canvas).toHaveAttribute("data-wheel", "sport-22");
    expect(canvas.style.getPropertyValue("--paint-color")).toBe("#9b4f38");
    expect(screen.getByText("Warm clay · 22 in")).toBeVisible();

  });

  it("keeps the selected interior readout without showing a reference cabin or still", () => {
    const { container, rerender } = render(<VehicleCanvas defaultViewPreset="interior" />);
    const canvas = screen.getByRole("region", { name: "Interactive vehicle configurator" });
    expect(canvas).toHaveAttribute("data-preset", "interior");
    expect(screen.getByRole("button", { name: "Interior" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("status")).getByText("Vehicle view unavailable")).toBeVisible();
    expect(container.querySelector("img, .vc-material-sample")).not.toBeInTheDocument();

    rerender(<VehicleCanvas defaultViewPreset="interior" interior={coastalInterior} />);
    expect(canvas).toHaveAttribute("data-interior", "interior.coastal_cloud");
    expect(canvas.style.getPropertyValue("--interior-color")).toBe("#e6e0d4");
    expect(screen.getByText("Coastal Cloud Signature · vegan-leather")).toBeVisible();
  });

  it("supports internal and callback-driven view and blueprint controls", () => {
    const onModeChange = vi.fn();
    const onViewPresetChange = vi.fn();
    render(
      <VehicleCanvas
        onModeChange={onModeChange}
        onViewPresetChange={onViewPresetChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Profile" }));
    expect(onViewPresetChange).toHaveBeenLastCalledWith("profile");
    expect(screen.getByRole("region", { name: "Interactive vehicle configurator" }))
      .toHaveAttribute("data-preset", "profile");

    // The visible Showroom/Blueprint switch left the chrome; the "b" key is the
    // in-page path (agents use the WebMCP presentation tools / `mode` prop).
    fireEvent.keyDown(screen.getByRole("application", { name: /Vehicle view unavailable/i }), { key: "b" });
    expect(onModeChange).toHaveBeenLastCalledWith("blueprint");
    expect(screen.getByRole("region", { name: "Interactive vehicle configurator" }))
      .toHaveAttribute("data-mode", "blueprint");
  });

  it("moves angle views to the truthful profile preset when blueprint is requested", () => {
    const onViewPresetChange = vi.fn();
    render(<VehicleCanvas defaultViewPreset="angle" onViewPresetChange={onViewPresetChange} />);

    // The visible Showroom/Blueprint switch left the chrome; the "b" key is the
    // in-page path (agents use the WebMCP presentation tools / `mode` prop).
    fireEvent.keyDown(screen.getByRole("application", { name: /Vehicle view unavailable/i }), { key: "b" });

    expect(onViewPresetChange).toHaveBeenCalledWith("profile");
    expect(screen.getByRole("region", { name: "Interactive vehicle configurator" }))
      .toHaveAttribute("data-preset", "profile");
  });

  it("moves interior views to profile before showing an exterior blueprint", () => {
    const onViewPresetChange = vi.fn();
    render(<VehicleCanvas defaultViewPreset="interior" onViewPresetChange={onViewPresetChange} />);

    // The visible Showroom/Blueprint switch left the chrome; the "b" key is the
    // in-page path (agents use the WebMCP presentation tools / `mode` prop).
    fireEvent.keyDown(screen.getByRole("application", { name: /Vehicle view unavailable/i }), { key: "b" });

    expect(onViewPresetChange).toHaveBeenCalledWith("profile");
    expect(screen.getByRole("region", { name: "Interactive vehicle configurator" }))
      .toHaveAttribute("data-preset", "profile");
  });

  it("reports no displayed vehicle when the renderer cannot run", () => {
    // jsdom has no WebGL, matching the unsupported-browser path.
    const onRenderedBodyChange = vi.fn();
    render(<VehicleCanvas onRenderedBodyChange={onRenderedBodyChange} />);

    expect(onRenderedBodyChange).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "unavailable",
        representsConfiguredVehicle: false,
        canOpen: false,
      }),
    );
    expect(screen.queryByRole("button", { name: /Open body/i })).not.toBeInTheDocument();
  });

  it("supports keyboard pan, blueprint toggle, and reset", () => {
    const onViewportChange = vi.fn();
    render(<VehicleCanvas defaultViewPreset="profile" onViewportChange={onViewportChange} />);
    const viewport = screen.getByRole("application", { name: /Vehicle view unavailable/i });

    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    expect(onViewportChange).toHaveBeenLastCalledWith(expect.objectContaining({ panX: 1.5 }));

    fireEvent.keyDown(viewport, { key: "b" });
    expect(screen.getByRole("region", { name: "Interactive vehicle configurator" }))
      .toHaveAttribute("data-mode", "blueprint");

    fireEvent.keyDown(viewport, { key: "Home" });
    expect(onViewportChange).toHaveBeenLastCalledWith(expect.objectContaining({ panX: 0, panY: 0 }));
  });

  it("pans from touch-style pointer input without stealing control clicks", () => {
    const onViewportChange = vi.fn();
    render(<VehicleCanvas defaultViewPreset="profile" onViewportChange={onViewportChange} />);
    const viewport = screen.getByRole("application", { name: /Vehicle view unavailable/i });
    Object.defineProperty(viewport, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 1_000,
        height: 600,
        right: 1_000,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    fireEvent.pointerDown(viewport, {
      pointerId: 7,
      pointerType: "touch",
      clientX: 300,
      clientY: 240,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 7,
      pointerType: "touch",
      clientX: 500,
      clientY: 300,
    });
    fireEvent.pointerUp(viewport, { pointerId: 7, pointerType: "touch" });

    const lastViewport = onViewportChange.mock.calls.at(-1)?.[0];
    expect(lastViewport?.panX).toBeCloseTo(3.6);
    expect(lastViewport?.panY).toBeCloseTo(1.2);
  });

  it("reports failed asset status without waiting for a fallback image to load", () => {
    const onAssetStatusChange = vi.fn();
    render(
      <VehicleCanvas
        defaultViewPreset="profile"
        onAssetStatusChange={onAssetStatusChange}
      />,
    );

    expect(within(screen.getByRole("status")).getByText("Vehicle view unavailable")).toBeVisible();
    expect(screen.getByText("Configuration controls remain active.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reset view" })).toBeEnabled();
    expect(onAssetStatusChange).toHaveBeenLastCalledWith("fallback");
  });
});
