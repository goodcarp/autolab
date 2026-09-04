import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROBE_TOOL_NAME,
  registerProbeSiteTool,
  resetProbeForTests,
  unregisterProbeSiteTool,
} from "../src/webmcp/register-probe";

describe("temporary Site Tools probe", () => {
  afterEach(() => {
    delete document.modelContext;
    delete document.documentElement.dataset.siteTools;
    resetProbeForTests();
  });

  it("degrades to the complete manual shell when unsupported", async () => {
    await expect(registerProbeSiteTool()).resolves.toEqual({ state: "unsupported" });
    expect(document.documentElement.dataset.siteTools).toBe("unsupported");
  });

  it("registers one narrow top-level read tool", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    document.modelContext = { registerTool };

    await expect(
      Promise.all([registerProbeSiteTool(), registerProbeSiteTool()]),
    ).resolves.toEqual([
      { state: "ready", toolName: PROBE_TOOL_NAME },
      { state: "ready", toolName: PROBE_TOOL_NAME },
    ]);

    expect(registerTool).toHaveBeenCalledTimes(1);
    const [tool, registrationOptions] = registerTool.mock.calls[0] as [
      ModelContextTool,
      ModelContextRegisterToolOptions,
    ];

    expect(tool).toMatchObject({
      name: PROBE_TOOL_NAME,
      title: "Inspect configurator shell",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
    });
    expect(registrationOptions.signal).toBeInstanceOf(AbortSignal);
    expect(registrationOptions.signal?.aborted).toBe(false);

    const executionController = new AbortController();
    await expect(
      tool.execute(
        { unexpected: true },
        { signal: executionController.signal },
      ),
    ).rejects.toThrow(`${PROBE_TOOL_NAME} accepts no arguments.`);

    await expect(
      tool.execute({}, { signal: executionController.signal }),
    ).resolves.toEqual({
      title: document.title,
      release: "scaffold",
      interactive: true,
      registrationApi: "document.modelContext.registerTool",
      topLevel: true,
    });

    await expect(tool.execute({})).resolves.toMatchObject({
      registrationApi: "document.modelContext.registerTool",
      topLevel: true,
    });

    const cancellation = new Error("Probe execution cancelled");
    executionController.abort(cancellation);
    await expect(
      tool.execute({}, { signal: executionController.signal }),
    ).rejects.toBe(cancellation);

    unregisterProbeSiteTool();
    expect(registrationOptions.signal?.aborted).toBe(true);
  });

  it("reports registration rejection without breaking the shell", async () => {
    const registerTool = vi
      .fn()
      .mockRejectedValue(new DOMException("Site Tools are disabled", "NotAllowedError"));
    document.modelContext = { registerTool };

    await expect(registerProbeSiteTool()).resolves.toEqual({
      state: "degraded",
      message: "Site Tools are disabled",
    });
    expect(document.documentElement.dataset.siteTools).toBe("degraded");

    const [, registrationOptions] = registerTool.mock.calls[0] as [
      ModelContextTool,
      ModelContextRegisterToolOptions,
    ];
    expect(registrationOptions.signal?.aborted).toBe(true);
  });
});
