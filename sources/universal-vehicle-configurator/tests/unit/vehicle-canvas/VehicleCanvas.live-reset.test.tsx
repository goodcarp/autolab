import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/scene/webgl-support", () => ({
  detectWebGLSupport: () => "supported",
}));

vi.mock("../../../src/scene/LiveVehicleViewport", () => ({
  default: ({
    mode,
    onReady,
    resetRevision,
  }: Readonly<{
    mode: "showroom" | "blueprint";
    onReady: () => void;
    resetRevision: number;
  }>) => (
    <>
      <output
        data-testid="live-camera-reset-revision"
        data-render-mode={mode}
      >
        {resetRevision}
      </output>
      <button type="button" data-testid="signal-licensed-model-ready" onClick={onReady} />
    </>
  ),
}));

import { VehicleCanvas } from "../../../src/features/vehicle-canvas";

afterEach(cleanup);

describe("VehicleCanvas live camera reset contract", () => {
  it("increments the live reset revision even when authored pan is already zero", async () => {
    render(<VehicleCanvas defaultViewPreset="angle" />);

    const revision = await screen.findByTestId("live-camera-reset-revision");
    expect(revision).toHaveTextContent("0");

    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(revision).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(revision).toHaveTextContent("2");
  });

  it("waits for the licensed model and keeps Blueprint on the live renderer", async () => {
    render(<VehicleCanvas defaultViewPreset="profile" />);

    const liveScene = await screen.findByTestId("live-camera-reset-revision");
    const canvas = screen.getByRole("region", { name: "Interactive vehicle configurator" });
    const authoredProfile = screen
      .getByAltText(/Licensed compact electric SUV reference in side profile/i)
      .closest(".vc-profile-view");

    expect(canvas).toHaveAttribute("data-live-status", "loading");
    expect(canvas).not.toHaveAttribute("data-renderer", "live_3d");
    // While the live renderer is still loading, the authored still is what is
    // on screen, so it has to stay in the accessibility tree. Hiding it for
    // that window leaves a screen reader with nothing at all.
    expect(authoredProfile).toHaveAttribute("aria-hidden", "false");

    fireEvent.click(screen.getByTestId("signal-licensed-model-ready"));
    await waitFor(() => expect(canvas).toHaveAttribute("data-renderer", "live_3d"));

    fireEvent.click(screen.getByRole("button", { name: "Blueprint" }));
    expect(liveScene).toHaveAttribute("data-render-mode", "blueprint");
    expect(canvas).toHaveAttribute("data-renderer", "live_3d");
    // Once the live body is drawing, the still is decorative and stands down.
    expect(authoredProfile).toHaveAttribute("aria-hidden", "true");
  });
});
