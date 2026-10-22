import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { ownerGuideBridge } from "../src/owner-guide/owner-guide-bridge";
import { configuratorPresentation } from "../src/webmcp/configurator-tools";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  ownerGuideBridge.setWorkspace("configure");
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
    // The status chip left with the top bar; the state is still announced.
    expect(await screen.findByText("Manual mode")).toHaveAttribute("role", "status");
  });

  it("has no top bar: the brand and site nav live in the viewport corner", () => {
    const { container } = render(<App />);
    expect(container.querySelector(".configurator-header")).toBeNull();
    expect(screen.queryByRole("button", { name: "Shop" })).toBeNull();
    expect(screen.queryByRole("button", { name: "My Car" })).toBeNull();
    const viewport = screen.getByRole("region", { name: "Interactive vehicle configurator" });
    const nav = within(viewport).getByRole("navigation", { name: "AutoLab" });
    expect(within(nav).getByRole("link", { name: "AutoLab" })).toHaveAttribute("href", "../");
    expect(within(nav).getByRole("link", { name: "Build" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Learn" })).toHaveAttribute("href", "../garage/");
    expect(within(nav).getByRole("link", { name: "Create" })).toHaveAttribute("href", "../engine/");
    // Share is an icon beside Reset view, with no visible label.
    const share = within(viewport).getByRole("button", { name: "Share build" });
    expect(share.textContent).toBe("");
    expect(share.closest(".vc-footer")).not.toBeNull();
    expect(screen.queryByText(/Live 3D/i)).toBeNull();
    expect(screen.queryByText("Drag to orbit")).toBeNull();
    expect(screen.queryByText("UVC / 01")).toBeNull();
  });

  it("returns from the My Car deep link to Build through the site nav", () => {
    ownerGuideBridge.setWorkspace("garage");
    const { container } = render(<App />);
    const shell = container.querySelector(".configurator-shell");
    expect(shell).toHaveAttribute("data-workspace", "garage");
    const guide = screen.getByRole("region", { name: "AutoLab Garage digital twin" });
    const build = within(guide).getByRole("link", { name: "Build" });
    expect(build).not.toHaveAttribute("aria-current");
    fireEvent.click(build);
    expect(shell).toHaveAttribute("data-workspace", "configure");
    expect(ownerGuideBridge.getWorkspace()).toBe("configure");
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
