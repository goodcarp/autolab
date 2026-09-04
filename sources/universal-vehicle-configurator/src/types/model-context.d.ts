type ModelContextAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  untrustedContentHint?: boolean;
};

type ModelContextToolExecuteOptions = {
  signal?: AbortSignal;
};

type ModelContextRegisterToolOptions = {
  exposedTo?: string[];
  signal?: AbortSignal;
};

type ModelContextTool<Input extends Record<string, unknown> = Record<string, unknown>> = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ModelContextAnnotations;
  execute: (
    input: Input,
    options?: ModelContextToolExecuteOptions,
  ) => Promise<unknown> | unknown;
};

type ModelContextApi = {
  registerTool: <Input extends Record<string, unknown> = Record<string, unknown>>(
    tool: ModelContextTool<Input>,
    options?: ModelContextRegisterToolOptions,
  ) => Promise<void>;
};

interface Document {
  modelContext?: ModelContextApi;
}

interface Navigator {
  modelContext?: ModelContextApi;
}
