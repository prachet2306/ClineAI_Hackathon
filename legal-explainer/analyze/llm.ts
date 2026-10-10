/**
 * One-shot LLM call for module 2 (analysis) through the Cline SDK. Returns the model's text.
 * Uses a NEW Agent per call, with no tools and a single iteration, so no document text carries
 * over between calls and the model cannot read files or run commands. Errors are short and
 * generic: they never contain prompts, document text or API keys.
 * Server-side only (Node). Provider, model and key come from environment variables.
 */

/** Time allowed for one LLM call. Measured calls are slow (tens of seconds), so keep it generous. */
export const LLM_TIMEOUT_MS = 180_000;
export const LLM_MAX_ITERATIONS = 1;

const ENV_NAMES = ["CLINE_PROVIDER_ID", "CLINE_MODEL_ID", "CLINE_API_KEY"] as const;

export type LlmErrorCode = "not_configured" | "timeout" | "max_iterations" | "failed" | "empty";

/** Error with a fixed, safe message and a code. Never carries prompts, text or keys. */
export class LlmError extends Error {
  readonly code: LlmErrorCode;

  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.name = "LlmError";
    this.code = code;
  }
}

/** The config we pass to the SDK Agent. `tools: []` means the model gets no tools at all. */
export interface LlmAgentConfig {
  providerId: string;
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  maxIterations: number;
  tools: readonly never[];
}

/** The small part of the SDK Agent we use. Tests supply a fake with this shape. */
export interface LlmAgent {
  run(input: string): Promise<{ status: string; outputText: string; error?: Error }>;
  abort(reason?: unknown): void;
}

export interface LlmDeps {
  env: Readonly<Record<string, string | undefined>>;
  timeoutMs: number;
  createAgent: (config: LlmAgentConfig) => Promise<LlmAgent> | LlmAgent;
}

/** Loads the SDK only when a real call is made, so importing this file never loads it. */
async function createSdkAgent(config: LlmAgentConfig): Promise<LlmAgent> {
  const { Agent } = await import("@cline/sdk");
  return new Agent(config);
}

const defaultDeps: LlmDeps = {
  env: process.env,
  timeoutMs: LLM_TIMEOUT_MS,
  createAgent: createSdkAgent,
};

/** Reads the three variables. Throws naming the missing ones, never any value. */
function readConfig(env: LlmDeps["env"], systemPrompt: string): LlmAgentConfig {
  const value = (name: (typeof ENV_NAMES)[number]): string => env[name]?.trim() ?? "";
  const missing = ENV_NAMES.filter((name) => value(name) === "");
  if (missing.length > 0) {
    throw new LlmError("not_configured", `Missing environment variable: ${missing.join(", ")}`);
  }
  return {
    providerId: value("CLINE_PROVIDER_ID").toLowerCase(),
    modelId: value("CLINE_MODEL_ID"),
    apiKey: value("CLINE_API_KEY"),
    systemPrompt,
    maxIterations: LLM_MAX_ITERATIONS,
    tools: [],
  };
}

/** True if the SDK says the run ran out of iterations. The text is only matched, never copied. */
function isMaxIterations(error: unknown): boolean {
  return error instanceof Error && /exceeded maxIterations/i.test(error.message);
}

function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  if (isMaxIterations(error)) {
    return new LlmError("max_iterations", "LLM did not finish within the iteration limit");
  }
  return new LlmError("failed", "LLM request failed");
}

/**
 * The SDK Agent has abort() but no abort option in its config, so a timer calls abort() and
 * also rejects. Promise.race-style settling means we never hang if abort is slow to act.
 */
function runWithTimeout(
  agent: LlmAgent,
  input: string,
  timeoutMs: number,
): ReturnType<LlmAgent["run"]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        agent.abort();
      } catch {
        // Ignore: we reject below either way.
      }
      reject(new LlmError("timeout", "LLM request timed out"));
    }, timeoutMs);

    agent.run(input).then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Builds callLlm with replaceable dependencies (used by tests; production uses the default). */
export function createCallLlm(overrides: Partial<LlmDeps> = {}) {
  return async function callLlm(system: string, user: string): Promise<string> {
    const deps: LlmDeps = { ...defaultDeps, ...overrides };
    const config = readConfig(deps.env, system);

    let result: Awaited<ReturnType<LlmAgent["run"]>>;
    try {
      const agent = await deps.createAgent(config);
      result = await runWithTimeout(agent, user, deps.timeoutMs);
    } catch (error) {
      throw toLlmError(error);
    }

    if (result.status !== "completed" || result.error !== undefined) {
      throw toLlmError(result.error);
    }
    if (result.outputText.trim() === "") {
      throw new LlmError("empty", "LLM returned an empty response");
    }
    return result.outputText;
  };
}

/** Sends one system + user prompt to the configured model and returns its text. */
export const callLlm = createCallLlm();
