import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwnerGuideBridge } from "../../../src/owner-guide/owner-guide-bridge";
import { getToolActivity, resetToolActivityForTests } from "../../../src/webmcp/tool-activity";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  resetToolActivityForTests();
});

describe("owner guide cross-frame bridge", () => {
  it("matches replies by frame, origin, request id, and boolean status", async () => {
    const bridge = createOwnerGuideBridge({ frameTimeoutMs: 500 });
    const frame = document.createElement("iframe");
    document.body.append(frame);
    Object.defineProperty(frame.contentDocument, "URL", {
      configurable: true,
      value: `${window.location.origin}/garage/`,
    });
    bridge.bindFrame(frame);
    bridge.markFrameReady();
    const target = frame.contentWindow!;
    const postMessage = vi.spyOn(target, "postMessage").mockImplementation(() => undefined);

    const request = bridge.call<{ view: string }>("get_state");
    await Promise.resolve();
    const outbound = postMessage.mock.calls[0][0] as { id: string };

    window.dispatchEvent(new MessageEvent("message", {
      source: target,
      origin: "https://wrong.example",
      data: { source: "r2-blueprint-result", id: outbound.id, ok: true, result: { view: "wrong" } },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      source: target,
      origin: window.location.origin,
      data: { source: "r2-blueprint-result", id: "wrong-id", ok: true, result: { view: "wrong" } },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      source: target,
      origin: window.location.origin,
      data: { source: "r2-blueprint-result", id: outbound.id, ok: "yes", result: { view: "wrong" } },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      source: target,
      origin: window.location.origin,
      data: { source: "r2-blueprint-result", id: outbound.id, ok: true, result: { view: "iso" } },
    }));

    await expect(request).resolves.toEqual({ view: "iso" });
    expect(getToolActivity()).toEqual([expect.objectContaining({ tool: "get_state", ok: true })]);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ source: "r2-blueprint", tool: "get_state", args: {} }),
      window.location.origin,
    );
  });

  it("cancels frame loading and in-flight calls immediately", async () => {
    const waitingBridge = createOwnerGuideBridge({ frameTimeoutMs: 500 });
    const loadRequested = vi.fn();
    waitingBridge.observeFrameRequest(loadRequested);
    const waitingController = new AbortController();
    const waiting = waitingBridge.call("get_state", {}, { signal: waitingController.signal });
    const waitingReason = new Error("stop waiting");
    waitingController.abort(waitingReason);
    await expect(waiting).rejects.toBe(waitingReason);
    expect(loadRequested).toHaveBeenLastCalledWith(true);

    const bridge = createOwnerGuideBridge({ frameTimeoutMs: 500 });
    const frame = document.createElement("iframe");
    document.body.append(frame);
    Object.defineProperty(frame.contentDocument, "URL", {
      configurable: true,
      value: `${window.location.origin}/garage/`,
    });
    bridge.bindFrame(frame);
    bridge.markFrameReady();
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    const controller = new AbortController();
    const request = bridge.call("get_state", {}, { signal: controller.signal });
    const reason = new Error("agent cancelled");
    controller.abort(reason);
    await expect(request).rejects.toBe(reason);
    expect(getToolActivity()).toEqual([
      expect.objectContaining({ tool: "get_state", ok: false, error: "stop waiting" }),
      expect.objectContaining({ tool: "get_state", ok: false, error: "agent cancelled" }),
    ]);
  });
});

describe("frame readiness and workspace navigation", () => {
  afterEach(() => { window.history.replaceState(null, "", "/"); vi.useRealTimers(); });

  it("does not dispatch into about:blank, then succeeds when the actual same-origin drawing is ready", async () => {
    vi.useFakeTimers();
    const bridge = createOwnerGuideBridge({ frameTimeoutMs: 200, framePollMs: 10 });
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const post = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    bridge.bindFrame(frame);
    bridge.markFrameReady();
    const request = bridge.call("get_state", {}, { trackActivity: false });
    await vi.advanceTimersByTimeAsync(20);
    expect(post).not.toHaveBeenCalled();
    Object.defineProperty(frame.contentDocument, "URL", { configurable: true, value: `${window.location.origin}/garage/` });
    bridge.markFrameReady();
    await vi.advanceTimersByTimeAsync(10);
    expect(post).toHaveBeenCalledOnce();
    const outbound = post.mock.calls[0][0] as { id: string };
    window.dispatchEvent(new MessageEvent("message", {
      source: frame.contentWindow,
      origin: window.location.origin,
      data: { source: "r2-blueprint-result", id: outbound.id, ok: true, result: { ready: true } },
    }));
    await expect(request).resolves.toEqual({ ready: true });
  });

  it("restores the selected workspace on refresh and popstate without replacing application history state", () => {
    const historyState = { review: { open: false }, navigationKey: "keep-this" };
    window.history.replaceState(historyState, "", "/configure/?v=1&catalog=rivian-r2-2026&workspace=garage#vehicle");
    const bridge = createOwnerGuideBridge({ persistWorkspace: true });
    const listener = vi.fn();
    const stop = bridge.observeWorkspace(listener);
    try {
      expect(bridge.getWorkspace()).toBe("garage");
      bridge.setWorkspace("configure");
      expect(new URL(window.location.href).searchParams.has("workspace")).toBe(false);
      expect(window.history.state).toEqual(historyState);
      expect(window.location.hash).toBe("#vehicle");
      bridge.setWorkspace("garage");
      expect(createOwnerGuideBridge({ persistWorkspace: true }).getWorkspace()).toBe("garage");
      expect(window.history.state).toEqual(historyState);
      window.history.replaceState(historyState, "", "/configure/?v=1&catalog=rivian-r2-2026");
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyState }));
      expect(bridge.getWorkspace()).toBe("configure");
      expect(listener).toHaveBeenLastCalledWith("configure");
      window.history.replaceState(historyState, "", "/configure/?workspace=garage");
      window.dispatchEvent(new PopStateEvent("popstate", { state: historyState }));
      expect(bridge.getWorkspace()).toBe("garage");
      expect(listener).toHaveBeenLastCalledWith("garage");
    } finally { stop(); }
  });

  it("does not reveal My Car or push history for a request that was already cancelled", async () => {
    const bridge = createOwnerGuideBridge({ persistWorkspace: true });
    const push = vi.spyOn(window.history, "pushState");
    const controller = new AbortController();
    const reason = new DOMException("Cancelled before dispatch", "AbortError");
    controller.abort(reason);
    await expect(bridge.call("get_state", {}, { signal: controller.signal, reveal: true, trackActivity: false })).rejects.toBe(reason);
    expect(bridge.getWorkspace()).toBe("configure");
    expect(push).not.toHaveBeenCalled();
  });

  it("does not add duplicate history entries for the already selected workspace", () => {
    const bridge = createOwnerGuideBridge({ persistWorkspace: true });
    const push = vi.spyOn(window.history, "pushState");
    bridge.setWorkspace("configure");
    expect(push).not.toHaveBeenCalled();
    bridge.setWorkspace("garage");
    bridge.setWorkspace("garage");
    expect(push).toHaveBeenCalledOnce();
  });
});
