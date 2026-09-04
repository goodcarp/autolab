export type SiteToolsProbeStatus =
  | { state: "unsupported" }
  | { state: "registering" }
  | { state: "ready"; toolName: typeof PROBE_TOOL_NAME }
  | { state: "degraded"; message: string };

export const PROBE_TOOL_NAME = "inspect_configurator_shell";

let registration: Promise<SiteToolsProbeStatus> | undefined;
let registrationController: AbortController | undefined;

function setDocumentStatus(status: SiteToolsProbeStatus) {
  document.documentElement.dataset.siteTools = status.state;
}

function errorMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Registration failed";
}

async function register(): Promise<SiteToolsProbeStatus> {
  const modelContext = document.modelContext;

  if (
    window.top !== window ||
    typeof modelContext?.registerTool !== "function"
  ) {
    const status = { state: "unsupported" } as const;
    setDocumentStatus(status);
    return status;
  }

  setDocumentStatus({ state: "registering" });
  const controller = new AbortController();
  registrationController = controller;

  try {
    await modelContext.registerTool(
      {
        name: PROBE_TOOL_NAME,
        title: "Inspect configurator shell",
        description:
          "Read the title and release status of the Universal Vehicle Configurator shell. This tool does not change the page.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: async (input, options) => {
          if (options?.signal?.aborted) {
            throw options.signal.reason;
          }

          if (
            typeof input !== "object" ||
            input === null ||
            Array.isArray(input) ||
            Object.keys(input).length > 0
          ) {
            throw new TypeError(`${PROBE_TOOL_NAME} accepts no arguments.`);
          }

          return {
            title: document.title,
            release: "scaffold",
            interactive: true,
            registrationApi: "document.modelContext.registerTool",
            topLevel: window.top === window,
          };
        },
      },
      { signal: controller.signal },
    );

    const status = { state: "ready", toolName: PROBE_TOOL_NAME } as const;
    setDocumentStatus(status);
    return status;
  } catch (error) {
    controller.abort();
    if (registrationController === controller) {
      registrationController = undefined;
    }

    const status = { state: "degraded", message: errorMessage(error) } as const;
    setDocumentStatus(status);
    return status;
  }
}

export function registerProbeSiteTool() {
  registration ??= register();
  return registration;
}

export function unregisterProbeSiteTool() {
  registrationController?.abort();
  registrationController = undefined;
  registration = undefined;
}

export function resetProbeForTests() {
  unregisterProbeSiteTool();
}

if (import.meta.hot) {
  import.meta.hot.dispose(unregisterProbeSiteTool);
}
