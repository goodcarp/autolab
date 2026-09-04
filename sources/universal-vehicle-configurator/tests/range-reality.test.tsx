import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RangeRealityPrototype } from "../src/features/range-reality/RangeRealityPrototype";
import { RANGE_REALITY_FIXTURE } from "../src/features/range-reality/range-fixtures";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Range Reality prototype", () => {
  it("plays the 307 to 330 mile blueprint story to completion", () => {
    vi.useFakeTimers();
    render(<RangeRealityPrototype />);

    fireEvent.click(screen.getByRole("button", { name: "Explain this build" }));
    expect(screen.getByText("Aligning profile")).toBeVisible();

    act(() => vi.advanceTimersByTime(700));
    expect(screen.getByText("Resolving configuration")).toBeVisible();

    act(() => vi.advanceTimersByTime(4_750));
    expect(screen.getByText("Blueprint complete")).toBeVisible();
    expect(screen.getByText("307 → 330 miles")).toBeVisible();
    expect(screen.getByText((_, element) =>
      element?.tagName === "STRONG" && element.textContent === "+23 MI"
    )).toBeVisible();
  });

  it("snaps to the complete explanation when the buyer interrupts", () => {
    vi.useFakeTimers();
    render(<RangeRealityPrototype />);

    fireEvent.click(screen.getByRole("button", { name: "Explain this build" }));
    act(() => vi.advanceTimersByTime(800));
    expect(screen.getByText("Resolving configuration")).toBeVisible();

    const stage = screen.getByText("Resolving configuration").closest(".range-stage");
    expect(stage).not.toBeNull();
    fireEvent.pointerDown(stage as HTMLElement);

    expect(screen.getByText("Interrupted · complete blueprint shown")).toBeVisible();
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getByText("Interrupted · complete blueprint shown")).toBeVisible();
  });

  it("keeps the judged range delta internally coherent", () => {
    expect(
      RANGE_REALITY_FIXTURE.after.estimatedRangeMiles
      - RANGE_REALITY_FIXTURE.before.estimatedRangeMiles,
    )
      .toBe(RANGE_REALITY_FIXTURE.restoredMiles);
  });
});
