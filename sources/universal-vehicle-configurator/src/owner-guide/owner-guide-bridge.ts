import { trackToolExecution } from "../webmcp/tool-activity";

export type AutoLabWorkspace = "configure" | "garage";

export type VehicleTwinTool =
  | "get_state"
  | "set_view"
  | "set_motion"
  | "list_parts"
  | "get_part"
  | "frame_part"
  | "highlight_part"
  | "set_annotations"
  | "get_specification"
  | "measure"
  | "set_camera"
  | "orbit_camera"
  | "set_vehicle_context"
  | "reset";

export type VehicleTwinContext = {
  build: string;
  paint: string;
  wheels: string;
  interior: string;
  rangeMiles: number | null;
  vehicleTotal: number;
  revision: number;
};

export type VehicleTwinCallOptions = {
  /** Switch the shared shell to Garage before dispatching the tool. */
  reveal?: boolean;
  /** Cancels frame loading and an in-flight request without waiting for timeout. */
  signal?: AbortSignal;
  /** False when the enclosing configurator tool owns the activity entry. */
  trackActivity?: boolean;
};

export interface OwnerGuideBridge {
  getWorkspace(): AutoLabWorkspace;
  setWorkspace(next: AutoLabWorkspace): void;
  observeWorkspace(listener: (workspace: AutoLabWorkspace) => void): () => void;
  requestFrame(): void;
  observeFrameRequest(listener: (requested: boolean) => void): () => void;
  bindFrame(nextFrame: HTMLIFrameElement | null): void;
  markFrameReady(): void;
  call<T>(
    tool: VehicleTwinTool,
    args?: Record<string, unknown>,
    options?: VehicleTwinCallOptions,
  ): Promise<T>;
  syncContext(
    context: VehicleTwinContext,
    options?: Pick<VehicleTwinCallOptions, "signal" | "trackActivity">,
  ): Promise<unknown>;
}

type WorkspaceListener = (workspace: AutoLabWorkspace) => void;
type LoadListener = (requested: boolean) => void;

const FRAME_TIMEOUT_MS = 45_000;
const FRAME_POLL_MS = 50;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Vehicle twin request was aborted.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasLoadedFrameDocument(candidate: HTMLIFrameElement | null): boolean {
  try {
    const childDocument = candidate?.contentDocument;
    return Boolean(
      candidate?.contentWindow
      && childDocument?.readyState === "complete"
      && childDocument.URL !== "about:blank",
    );
  } catch {
    // The bridge is intentionally same-origin. A cross-origin frame is never
    // ready for this protocol, even if the browser lets its load event fire.
    return false;
  }
}

/**
 * A small factory keeps the production singleton simple while making the
 * cross-frame contract testable without mutating global application state.
 */
export function createOwnerGuideBridge(
  options: { frameTimeoutMs?: number; framePollMs?: number } = {},
): OwnerGuideBridge {
  const frameTimeoutMs = options.frameTimeoutMs ?? FRAME_TIMEOUT_MS;
  const framePollMs = options.framePollMs ?? FRAME_POLL_MS;
  const listeners = new Set<WorkspaceListener>();
  const loadListeners = new Set<LoadListener>();

  let workspace: AutoLabWorkspace = "configure";
  let loadRequested = false;
  let frame: HTMLIFrameElement | null = null;
  let frameReady = false;

  function emitWorkspace() {
    listeners.forEach((listener) => listener(workspace));
  }

  function requestFrameLoad() {
    if (loadRequested) return;
    loadRequested = true;
    loadListeners.forEach((listener) => listener(true));
  }

  function waitForFrame(signal?: AbortSignal): Promise<HTMLIFrameElement> {
    throwIfAborted(signal);
    if (frame?.contentWindow && frameReady) return Promise.resolve(frame);
    requestFrameLoad();

    return new Promise((resolve, reject) => {
      const startedAt = performance.now();
      const cleanup = () => {
        window.clearInterval(poll);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(abortReason(signal as AbortSignal));
      };
      const poll = window.setInterval(() => {
        if (frame?.contentWindow && frameReady) {
          cleanup();
          resolve(frame);
          return;
        }
        if (performance.now() - startedAt >= frameTimeoutMs) {
          cleanup();
          reject(new Error("The vehicle twin is still loading. Try the request again."));
        }
      }, framePollMs);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  async function callTwin<T>(
    tool: VehicleTwinTool,
    args: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    throwIfAborted(signal);
    const targetFrame = await waitForFrame(signal);
    throwIfAborted(signal);
    const targetWindow = targetFrame.contentWindow;
    if (!targetWindow) throw new Error("The vehicle twin is unavailable.");

    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        signal?.removeEventListener("abort", onAbort);
      };
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        action();
      };
      const onAbort = () => finish(() => reject(abortReason(signal as AbortSignal)));
      const timeout = window.setTimeout(() => {
        finish(() => reject(new Error(`The vehicle twin did not answer ${tool}.`)));
      }, frameTimeoutMs);

      function onMessage(event: MessageEvent) {
        if (
          event.source !== targetWindow
          || event.origin !== window.location.origin
          || !isRecord(event.data)
          || event.data.source !== "r2-blueprint-result"
          || event.data.id !== id
          || typeof event.data.ok !== "boolean"
        ) return;

        if (event.data.ok) {
          finish(() => resolve(event.data.result as T));
        } else {
          finish(() => reject(new Error(
            String(event.data.error ?? `Vehicle twin tool ${tool} failed.`),
          )));
        }
      }

      window.addEventListener("message", onMessage);
      signal?.addEventListener("abort", onAbort, { once: true });
      targetWindow.postMessage(
        { source: "r2-blueprint", id, tool, args },
        window.location.origin,
      );
    });
  }

  const bridge: OwnerGuideBridge = {
    getWorkspace: () => workspace,
    setWorkspace(next) {
      if (workspace === next) return;
      workspace = next;
      emitWorkspace();
    },
    observeWorkspace(listener) {
      listeners.add(listener);
      listener(workspace);
      return () => {
        listeners.delete(listener);
      };
    },
    requestFrame: requestFrameLoad,
    observeFrameRequest(listener) {
      loadListeners.add(listener);
      listener(loadRequested);
      return () => {
        loadListeners.delete(listener);
      };
    },
    bindFrame(nextFrame) {
      frame = nextFrame;
      // A newly mounted iframe exposes a complete about:blank document before
      // its real module graph loads. Treating that placeholder as ready loses
      // the first tool messages because Garage has not installed its listener.
      frameReady = hasLoadedFrameDocument(nextFrame);
    },
    markFrameReady() {
      if (hasLoadedFrameDocument(frame)) frameReady = true;
    },
    async call<T>(
      tool: VehicleTwinTool,
      args: Record<string, unknown> = {},
      callOptions: VehicleTwinCallOptions = {},
    ) {
      if (callOptions.reveal) bridge.setWorkspace("garage");
      const execute = () => callTwin<T>(tool, args, callOptions.signal);
      return callOptions.trackActivity === false ? execute() : trackToolExecution(tool, args, execute);
    },
    async syncContext(
      context: VehicleTwinContext,
      syncOptions: Pick<VehicleTwinCallOptions, "signal" | "trackActivity"> = {},
    ) {
      const execute = () => callTwin("set_vehicle_context", context, syncOptions.signal);
      return syncOptions.trackActivity === false ? execute() : trackToolExecution("set_vehicle_context", context, execute);
    },
  };

  return bridge;
}

export const ownerGuideBridge = createOwnerGuideBridge();
