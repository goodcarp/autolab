import type { OwnerGuideBridge } from "./owner-guide-bridge";

export type GuideAction = "battery" | "open" | "explode" | "tour" | "reset";
export type GuideState = {
  selected: string | null;
  motions: { panels: boolean; open: boolean; explode: boolean };
  tour?: { running: boolean; step?: number; title?: string | null };
};

export function isGuideActionActive(action: GuideAction, state: GuideState | null): boolean {
  if (!state) return false;
  if (action === "tour") return Boolean(state.tour?.running);
  if (state.tour?.running) return false;
  if (action === "battery") return state.motions.panels && state.selected === "battery";
  if (action === "open") return state.motions.open;
  if (action === "explode") return state.motions.explode;
  return false;
}

/** Human shortcuts are reversible presets, never a stack of hidden modes. */
export async function applyGuideAction(
  bridge: Pick<OwnerGuideBridge, "call">, action: GuideAction,
  state: GuideState | null, signal?: AbortSignal,
): Promise<GuideState> {
  const options = { signal, trackActivity: false };
  const call: OwnerGuideBridge["call"] = (tool, args = {}) => bridge.call(tool, args, options);
  if (action === "tour") {
    await call(isGuideActionActive(action, state) ? "stop_tour" : "start_tour");
  } else {
    const turnOff = isGuideActionActive(action, state);
    await call("reset");
    if (!turnOff && action === "battery") {
      await call("set_motion", { motion: "panels", on: true });
      await call("frame_part", { part: "battery", azimuth_deg: 12, elevation_deg: 38, margin: 1.1 });
      await call("highlight_part", { part: "battery" });
    } else if (!turnOff && action === "open") {
      await call("set_view", { view: "q34r" });
      await call("set_motion", { motion: "open", on: true });
    } else if (!turnOff && action === "explode") {
      await call("set_view", { view: "iso" });
      await call("set_motion", { motion: "explode", on: true });
    }
  }
  return call<GuideState>("get_state");
}
