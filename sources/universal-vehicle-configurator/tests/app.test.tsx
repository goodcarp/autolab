import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { configuratorPresentation } from "../src/webmcp/configurator-tools";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function useMobileMedia({ reducedMotion = false } = {}) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query.includes("max-width") ? true : reducedMotion,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

describe("vehicle configurator app", () => {
  it("renders the interactive vehicle and every configuration family in manual mode", async () => {
    render(<App />);
    expect(screen.getByRole("region", { name: "Interactive vehicle configurator" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Build" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Paint" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Wheels" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Interior" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Towing" })).toBeVisible();
    expect(await screen.findByText("Manual mode")).toBeVisible();
  });

  it("brings an agent-requested presentation into view on a stacked layout", () => {
    useMobileMedia();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    render(<App />);

    act(() => {
      configuratorPresentation.present({
        mode: "showroom",
        viewPreset: "profile",
        focus: "utility",
      });
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    const notice = screen.getByText("Agent moved the vehicle").closest("aside");
    expect(notice).toHaveAttribute("data-source", "agent");
    expect(screen.getByText("Rear utility")).toBeVisible();
    expect(screen.getByLabelText("Vehicle configuration workspace").querySelector(
      ".configurator-viewport",
    )).toHaveAttribute("data-has-focus-card", "utility");
  });

  it("does not steal scroll position for a person's own presentation control", () => {
    useMobileMedia();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    render(<App />);

    const presets = ["Angle", "Profile", "Wheel", "Interior"].map((name) =>
      screen.getByRole("button", { name }),
    );
    const unselectedPreset = presets.find((button) =>
      button.getAttribute("aria-pressed") === "false"
    );
    expect(unselectedPreset).toBeDefined();
    fireEvent.click(unselectedPreset as HTMLButtonElement);

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(screen.queryByText("Agent moved the vehicle")).not.toBeInTheDocument();
  });

  it("reveals agent presentations without smooth motion when reduced motion is preferred", () => {
    useMobileMedia({ reducedMotion: true });
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    render(<App />);

    const current = configuratorPresentation.getState();
    act(() => {
      configuratorPresentation.present({
        focus: current.focus === "paint" ? "wheels" : "paint",
      });
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });
});
