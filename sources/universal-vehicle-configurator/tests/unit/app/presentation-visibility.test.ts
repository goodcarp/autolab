import { describe, expect, it, vi } from "vitest";
import type { ConfiguratorPresentationState } from "../../../src/webmcp/configurator-tools";
import {
  presentationSummary,
  revealAgentPresentation,
} from "../../../src/app/presentation-visibility";

function browserWindow(options: { stacked: boolean; reducedMotion?: boolean }) {
  return {
    matchMedia: vi.fn((query: string) => ({
      matches: query.includes("max-width")
        ? options.stacked
        : Boolean(options.reducedMotion),
    })) as unknown as Window["matchMedia"],
  };
}

describe("agent presentation visibility", () => {
  it("reveals changed presentations on stacked layouts without moving focus", () => {
    const scrollIntoView = vi.fn();
    const viewport = { scrollIntoView } as unknown as HTMLElement;

    expect(revealAgentPresentation(viewport, browserWindow({ stacked: true }))).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("uses an immediate reveal for reduced-motion users", () => {
    const scrollIntoView = vi.fn();
    const viewport = { scrollIntoView } as unknown as HTMLElement;

    revealAgentPresentation(
      viewport,
      browserWindow({ stacked: true, reducedMotion: true }),
    );

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("leaves the viewport alone in the always-visible split layout", () => {
    const scrollIntoView = vi.fn();
    const viewport = { scrollIntoView } as unknown as HTMLElement;

    expect(revealAgentPresentation(viewport, browserWindow({ stacked: false }))).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("describes the visible scene rather than implementation activity", () => {
    const state: ConfiguratorPresentationState = {
      revision: 4,
      mode: "blueprint",
      viewPreset: "profile",
      focus: "charge-port",
      bodyOpen: false,
    };

    expect(presentationSummary(state)).toBe(
      "Blueprint · profile view · charging focus",
    );
  });
});
