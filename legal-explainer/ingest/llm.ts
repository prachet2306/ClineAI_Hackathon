// Shared helpers for the model calls made by ingest (OCR, legal-document gate, clause split):
// gateway settings from env, a timeout wrapper, and a one-shot text prompt. Nothing from the document
// or the API key is logged. After a model call times out, further model calls are skipped for a short
// while so a slow gateway cannot eat the whole request budget; callers already fall back without a model.

/** Thrown when work did not finish within its time limit. */
export class TimeoutError extends Error {
  constructor() {
    super("Timed out");
    this.name = "TimeoutError";
  }
}

/** Rejects with TimeoutError after `ms`; `onTimeout` lets the caller stop the underlying work. */
export function withTimeout<T>(work: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new TimeoutError());
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export function gatewayConfig() {
  const providerId = process.env.CLINE_PROVIDER_ID?.trim();
  const modelId = process.env.CLINE_MODEL_ID?.trim();
  const apiKey = process.env.CLINE_API_KEY?.trim();
  if (!providerId || !modelId || !apiKey) throw new Error("Gateway settings are missing");
  return { providerId, modelId, apiKey, baseUrl: process.env.CLINE_BASE_URL?.trim() || undefined };
}

const PAUSE_AFTER_TIMEOUT_MS = 60_000;
let pausedUntil = 0;

/** Throws right away while model calls are paused after a recent timeout. */
export function assertGatewayAvailable(): void {
  if (Date.now() < pausedUntil) throw new Error("Model calls are paused after a recent timeout");
}

/** Waits for an agent run, aborting the agent if it takes longer than `ms`. */
export async function guardedRun<T>(agent: { abort: (reason?: string) => void }, work: Promise<T>, ms: number): Promise<T> {
  try {
    return await withTimeout(work, ms, () => agent.abort("Timed out"));
  } catch (error) {
    if (error instanceof TimeoutError) pausedUntil = Date.now() + PAUSE_AFTER_TIMEOUT_MS;
    throw error;
  }
}

/** One text prompt, one text answer, no tools. Throws on missing settings, failure or timeout. */
export async function askModel(system: string, prompt: string, timeoutMs: number): Promise<string> {
  assertGatewayAvailable();
  const config = gatewayConfig();
  // The ignore comments keep Next's bundler away from the SDK; Node loads it at runtime (it cannot be bundled).
  const { Agent } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "@cline/sdk");
  const agent = new Agent({ ...config, systemPrompt: system, tools: [], maxIterations: 1 });
  const result = await guardedRun(agent, agent.run(prompt), timeoutMs);
  if (result.status !== "completed" || !result.outputText.trim()) throw new Error("The model returned no answer");
  return result.outputText;
}
