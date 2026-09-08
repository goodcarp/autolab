import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { App } from "../../../src/app/App";
import { configuratorMutations, configuratorStore, createConfiguratorStore, r2Catalog } from "../../../src/state";
import { ownerGuideBridge } from "../../../src/owner-guide/owner-guide-bridge";

vi.mock("../../../src/features/vehicle-canvas", () => ({
  VehicleCanvas: ({ headerAside }: { headerAside?: ReactNode }) => <div aria-label="Vehicle preview">{headerAside}</div>,
}));
vi.mock("../../../src/owner-guide/OwnerGuide", () => ({ OwnerGuide: () => null }));

beforeEach(() => {
  window.history.replaceState(null, "", "/configure/");
  ownerGuideBridge.setWorkspace("configure");
  configuratorStore.setState(createConfiguratorStore(r2Catalog).getState(), true);
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/configure/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openReview() {
  const trigger = screen.getByRole("button", { name: /Review.*RX2 build/ });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole("dialog", { name: "Review your RX2" }) };
}

describe("build review and sharing", () => {
  it("keeps the viewport total synchronized with option changes and the review total", () => {
    render(<App />);
    const total = screen.getByLabelText("Current vehicle total");
    expect(total).toHaveTextContent("$59,485");
    fireEvent.click(screen.getByRole("radio", { name: /Glacier White/i }));
    expect(total).toHaveTextContent("$60,485");
    expect(screen.getByRole("button", { name: /Review \$60,485 RX2 build/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Orchard Beach Silver/i }));
    expect(total).toHaveTextContent("$59,485");
    expect(screen.getByRole("button", { name: /Review \$59,485 RX2 build/ })).toBeInTheDocument();
  });

  it("moves and traps focus, locks the background, and restores focus after Escape", async () => {
    render(<App />);
    const { trigger, dialog } = openReview();
    const close = within(dialog).getByRole("button", { name: "Close build review" });
    const share = within(dialog).getByRole("button", { name: "Copy build link" });
    expect(close).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.querySelector(".autolab-surfaces")).toHaveAttribute("inert");
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(share).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review your RX2" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    expect(document.querySelector(".autolab-surfaces")).not.toHaveAttribute("inert");
  });

  it("recalculates buyer facts inside review and preserves edits through Back and Forward", async () => {
    render(<App />);
    const { dialog } = openReview();
    const buyer = within(dialog).getByText("Buyer details", { selector: "summary" });
    fireEvent.click(buyer);
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Your state" }), { target: { value: "CO" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Paying how" }), { target: { value: "yes" } });
    expect(configuratorStore.getState().domain.buyerContext).toMatchObject({ state: "CO", financing: true });
    const matched = dialog.querySelector('[data-tone="matched"]');
    expect(matched).not.toBeNull();
    expect(matched).toHaveAttribute("open");
    const editedUrl = window.location.href;
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review your RX2" })).not.toBeInTheDocument());
    expect(window.location.href).toBe(editedUrl);
    expect(configuratorStore.getState().domain.buyerContext).toMatchObject({ state: "CO", financing: true });
    act(() => window.history.forward());
    await screen.findByRole("dialog", { name: "Review your RX2" });
    expect(configuratorStore.getState().domain.buyerContext).toMatchObject({ state: "CO", financing: true });
  });

  it("shows a usable fallback link when clipboard permission fails, then permits retry", async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<App />);
    const { dialog } = openReview();
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy build link" }));
    const fallback = await within(dialog).findByRole("textbox", { name: "Build link" });
    expect(fallback).toHaveValue(window.location.href);
    expect(within(dialog).queryByRole("button", { name: "Build link copied" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy build link" }));
    await within(dialog).findByRole("button", { name: "Build link copied" });
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(within(dialog).queryByRole("textbox", { name: "Build link" })).not.toBeInTheDocument();
    expect(window.history.state).toMatchObject({ autolabReview: true });
  });

  it("prevents repeated clipboard requests while the current one is pending", async () => {
    let finish: (() => void) | undefined;
    const writeText = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<App />);
    const share = screen.getByRole("button", { name: "Share build" });
    fireEvent.click(share);
    fireEvent.click(share);
    expect(share).toBeDisabled();
    expect(writeText).toHaveBeenCalledTimes(1);
    await act(async () => { finish?.(); });
    expect(screen.getByRole("button", { name: "Link copied" })).toBeEnabled();
    fireEvent.click(screen.getByRole("radio", { name: /Forest Green/i }));
    expect(screen.getByRole("button", { name: "Share build" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Link copied" })).not.toBeInTheDocument();
  });

  it("retains the open review on a reload of its history entry", () => {
    window.history.replaceState({ autolabReview: true }, "", window.location.href);
    render(<App />);
    const dialog = screen.getByRole("dialog", { name: "Review your RX2" });
    expect(within(dialog).getByRole("button", { name: "Close build review" })).toHaveFocus();
  });

  it("returns to Shop after reviewing a build reached from a My Car deep link", async () => {
    ownerGuideBridge.setWorkspace("garage");
    render(<App />);
    expect(screen.getByRole("button", { name: "My Car" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Shop" }));
    const { dialog } = openReview();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close build review" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review your RX2" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Shop" })).toHaveAttribute("aria-pressed", "true");
    expect(new URL(window.location.href).searchParams.has("workspace")).toBe(false);
  });

  it("only offers agent Undo while it can restore that exact transaction", async () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: "Undo agent changes" })).not.toBeInTheDocument();
    await act(async () => {
      await configuratorMutations.applyAgentTransaction({ expectedRevision: 1, stages: [{ label: "Paint", patch: { set: { paint: ["paint.glacier_white"] } } }], stageDelayMs: 0 });
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo agent changes" }));
    expect(configuratorStore.getState().domain.selections.paint).toEqual(["paint.esker_silver"]);
    expect(screen.queryByRole("button", { name: "Undo agent changes" })).not.toBeInTheDocument();
    await act(async () => {
      await configuratorMutations.applyAgentTransaction({ expectedRevision: configuratorStore.getState().domain.revision, stages: [{ label: "Paint", patch: { set: { paint: ["paint.glacier_white"] } } }], stageDelayMs: 0 });
    });
    fireEvent.click(screen.getByRole("radio", { name: /Forest Green/i }));
    expect(screen.queryByRole("button", { name: "Undo agent changes" })).not.toBeInTheDocument();
    expect(configuratorStore.getState().domain.selections.paint).toEqual(["paint.forest_green"]);
  });
});
