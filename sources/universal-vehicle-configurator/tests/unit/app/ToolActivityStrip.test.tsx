import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ToolActivityStrip } from "../../../src/app/ToolActivityStrip";
import { resetToolActivityForTests, trackToolExecution } from "../../../src/webmcp/tool-activity";

afterEach(() => {
  resetToolActivityForTests();
  vi.useRealTimers();
});

it("announces the latest call politely for four seconds, resetting for a new call", () => {
  vi.useFakeTimers();
  render(<ToolActivityStrip />);
  const strip = screen.getByRole("status");
  expect(strip).toBeEmptyDOMElement();
  expect(strip).toHaveAttribute("aria-live", "polite");
  act(() => { trackToolExecution("present_vehicle_configuration", { bodyOpen: true }, () => ({ ok: true })); });
  expect(strip).toHaveTextContent("AGENT · present_vehicle_configuration · bodyOpen:true · ok · 0 ms");
  act(() => { vi.advanceTimersByTime(3_000); });
  act(() => {
    try { trackToolExecution("get_state", {}, () => { throw new Error("Twin unavailable"); }); } catch { /* Expected. */ }
  });
  expect(strip).toHaveTextContent("error: Twin unavailable");
  act(() => { vi.advanceTimersByTime(3_999); });
  expect(strip).not.toBeEmptyDOMElement();
  act(() => { vi.advanceTimersByTime(1); });
  expect(strip).toBeEmptyDOMElement();
  expect(strip).not.toHaveAttribute("data-active");
});

it.each([4_000, 10_000])("does not render or announce an entry aged %s ms on mount", (age) => {
  vi.useFakeTimers();
  trackToolExecution("get_state", {}, () => ({ ok: true }));
  vi.advanceTimersByTime(age);
  render(<ToolActivityStrip />);
  const strip = screen.getByRole("status");
  expect(strip).toBeEmptyDOMElement();
  expect(strip).not.toHaveAttribute("data-active");
  expect(strip).not.toHaveAttribute("title");
});

it("shows a fresh entry on mount only for its remaining lifetime", () => {
  vi.useFakeTimers();
  trackToolExecution("get_state", {}, () => ({ ok: true }));
  vi.advanceTimersByTime(3_000);
  render(<ToolActivityStrip />);
  expect(screen.getByRole("status")).toHaveTextContent("get_state");
  act(() => { vi.advanceTimersByTime(1_000); });
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
});

it("caps long error announcements and titles at 160 characters with an ellipsis", () => {
  trackToolExecution("missing", {}, () => ({ ok: false, error: `Unknown tool. Available: ${"tool_name, ".repeat(40)}` }));
  render(<ToolActivityStrip />);
  const strip = screen.getByRole("status");
  expect(strip.textContent).toHaveLength(160);
  expect(strip.textContent).toMatch(/^AGENT · missing · error: Unknown tool/);
  expect(strip.textContent).toMatch(/…$/);
  expect(strip).toHaveAttribute("title", strip.textContent);
});
