export interface ToolActivity {
  tool: string;
  argsSummary: string;
  ok: boolean;
  ms: number;
  /** Completion time, as an ISO timestamp. */
  at: string;
  error?: string;
}

const entries: ToolActivity[] = [];
const listeners = new Set<(entry: ToolActivity) => void>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Free text, buyer facts, financing assumptions and nested values stay private.
// Only these non-personal presentation switches include their boolean value.
const PUBLIC_SWITCHES = new Set(["bodyOpen", "on", "visible", "detail", "annotationsVisible", "revealUnderBody"]);

function summarize(tool: string, args: unknown): string {
  if (!isRecord(args)) return "invalid arguments";
  const summary = Object.entries(args).map(([key, value]) => {
    if (tool !== "set_vehicle_buyer_context" && PUBLIC_SWITCHES.has(key) && typeof value === "boolean") {
      return `${key}:${value}`;
    }
    if (isRecord(value)) return `${key}:{${Object.keys(value).join(",")}}`;
    return key;
  }).join(" · ");
  return summary.length > 120 ? `${summary.slice(0, 119)}…` : summary;
}

function message(error: unknown): string {
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return typeof error === "string" ? error : "Tool execution failed.";
}

export function getToolActivity(): ToolActivity[] {
  return entries.map((entry) => ({ ...entry }));
}

export function observeToolActivity(listener: (entry: ToolActivity) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Preserve synchronous results/throws and asynchronous rejection semantics. */
export function trackToolExecution<T>(tool: string, args: unknown, execute: () => T): T {
  const started = performance.now();
  const argsSummary = summarize(tool, args);
  const finish = (ok: boolean, error?: unknown) => {
    const entry: ToolActivity = {
      tool, argsSummary, ok,
      ms: Math.max(0, Math.round(performance.now() - started)),
      at: new Date().toISOString(),
      ...(ok ? {} : { error: message(error) }),
    };
    entries.push(entry);
    if (entries.length > 20) entries.shift();
    for (const listener of listeners) {
      // A readout must never change a tool's result or turn success into failure.
      try { listener({ ...entry }); } catch { /* Observer isolation. */ }
    }
  };
  const success = (result: unknown) => {
    const failed = isRecord(result) && result.ok === false;
    finish(!failed, failed ? result.error : undefined);
    return result;
  };
  const failure = (error: unknown): never => { finish(false, error); throw error; };
  try {
    const result = execute();
    if (typeof (result as PromiseLike<unknown> | null | undefined)?.then === "function") {
      return Promise.resolve(result).then(success, failure) as T;
    }
    success(result);
    return result;
  } catch (error) {
    return failure(error);
  }
}

export function resetToolActivityForTests() {
  entries.length = 0;
}
