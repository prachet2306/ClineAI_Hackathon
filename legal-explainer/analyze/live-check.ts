/**
 * MANUAL latency check for analyze/llm.ts. It is NOT part of the test suite (the name does not
 * end in .test.ts). Makes several real LLM calls, so it can take minutes and uses credits.
 * Run from the repo root:  npx tsx analyze/live-check.ts
 * Loads ../.env into this process only (the file is never edited). Prints timings, counts and
 * model ids only: never the API key and never any document text.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IngestResultSchema, type Clause } from "../packages/shared/schemas";
import { LlmError, callLlm } from "./llm";
import { parseFlags } from "./parse";
import { buildPrompt } from "./prompt";

const SYSTEM = "Reply with JSON only";
const USER = 'Return {"ok":true}';
const QUICKSTART_MODEL_ID = "anthropic/claude-sonnet-4.6";
const HERE = dirname(fileURLToPath(import.meta.url));

// The mock ingest data has only 3 clauses, so two short invented clauses bring it to 5.
const EXTRA_CLAUSES: Clause[] = [
  {
    id: "c4",
    index: 3,
    heading: "Maintenance",
    text:
      "Maintenance. The Tenant shall bear the cost of all repairs to the premises, including " +
      "structural repairs and repairs needed because of normal wear and tear, regardless of cause.",
  },
  {
    id: "c5",
    index: 4,
    heading: "Entry and Inspection",
    text:
      "Entry and Inspection. The Landlord or the Landlord's agents may enter the premises at any " +
      "time, with or without notice, for inspection or any other purpose the Landlord considers " +
      "appropriate.",
  },
];

interface Row {
  step: string;
  model: string;
  seconds: string;
  result: string;
}
const rows: Row[] = [];

const seconds = (ms: number): string => (ms / 1000).toFixed(1);
const currentModel = (): string => process.env.CLINE_MODEL_ID ?? "(missing)";

function describeError(error: unknown): string {
  return error instanceof LlmError ? `${error.code}: ${error.message}` : "unexpected error";
}

function loadEnv(): void {
  try {
    process.loadEnvFile(resolve(HERE, "..", ".env"));
  } catch {
    console.log("No .env file loaded; using the existing environment.");
  }
}

type Timed = { ok: true; text: string; ms: number } | { ok: false; error: string; ms: number };

async function timedCall(system: string, user: string): Promise<Timed> {
  const started = Date.now();
  try {
    const text = await callLlm(system, user);
    return { ok: true, text, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, error: describeError(error), ms: Date.now() - started };
  }
}

async function trivialCall(step: string): Promise<void> {
  const r = await timedCall(SYSTEM, USER);
  const result = r.ok ? `OK (${r.text.trim().length} chars)` : `FAILED ${r.error}`;
  rows.push({ step, model: currentModel(), seconds: seconds(r.ms), result });
  console.log(`[${step}] ${seconds(r.ms)} s  ${result}`);
}

async function realisticCall(step: string): Promise<void> {
  const mockPath = resolve(HERE, "..", "packages", "shared", "mocks", "ingest.json");
  const ingest = IngestResultSchema.parse(JSON.parse(readFileSync(mockPath, "utf8")));
  const clauses = [...ingest.clauses, ...EXTRA_CLAUSES].slice(0, 5);
  const prompt = buildPrompt({ docType: ingest.docType, language: "en", clauses });
  console.log(
    `[${step}] prompt: ${clauses.length} clauses, system ${prompt.system.length} chars, ` +
      `user ${prompt.user.length} chars`,
  );

  const r = await timedCall(prompt.system, prompt.user);
  if (!r.ok) {
    rows.push({ step, model: currentModel(), seconds: seconds(r.ms), result: `FAILED ${r.error}` });
    console.log(`[${step}] ${seconds(r.ms)} s  FAILED ${r.error}`);
    return;
  }
  console.log(`[${step}] reply: ${r.text.length} chars`);
  try {
    const { flags, dropped } = parseFlags(r.text, clauses, "en");
    const risk = (level: string): number => flags.filter((f) => f.riskLevel === level).length;
    const result =
      `flags=${flags.length} (red ${risk("red")}, amber ${risk("amber")}, green ${risk("green")}), ` +
      `dropped=${dropped.length}`;
    rows.push({ step, model: currentModel(), seconds: seconds(r.ms), result });
    console.log(`[${step}] ${seconds(r.ms)} s  ${result}`);
    for (const f of flags) console.log(`    flag: ${f.clauseId} ${f.category} ${f.riskLevel}`);
    for (const d of dropped) console.log(`    dropped: #${d.index} ${d.reason}`);
  } catch {
    const result = "reply was not usable JSON";
    rows.push({ step, model: currentModel(), seconds: seconds(r.ms), result });
    console.log(`[${step}] ${seconds(r.ms)} s  ${result}`);
  }
}

async function main(): Promise<void> {
  loadEnv();
  console.log(`provider id: ${process.env.CLINE_PROVIDER_ID ?? "(missing)"}`);
  console.log(`model id: ${currentModel()}`);
  console.log(`api key: ${process.env.CLINE_API_KEY ? "set (not printed)" : "MISSING"}`);

  // Loading the SDK is part of the first call's time, so measure it on its own first.
  const importStarted = Date.now();
  await import("@cline/sdk");
  const importMs = Date.now() - importStarted;
  console.log(`[0. load @cline/sdk] ${seconds(importMs)} s`);
  rows.push({ step: "0. load @cline/sdk", model: "-", seconds: seconds(importMs), result: "OK" });

  await trivialCall("1a. trivial");
  await trivialCall("1b. trivial");
  await realisticCall("2. realistic (5 clauses)");

  // Temporary override for this process only; the .env file is not changed.
  const original = process.env.CLINE_MODEL_ID;
  process.env.CLINE_MODEL_ID = QUICKSTART_MODEL_ID;
  try {
    await trivialCall("3. trivial, quickstart model");
  } finally {
    if (original === undefined) delete process.env.CLINE_MODEL_ID;
    else process.env.CLINE_MODEL_ID = original;
  }

  console.log("\nSUMMARY");
  for (const r of rows) {
    console.log(`| ${r.step} | ${r.model} | ${r.seconds} s | ${r.result} |`);
  }
}

await main();
process.exit(0);

