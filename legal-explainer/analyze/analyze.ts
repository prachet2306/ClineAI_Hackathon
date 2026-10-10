/**
 * The real AnalyzeFn (module 2). Splits the clauses into batches, asks the LLM about each batch
 * (a few batches at a time), parses and validates every reply, applies the green flag rules in
 * code, and returns an AnalysisResult that passes AnalysisResultSchema.
 * Logs only counts and error codes: never document text, prompts or keys.
 * Set ANALYZE_USE_STUB=1 to return the shared mock instead of calling the LLM (off by default).
 */
import type { AnalyzeFn } from "../packages/shared/contracts";
import {
  AnalysisResultSchema,
  AnalyzeRequestSchema,
  type AnalysisResult,
  type AnalyzeRequest,
  type Clause,
  type ClauseCategory,
  type Flag,
  type Language,
} from "../packages/shared/schemas";
import { LlmError, callLlm as defaultCallLlm } from "./llm";
import {
  limitGreenFlags,
  parseFlags as defaultParseFlags,
  type DroppedFlag,
  type ParsedFlags,
} from "./parse";
import {
  DEFAULT_MAX_CHUNK_CHARS,
  MAX_GREEN_FLAGS_PER_DOCUMENT,
  buildPrompt,
  chunkClauses,
} from "./prompt";
import { isStubEnabled, loadStubResult } from "./stub";

/** How many batches may be waiting on the LLM at the same time. */
export const ANALYZE_CONCURRENCY = 3;

/** Each batch gets one first try plus one retry. */
export const ANALYZE_ATTEMPTS_PER_BATCH = 2;

/** Green flags are only allowed for these categories. Green flags in any other category are dropped. */
export const GREEN_ALLOWED_CATEGORIES: ReadonlySet<ClauseCategory> = new Set<ClauseCategory>([
  "deposit",
  "notice_period",
  "termination",
]);

export type AnalyzeErrorCode = "bad_input" | "llm_failed" | "internal";

/** Error with a fixed, safe message. The API layer maps it to LLM_FAILED (or BAD_INPUT). */
export class AnalyzeError extends Error {
  readonly code: AnalyzeErrorCode;

  constructor(code: AnalyzeErrorCode, message: string) {
    super(message);
    this.name = "AnalyzeError";
    this.code = code;
  }
}

/** Everything analyze() depends on. Tests replace these; production uses the defaults. */
export interface AnalyzeDeps {
  callLlm: (system: string, user: string) => Promise<string>;
  parseFlags: (raw: string, clauses: readonly Clause[], language: Language) => ParsedFlags;
  env: Readonly<Record<string, string | undefined>>;
  concurrency: number;
  maxChunkChars: number;
  log: (message: string) => void;
  loadStub: () => AnalysisResult;
}

const defaultDeps: AnalyzeDeps = {
  callLlm: defaultCallLlm,
  parseFlags: defaultParseFlags,
  env: process.env,
  concurrency: ANALYZE_CONCURRENCY,
  maxChunkChars: DEFAULT_MAX_CHUNK_CHARS,
  log: (message) => console.info(`[analyze] ${message}`),
  loadStub: loadStubResult,
};

/** A short code for logs. Never the error's text, which might contain document content. */
function errorCode(error: unknown): string {
  return error instanceof LlmError ? error.code : "invalid_reply";
}

/** "quote_not_found:2,unknown_clause:1": counts per reason, no text. */
function countReasons(dropped: readonly DroppedFlag[]): string {
  const counts = new Map<string, number>();
  for (const item of dropped) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  return [...counts].map(([reason, count]) => `${reason}:${count}`).join(",");
}

/**
 * Runs `worker` over `items` with at most `limit` running at once, and returns the results in
 * the original order. After the first failure no new item is started, and that error is thrown.
 */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;

  const lane = async (): Promise<void> => {
    while (!failed) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  const lanes = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
  await Promise.all(Array.from({ length: Math.min(lanes, items.length) }, lane));
  return results;
}

/**
 * Analyses one batch: callLlm, then parseFlags. Any LLM error, timeout or unusable reply is
 * retried once; after that it throws. A valid reply with an empty flags list is a success.
 * A missing-configuration error is not retried, because a retry cannot fix it.
 */
