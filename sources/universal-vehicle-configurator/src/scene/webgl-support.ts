export type WebGLSupport = "supported" | "unsupported";

export function detectWebGLSupport(): WebGLSupport {
  if (typeof window === "undefined" || typeof document === "undefined") return "unsupported";
  if (!("WebGLRenderingContext" in window) && !("WebGL2RenderingContext" in window)) {
    return "unsupported";
  }

  try {
    const canvas = document.createElement("canvas");
    // Probe for what will actually run, not for something stricter.
    //
    // failIfMajorPerformanceCaveat refuses a software-backed context. The
    // renderer this gates does not set it, so a machine that would have drawn
    // the vehicle — slowly, but correctly — was told WebGL was unsupported and
    // shown a still of a different car instead. Prefer a hardware context, then
    // accept the one the renderer would have got.
    const context = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      failIfMajorPerformanceCaveat: true,
    })
      ?? canvas.getContext("webgl", {
        alpha: true,
        antialias: true,
        failIfMajorPerformanceCaveat: true,
      })
      ?? canvas.getContext("webgl2", { alpha: true, antialias: true })
      ?? canvas.getContext("webgl", { alpha: true, antialias: true });
    if (!context) return "unsupported";
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return "supported";
  } catch {
    return "unsupported";
  }
}
