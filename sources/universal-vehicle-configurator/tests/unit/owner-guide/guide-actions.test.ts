import { describe, expect, it, vi } from "vitest";
import { applyGuideAction, isGuideActionActive, type GuideState } from "../../../src/owner-guide/guide-actions";
import type { OwnerGuideBridge, VehicleTwinCallOptions, VehicleTwinTool } from "../../../src/owner-guide/owner-guide-bridge";

const normal = (): GuideState => ({
  selected: null,
  motions: { panels: false, open: false, explode: false },
  tour: { running: false },
});

function twin(initial = normal()) {
  let state = structuredClone(initial);
  const call = vi.fn(async (tool: VehicleTwinTool, args: Record<string, unknown> = {}, options?: VehicleTwinCallOptions) => {
    if (options?.signal?.aborted) throw options.signal.reason;
    if (tool === "reset") state = normal();
    if (tool === "set_motion") state.motions[args.motion as keyof GuideState["motions"]] = Boolean(args.on);
    if (tool === "highlight_part") state.selected = String(args.part);
    if (tool === "start_tour") state.tour = { running: true, title: "Battery" };
    if (tool === "stop_tour") state.tour = { running: false };
    return structuredClone(state);
  });
  return { bridge: { call } as Pick<OwnerGuideBridge, "call">, call, read: () => structuredClone(state) };
}

describe("reversible owner-guide shortcuts", () => {
  it("replaces Battery with Explode without leaving a dissolved shell or battery selection", async () => {
    const remote = twin();
    const battery = await applyGuideAction(remote.bridge, "battery", normal());
    expect(battery).toMatchObject({ selected: "battery", motions: { panels: true, explode: false } });
    const exploded = await applyGuideAction(remote.bridge, "explode", battery);
    expect(exploded).toEqual({ ...normal(), motions: { panels: false, open: false, explode: true } });
    expect(isGuideActionActive("battery", exploded)).toBe(false);
    expect(isGuideActionActive("explode", exploded)).toBe(true);
  });

  it.each(["battery", "open", "explode"] as const)("pressing %s again returns to the normal vehicle", async (action) => {
    const remote = twin();
    const enabled = await applyGuideAction(remote.bridge, action, normal());
    expect(isGuideActionActive(action, enabled)).toBe(true);
    const disabled = await applyGuideAction(remote.bridge, action, enabled);
    expect(disabled).toEqual(normal());
    expect(isGuideActionActive(action, disabled)).toBe(false);
  });

  it("Reset restores combined external presentation state and stops an active tour", async () => {
    const external: GuideState = { selected: "battery", motions: { panels: true, open: true, explode: true }, tour: { running: true } };
    const remote = twin(external);
    expect(await applyGuideAction(remote.bridge, "reset", external)).toEqual(normal());
  });

  it("stops an externally started tour and lets tour state take precedence over presentation buttons", async () => {
    const external: GuideState = { selected: "battery", motions: { panels: true, open: true, explode: true }, tour: { running: true } };
    const remote = twin(external);
    for (const action of ["battery", "open", "explode"] as const) expect(isGuideActionActive(action, external)).toBe(false);
    expect(isGuideActionActive("tour", external)).toBe(true);
    const stopped = await applyGuideAction(remote.bridge, "tour", external);
    expect(stopped.tour?.running).toBe(false);
    expect(remote.call.mock.calls.map(([tool]) => tool)).toEqual(["stop_tour", "get_state"]);
    const started = await applyGuideAction(remote.bridge, "tour", stopped);
    expect(started.tour?.running).toBe(true);
  });

  it("an aborted preset cannot dispatch later framing or highlighting mutations", async () => {
    const controller = new AbortController();
    const dispatched: VehicleTwinTool[] = [];
    const reason = new DOMException("Interrupted by Reset", "AbortError");
    const call = vi.fn(async (tool: VehicleTwinTool, _args?: Record<string, unknown>, options?: VehicleTwinCallOptions) => {
      if (options?.signal?.aborted) throw options.signal.reason;
      dispatched.push(tool);
      if (tool === "set_motion") controller.abort(reason);
      return normal();
    });
    await expect(applyGuideAction({ call } as Pick<OwnerGuideBridge, "call">, "battery", normal(), controller.signal)).rejects.toBe(reason);
    expect(dispatched).toEqual(["reset", "set_motion"]);
    expect(call.mock.calls.every(([, , options]) => options?.signal === controller.signal && options.trackActivity === false)).toBe(true);
  });
});
