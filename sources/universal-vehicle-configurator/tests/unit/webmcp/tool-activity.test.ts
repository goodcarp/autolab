import { afterEach, expect, it, vi } from "vitest";
import { getToolActivity, observeToolActivity, resetToolActivityForTests, trackToolExecution } from "../../../src/webmcp/tool-activity";

afterEach(() => {
  resetToolActivityForTests();
  vi.useRealTimers();
});

it.each([true, false])("waits for a thenable and records its settlement once (success: %s)", async (ok) => {
  vi.useFakeTimers();
  let resolve!: (value: { ok: boolean }) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<{ ok: boolean }>((yes, no) => { resolve = yes; reject = no; });
  const thenable: PromiseLike<{ ok: boolean }> = { then: pending.then.bind(pending) };
  const observer = vi.fn();
  const stop = observeToolActivity(observer);
  try {
    const tracked = trackToolExecution("thenable", {}, () => thenable);
    expect(getToolActivity()).toEqual([]);
    expect(observer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(125);
    if (ok) {
      resolve({ ok: true });
      await expect(tracked).resolves.toEqual({ ok: true });
    } else {
      const error = new Error("thenable rejected");
      reject(error);
      await expect(tracked).rejects.toBe(error);
    }
    expect(getToolActivity()).toEqual([expect.objectContaining({
      tool: "thenable", ok, ms: 125,
      ...(ok ? {} : { error: "thenable rejected" }),
    })]);
    expect(observer).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});

it("keeps nested schema keys private-value-free and caps summaries at 120 characters", () => {
  const args = { patch: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`schemaKey${i}`, "PRIVATE VALUE"])) };
  trackToolExecution("set_vehicle_buyer_context", args, () => ({ ok: true }));
  const summary = getToolActivity()[0].argsSummary;
  expect(summary).toHaveLength(120);
  expect(summary).toMatch(/^patch:\{schemaKey0,schemaKey1,/);
  expect(summary).not.toContain("PRIVATE VALUE");
  expect(summary).toMatch(/…$/);
});
