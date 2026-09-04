import type { ConfiguratorPresentationState } from "../webmcp/configurator-tools";

export const STACKED_WORKSPACE_QUERY = "(max-width: 980px)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function presentationSummary(state: ConfiguratorPresentationState): string {
  const mode = state.mode === "blueprint" ? "Blueprint" : "Showroom";
  const view = state.viewPreset === "angle"
    ? "angle view"
    : state.viewPreset === "profile"
      ? "profile view"
      : state.viewPreset === "wheel"
        ? "wheel detail"
        : "interior view";
  const focus = state.focus === "none"
    ? ""
    : state.focus === "charge-port"
      ? " · charging focus"
      : ` · ${state.focus.replace("-", " ")} focus`;

  // An open body is the most visible thing on the canvas, so it belongs in a
  // summary that claims to describe what is on screen.
  const body = state.bodyOpen ? " · body open" : "";

  return `${mode} · ${view}${focus}${body}`;
}

export function revealAgentPresentation(
  viewport: HTMLElement | null,
  browserWindow: Pick<Window, "matchMedia"> = window,
): boolean {
  if (!viewport || typeof viewport.scrollIntoView !== "function") return false;
  if (typeof browserWindow.matchMedia !== "function") return false;
  if (!browserWindow.matchMedia(STACKED_WORKSPACE_QUERY).matches) return false;

  const reducedMotion = browserWindow.matchMedia(REDUCED_MOTION_QUERY).matches;
  viewport.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: "start",
  });
  return true;
}
