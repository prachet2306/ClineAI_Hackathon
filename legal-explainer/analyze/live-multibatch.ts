/**
 * MANUAL multi-batch live check (NOT part of the test suite; the name does not end in .test.ts).
 * Runs the real analyze() on a FAKE 40-clause rental agreement, which is long enough to be split
 * into several LLM batches, and reports batch count, time, concurrency, flag counts and errors.
 * Run from the repo root:  npx tsx analyze/live-multibatch.ts
 * Loads ../.env into this process only (never edited). Never prints the API key. The agreement
 * is invented, so printing flag ids and categories is fine; no clause text is printed.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnalysisResult, AnalyzeRequest } from "../packages/shared/schemas";
import { GREEN_ALLOWED_CATEGORIES, createAnalyze } from "./analyze";
import { LARGE_AGREEMENT } from "./fake-large-agreement";
import { callLlm as realCallLlm } from "./llm";
import { DEFAULT_MAX_CHUNK_CHARS, chunkClauses } from "./prompt";

const HERE = dirname(fileURLToPath(import.meta.url));
const seconds = (ms: number): string => (ms / 1000).toFixed(1);

function loadEnv(): void {
  try {
    process.loadEnvFile(resolve(HERE, "..", ".env"));
  } catch {
    console.log("No .env file loaded; using the existing environment.");
  }
}

function report(result: AnalysisResult): void {
  const count = (pick: (f: AnalysisResult["flags"][number]) => boolean): number =>
    result.flags.filter(pick).length;
  console.log(
    `\nflags: ${result.flags.length} (red ${count((f) => f.riskLevel === "red")}, ` +
      `amber ${count((f) => f.riskLevel === "amber")}, green ${count((f) => f.riskLevel === "green")})`,
  );
  for (const f of result.flags) console.log(`  ${f.clauseId} ${f.category} ${f.riskLevel}`);

  const badGreen = result.flags.filter(
    (f) => f.riskLevel === "green" && !GREEN_ALLOWED_CATEGORIES.has(f.category),
  );
  console.log(`green flags outside the allowed categories: ${badGreen.length}`);
  const ids = result.flags.map((f) => Number(f.clauseId.slice(1)));
  const inOrder = ids.every((n, i) => i === 0 || (ids[i - 1] ?? 0) <= n);
  console.log(`flags in clause order: ${inOrder}`);

  console.log("\nTRAP CHECK");
  const traps = LARGE_AGREEMENT.filter((p) => p.kind === "TRAP");
  let hit = 0;
  for (const t of traps) {
    const f = result.flags.find((x) => x.clauseId === t.clause.id);
    if (f) hit += 1;
    console.log(`  ${t.clause.id} (${t.trap}): ${f ? `flagged ${f.riskLevel}` : "NOT FLAGGED"}`);
  }
  console.log(`  -> ${hit} of ${traps.length} traps flagged`);

  const fair = LARGE_AGREEMENT.filter((p) => p.kind === "FAIR");
  const levels = (id: string): string[] =>
    result.flags.filter((f) => f.clauseId === id).map((f) => f.riskLevel);
  const flagged = fair.filter((p) => levels(p.clause.id).length > 0);
  const red = fair.filter((p) => levels(p.clause.id).includes("red"));
  console.log(`\nFAIR CLAUSE CHECK (${fair.length} fair clauses)`);
  for (const p of flagged) {
    console.log(`  ${p.clause.id} (${p.clause.heading}): ${levels(p.clause.id).join(",")}`);
  }
  console.log(`  -> fair clauses flagged at all: ${flagged.length}`);
  console.log(`  -> fair clauses wrongly marked RED: ${red.length}`);
}

async function main(): Promise<number> {
  loadEnv();
  console.log(`provider id: ${process.env.CLINE_PROVIDER_ID ?? "(missing)"}`);
  console.log(`model id: ${process.env.CLINE_MODEL_ID ?? "(missing)"}`);
  console.log(`api key: ${process.env.CLINE_API_KEY ? "set (not printed)" : "MISSING"}`);

  const clauses = LARGE_AGREEMENT.map((p) => p.clause);
  const chars = clauses.reduce((sum, c) => sum + c.text.length, 0);
  const sizes = chunkClauses(clauses, DEFAULT_MAX_CHUNK_CHARS).map((b) => b.length);
  console.log(`\nfake agreement: ${clauses.length} clauses, ${chars} characters of clause text`);
  console.log(`expected batches: ${sizes.length} (clauses per batch: ${sizes.join(", ")})\n`);

  let running = 0;
  let peak = 0;
  const callTimes: number[] = [];
  const logs: string[] = [];
  const analyze = createAnalyze({
    log: (message) => {
      logs.push(message);
      console.log(`[analyze] ${message}`);
    },
    callLlm: async (system, user) => {
      running += 1;
      peak = Math.max(peak, running);
      const started = Date.now();
      try {
        return await realCallLlm(system, user);
      } finally {
        running -= 1;
        callTimes.push(Date.now() - started);
      }
    },
  });

  const request: AnalyzeRequest = {
    documentId: "fake-large-001",
    docType: "rental",
    clauses,
    language: "en",
  };
  const started = Date.now();
  let result: AnalysisResult;
  try {
    result = await analyze(request);
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : "unexpected error";
    console.log(`\nanalyze FAILED after ${seconds(Date.now() - started)} s -> ${reason}`);
    console.log(`LLM calls made: ${callTimes.length}, peak concurrency: ${peak}`);
    return 1;
  }
  const total = Date.now() - started;

  const okBatches = logs.filter((l) => /^batch \d+ ok/.test(l)).length;
  const retries = logs.filter((l) => l.includes("(retrying)")).length;
  console.log(`\nSUMMARY`);
  console.log(`  batches completed: ${okBatches} (expected ${sizes.length})`);
  console.log(`  LLM calls made: ${callTimes.length}, retries: ${retries}, errors: 0 (no throw)`);
  console.log(`  peak concurrency observed: ${peak}`);
  console.log(`  per-call time (s): ${callTimes.map((t) => seconds(t)).join(", ")}`);
  console.log(`  slowest call: ${seconds(Math.max(...callTimes))} s, sum of calls: ${seconds(callTimes.reduce((a, b) => a + b, 0))} s`);
  console.log(`  total time: ${seconds(total)} s`);
  report(result);
  return 0;
}

process.exit(await main());
