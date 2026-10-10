// M4 /compare: calls the LLM through the Cline SDK `Agent` (no tools, one iteration) and returns JSON validated by a Zod schema.
// Never logs or puts prompts, document text, keys or raw model output into errors. Optional on-disk cache (LLM_CACHE=1).
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@cline/sdk";
import type { z } from "zod";

const MAX_ATTEMPTS = 2; // first try + exactly one retry

const JSON_ONLY_INSTRUCTION =
  "Reply with a single valid JSON value only. No markdown, no code fences, no text before or after the JSON.";
const JSON_RETRY_INSTRUCTION =
  "Your previous reply could not be used. Reply again with a single valid JSON value that matches the requested shape, and nothing else.";

/** Reads a required environment variable; the error names only the variable. */
const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

/** Removes ```json fences and any text outside the outermost braces or brackets. */
export const extractJsonText = (raw: string): string => {
  const unfenced = raw.replace(/```(?:json)?/gi, "").trim();
  const firstBrace = unfenced.indexOf("{");
  const firstBracket = unfenced.indexOf("[");
  const starts = [firstBrace, firstBracket].filter((i) => i >= 0);
  if (starts.length === 0) return unfenced;
  const start = Math.min(...starts);
  const end = unfenced.lastIndexOf(unfenced[start] === "{" ? "}" : "]");
  return end > start ? unfenced.slice(start, end + 1) : unfenced.slice(start);
};

/** Parses the model's text and validates it. Returns undefined on any failure (the reason is not exposed). */
const parseAndValidate = <T>(raw: string, schema: z.ZodType<T>): T | undefined => {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonText(raw));
  } catch {
    return undefined;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : undefined;
};

/** One model call with a fresh agent: no tools, a single iteration. */
const askModel = async (system: string, user: string): Promise<string> => {
  const agent = new Agent({
    providerId: requireEnv("CLINE_PROVIDER_ID"),
    modelId: requireEnv("CLINE_MODEL_ID"),
    apiKey: requireEnv("CLINE_API_KEY"),
    systemPrompt: system,
    tools: [],
    maxIterations: 1,
  });
  let result;
  try {
    result = await agent.run(user);
  } catch (err) {
    throw new Error(`LLM request failed (${err instanceof Error ? err.name : "UnknownError"})`);
  }
  if (result.status !== "completed") {
    throw new Error(`LLM request did not complete (status: ${result.status})`);
  }
  return result.outputText;
};

const cacheEnabled = (): boolean => process.env.LLM_CACHE === "1";

const cachePath = (system: string, user: string): string => {
  const hash = createHash("sha256").update(system).update("\u0000").update(user).digest("hex");
  return join(tmpdir(), `legal-explainer-llm-${hash}.json`);
};

const readCache = async <T>(path: string, schema: z.ZodType<T>): Promise<T | undefined> => {
  try {
    const parsed = schema.safeParse(JSON.parse(await readFile(path, "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined; // missing or unreadable cache file: just call the model
  }
};

const writeCache = async (path: string, value: unknown): Promise<void> => {
  try {
    await writeFile(path, JSON.stringify(value), "utf8");
  } catch {
    // caching is best effort
  }
};

/**
 * Sends `system` and `user` to the model and returns its JSON answer validated by `schema`.
 * Retries once if the answer cannot be parsed or validated, then throws a generic Error.
 */
export async function callLlmJson<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
  const path = cacheEnabled() ? cachePath(system, user) : undefined;
  if (path !== undefined) {
    const cached = await readCache(path, schema);
    if (cached !== undefined) return cached;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const prompt = attempt === 1 ? `${user}\n\n${JSON_ONLY_INSTRUCTION}` : `${user}\n\n${JSON_RETRY_INSTRUCTION}`;
    const value = parseAndValidate(await askModel(system, prompt), schema);
    if (value !== undefined) {
      if (path !== undefined) await writeCache(path, value);
      return value;
    }
  }
  throw new Error(`LLM response was not valid JSON for the expected schema after ${MAX_ATTEMPTS} attempts`);
}

export type LlmJsonFn = typeof callLlmJson;