async function analyzeBatch(
  deps: AnalyzeDeps,
  req: AnalyzeRequest,
  batch: readonly Clause[],
  batchNumber: number,
): Promise<Flag[]> {
  const prompt = buildPrompt({
    docType: req.docType,
    language: req.language,
    clauses: [...batch],
    greenFlagsRemaining: MAX_GREEN_FLAGS_PER_DOCUMENT,
  });

  for (let attempt = 1; attempt <= ANALYZE_ATTEMPTS_PER_BATCH; attempt++) {
    try {
      const raw = await deps.callLlm(prompt.system, prompt.user);
      const { flags, dropped } = deps.parseFlags(raw, batch, req.language);
      deps.log(
        `batch ${batchNumber} ok: attempt=${attempt} flags=${flags.length} ` +
          `dropped=${dropped.length}${dropped.length > 0 ? ` (${countReasons(dropped)})` : ""}`,
      );
      return flags;
    } catch (error) {
      if (error instanceof LlmError && error.code === "not_configured") throw error;
      const willRetry = attempt < ANALYZE_ATTEMPTS_PER_BATCH;
      deps.log(
        `batch ${batchNumber} failed: attempt=${attempt} code=${errorCode(error)}` +
          `${willRetry ? " (retrying)" : ""}`,
      );
      if (!willRetry) {
        throw new AnalyzeError("llm_failed", "Analysis failed: the AI step did not return a usable result");
      }
    }
  }
  // Unreachable: the loop always returns or throws. Kept so the function is total.
  throw new AnalyzeError("llm_failed", "Analysis failed: the AI step did not return a usable result");
}

/** Sorts flags by the clause's position in the document, then by their order within the clause. */
function sortByClauseOrder(flags: readonly Flag[], clauses: readonly Clause[]): Flag[] {
  const position = new Map<string, number>(clauses.map((clause, i) => [clause.id, i]));
  return flags
    .map((flag, order) => ({ flag, order }))
    .sort(
      (a, b) =>
        (position.get(a.flag.clauseId) ?? Number.MAX_SAFE_INTEGER) -
          (position.get(b.flag.clauseId) ?? Number.MAX_SAFE_INTEGER) || a.order - b.order,
    )
    .map((entry) => entry.flag);
}

/** Drops green flags whose category is not allowed. Their risk level is never changed. */
function dropDisallowedGreen(flags: readonly Flag[]): { flags: Flag[]; removed: number } {
  const kept = flags.filter(
    (flag) => flag.riskLevel !== "green" || GREEN_ALLOWED_CATEGORIES.has(flag.category),
  );
  return { flags: kept, removed: flags.length - kept.length };
}

function parseRequest(input: AnalyzeRequest): AnalyzeRequest {
  const parsed = AnalyzeRequestSchema.safeParse(input);
  if (!parsed.success) {
    // Zod messages can echo input values, so never pass them on.
    throw new AnalyzeError("bad_input", "Invalid analyze request");
  }
  return parsed.data;
}

/** Builds analyze() with replaceable dependencies. Production code uses the exported `analyze`. */
export function createAnalyze(overrides: Partial<AnalyzeDeps> = {}): AnalyzeFn {
  return async function analyze(input: AnalyzeRequest): Promise<AnalysisResult> {
    const deps: AnalyzeDeps = { ...defaultDeps, ...overrides };
    const req = parseRequest(input);

    if (isStubEnabled(deps.env)) {
      deps.log("stub enabled: returning the shared mock");
      return deps.loadStub();
    }

    const batches = chunkClauses(req.clauses, deps.maxChunkChars);
    deps.log(`start: clauses=${req.clauses.length} batches=${batches.length} language=${req.language}`);

    const perBatch = await mapWithLimit(batches, deps.concurrency, (batch, index) =>
      analyzeBatch(deps, req, batch, index + 1),
    );

    // TODO(M3): citations plug in here. M3's GroundFn runs after this step and fills in
    // citations, quoteVerified and grounding. Until then they stay at the schema defaults.
    const ordered = sortByClauseOrder(perBatch.flat(), req.clauses);
    const allowed = dropDisallowedGreen(ordered);
    const capped = limitGreenFlags(allowed.flags, MAX_GREEN_FLAGS_PER_DOCUMENT);
    deps.log(
      `done: flags=${capped.flags.length} greenDroppedByCategory=${allowed.removed} ` +
        `greenDroppedByCap=${capped.removedGreen}`,
    );

    return AnalysisResultSchema.parse({
      documentId: req.documentId,
      language: req.language,
      flags: capped.flags,
    });
  };
}

/** The real AnalyzeFn (see packages/shared/contracts.ts). */
export const analyze: AnalyzeFn = createAnalyze();

