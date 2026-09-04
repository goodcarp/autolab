import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwnerGuideBridge } from "../../../src/owner-guide/owner-guide-bridge";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
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
  });
});
