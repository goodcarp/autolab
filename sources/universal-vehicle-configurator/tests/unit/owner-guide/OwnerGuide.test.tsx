import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerGuide } from "../../../src/owner-guide/OwnerGuide";
import type { GuideState } from "../../../src/owner-guide/guide-actions";
import type { VehicleTwinCallOptions, VehicleTwinContext, VehicleTwinTool } from "../../../src/owner-guide/owner-guide-bridge";

const bridge = vi.hoisted(() => ({
  bindFrame: vi.fn(), markFrameReady: vi.fn(), requestFrame: vi.fn(),
  observeFrameRequest: vi.fn(() => () => {}), syncContext: vi.fn(),
  call: vi.fn(), setWorkspace: vi.fn(),
}));
vi.mock("../../../src/owner-guide/owner-guide-bridge", () => ({ ownerGuideBridge: bridge }));

const normal = (): GuideState => ({ selected: null, motions: { panels: false, open: false, explode: false }, tour: { running: false } });
const context: VehicleTwinContext = { build: "RX2 Performance", paint: "Launch Green", wheels: "20-inch All Terrain", interior: "Black Crater", rangeMiles: 307, vehicleTotal: 60000, revision: 1 };
let remote: GuideState;

beforeEach(() => {
  vi.clearAllMocks();
  remote = normal();
  bridge.syncContext.mockResolvedValue({ ok: true });
  bridge.call.mockImplementation(async (tool: VehicleTwinTool, args: Record<string, unknown> = {}, options?: VehicleTwinCallOptions) => {
    if (options?.signal?.aborted) throw options.signal.reason;
    if (tool === "reset") remote = normal();
    if (tool === "set_motion") remote.motions[args.motion as keyof GuideState["motions"]] = Boolean(args.on);
    if (tool === "highlight_part") remote.selected = String(args.part);
    if (tool === "start_tour") remote.tour = { running: true, title: "The structural battery" };
    if (tool === "stop_tour") remote.tour = { running: false };
    return structuredClone(remote);
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function ready() {
  const result = render(<OwnerGuide active context={context} />);
  fireEvent.load(screen.getByTitle("RX2 interactive digital twin and owner guide"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Battery" })).toBeEnabled());
  return result;
}

describe("My Car presentation and recovery", () => {
  it("shows exclusive pressed states, supports reassembly, and keeps Reset available", async () => {
    await ready();
    const battery = screen.getByRole("button", { name: "Battery" });
    const explode = screen.getByRole("button", { name: "Explode" });
    fireEvent.click(battery);
    await waitFor(() => expect(battery).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(explode);
    await waitFor(() => expect(explode).toHaveAttribute("aria-pressed", "true"));
    expect(battery).toHaveAttribute("aria-pressed", "false");
    expect(remote.selected).toBeNull();
    expect(remote.motions.panels).toBe(false);
    fireEvent.click(explode);
    await waitFor(() => expect(explode).toHaveAttribute("aria-pressed", "false"));
    expect(remote).toEqual(normal());
    expect(screen.getByRole("button", { name: "Reset view" })).toBeEnabled();
  });

  it("reflects external tour changes and turns Tour into a working Stop tour control", async () => {
    vi.useFakeTimers();
    render(<OwnerGuide active context={context} />);
    await act(async () => { fireEvent.load(screen.getByTitle("RX2 interactive digital twin and owner guide")); });
    remote = { selected: "battery", motions: { panels: true, open: false, explode: false }, tour: { running: true, title: "The structural battery" } };
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("button", { name: "Stop tour" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Battery" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Tour · The structural battery")).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Stop tour" })); });
    expect(bridge.call).toHaveBeenCalledWith("stop_tour", {}, expect.objectContaining({ trackActivity: false }));
    expect(screen.getByRole("button", { name: "Tour" })).toHaveAttribute("aria-pressed", "false");
    remote.tour = { running: true, title: "Exterior" };
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("button", { name: "Stop tour" })).toBeInTheDocument();
    expect(screen.getByText("Tour · Exterior")).toBeInTheDocument();
  });

  it("clears the running announcement when a locally started tour finishes remotely", async () => {
    vi.useFakeTimers();
    render(<OwnerGuide active context={context} />);
    await act(async () => { fireEvent.load(screen.getByTitle("RX2 interactive digital twin and owner guide")); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tour" })); });
    expect(screen.getByText("Tour · The structural battery")).toBeInTheDocument();
    remote = normal();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("button", { name: "Tour" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Drag to rotate · Pinch to zoom", { selector: "output" })).toBeInTheDocument();
    expect(screen.queryByText("Guided tour running")).not.toBeInTheDocument();
  });

  it.each([
    ["Battery", "Structural battery · body shell revealed"],
    ["Explode", "Exploded assembly · tap again to reassemble"],
    ["Openings", "Openings shown · tap again to close"],
  ])("clears a local %s announcement when an external reset restores the vehicle", async (button, announcement) => {
    vi.useFakeTimers();
    render(<OwnerGuide active context={context} />);
    await act(async () => { fireEvent.load(screen.getByTitle("RX2 interactive digital twin and owner guide")); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: button })); });
    expect(screen.getByText(announcement, { selector: "output" })).toBeInTheDocument();
    remote = normal();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("button", { name: button })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Drag to rotate · Pinch to zoom", { selector: "output" })).toBeInTheDocument();
    expect(screen.queryByText(announcement)).not.toBeInTheDocument();
  });

  it("Reset interrupts a pending Battery preset before later camera or highlight changes", async () => {
    await ready();
    const original = bridge.call.getMockImplementation()!;
    let pendingSignal: AbortSignal | undefined;
    bridge.call.mockImplementation((tool: VehicleTwinTool, args: Record<string, unknown>, options?: VehicleTwinCallOptions) => {
      if (tool !== "set_motion") return original(tool, args, options);
      pendingSignal = options?.signal;
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Battery" }));
    await waitFor(() => expect(pendingSignal).toBeDefined());
    expect(screen.getByRole("button", { name: "Explode" })).toBeDisabled();
    const reset = screen.getByRole("button", { name: "Reset view" });
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    await waitFor(() => expect(screen.getByRole("button", { name: "Battery" })).toBeEnabled());
    expect(pendingSignal?.aborted).toBe(true);
    expect(bridge.call.mock.calls.some(([tool]) => tool === "frame_part" || tool === "highlight_part")).toBe(false);
    expect(remote).toEqual(normal());
    expect(screen.getByText("Drag to rotate · Pinch to zoom")).toBeInTheDocument();
  });

  it("keeps shortcuts disabled on connection failure, offers Shop, and retries with a fresh frame", async () => {
    bridge.call.mockRejectedValue(new Error("Frame not ready"));
    render(<OwnerGuide active context={context} />);
    const oldFrame = screen.getByTitle("RX2 interactive digital twin and owner guide");
    fireEvent.load(oldFrame);
    const retry = await screen.findByRole("button", { name: "Retry drawing" });
    expect(screen.getByRole("button", { name: "Battery" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset view" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Return to Shop" }));
    expect(bridge.setWorkspace).toHaveBeenCalledWith("configure");
    bridge.call.mockResolvedValue(normal());
    fireEvent.click(retry);
    const newFrame = screen.getByTitle("RX2 interactive digital twin and owner guide");
    expect(newFrame).not.toBe(oldFrame);
    expect(screen.getByText("Drawing the vehicle…", { selector: "p" })).toBeInTheDocument();
    fireEvent.load(newFrame);
    // The controls commit before React necessarily flushes the context-sync
    // effect. Wait for both outcomes of successful recovery.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Battery" })).toBeEnabled();
      expect(bridge.syncContext).toHaveBeenCalledWith(context, { trackActivity: false });
    });
    expect(screen.queryByRole("button", { name: "Retry drawing" })).not.toBeInTheDocument();
  });

  it("offers recovery when iframe navigation never emits a load event", async () => {
    vi.useFakeTimers();
    render(<OwnerGuide active context={context} />);
    expect(screen.getByRole("button", { name: "Battery" })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole("button", { name: "Retry drawing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return to Shop" })).toBeInTheDocument();
    expect(screen.getByText("The drawing could not load. Please try again.", { selector: "p" })).toBeInTheDocument();
    expect(bridge.markFrameReady).not.toHaveBeenCalled();
    expect(bridge.call).not.toHaveBeenCalled();
  });

  it("turns a silent connection into recovery controls after fifteen seconds", async () => {
    vi.useFakeTimers();
    bridge.call.mockImplementation((_tool: VehicleTwinTool, _args: Record<string, unknown>, options?: VehicleTwinCallOptions) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    }));
    render(<OwnerGuide active context={context} />);
    fireEvent.load(screen.getByTitle("RX2 interactive digital twin and owner guide"));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(screen.getByRole("button", { name: "Retry drawing" })).toBeInTheDocument();
    expect(screen.getByText("The drawing could not load. Please try again.", { selector: "p" })).toBeInTheDocument();
  });
});
