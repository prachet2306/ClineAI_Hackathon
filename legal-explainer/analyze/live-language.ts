/**
 * MANUAL language live check (NOT part of the test suite; the name does not end in .test.ts).
 * Runs the real analyze() on the FAKE 10-clause rental agreement in Hindi ("hi") and then
 * Assamese ("as"). For each language it prints the explanation and whyItMatters for two flags
 * and checks: the quote is still the English original (an exact substring of the clause), the raw
 * JSON keys and enum values are intact, and the explanations really are in the target script.
 * Run from the repo root:  npx tsx analyze/live-language.ts
 * Loads ../.env into this process only (never edited). Never prints the API key. The agreement
 * is invented, so printing its text is fine.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ClauseCategorySchema,
  RiskLevelSchema,
  type AnalysisResult,
  type AnalyzeRequest,
  type Language,
} from "../packages/shared/schemas";
import { createAnalyze } from "./analyze";
import { TEN_CLAUSE_AGREEMENT } from "./fake-agreements";
import { callLlm as realCallLlm } from "./llm";

const HERE = dirname(fileURLToPath(import.meta.url));
const seconds = (ms: number): string => (ms / 1000).toFixed(1);
const REQUIRED_KEYS = ["clauseId", "category", "riskLevel", "quote", "explanation", "whyItMatters", "questionsToAsk"];
const textOf = (id: string): string =>
  TEN_CLAUSE_AGREEMENT.find((p) => p.clause.id === id)?.clause.text ?? "";

/** Hindi uses Devanagari; Assamese uses the Bengali-Assamese script. */
const SCRIPT: Record<string, { name: string; pattern: RegExp }> = {
  hi: { name: "Devanagari", pattern: /[\u0900-\u097F]/g },
  as: { name: "Bengali-Assamese", pattern: /[\u0980-\u09FF]/g },
};

function loadEnv(): void {
  try {
    process.loadEnvFile(resolve(HERE, "..", ".env"));
  } catch {
    console.log("No .env file loaded; using the existing environment.");
  }
}

/** Share of letters (not digits, spaces or punctuation) that are in the target script. */
function scriptShare(text: string, pattern: RegExp): number {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const inScript = text.match(pattern)?.length ?? 0;
  return letters === 0 ? 0 : inScript / letters;
}

/** Looks at the RAW model reply (before our parser touched it). */
function checkRaw(raw: string): string[] {
  const issues: string[] = [];
  const match = /\{[\s\S]*\}/.exec(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(match?.[0] ?? "");
  } catch {
    return ["raw reply is not valid JSON"];
  }
  const flags = (parsed as { flags?: unknown }).flags;
  if (!Array.isArray(flags)) return ["raw reply has no top-level flags array"];
  console.log(`  raw top-level keys: ${Object.keys(parsed as object).join(", ")}`);
  flags.forEach((item: unknown, i: number) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const missing = REQUIRED_KEYS.filter((k) => !(k in obj));
    if (missing.length > 0) issues.push(`flag #${i}: missing keys ${missing.join(", ")}`);
    if (!ClauseCategorySchema.safeParse(obj.category).success) {
      issues.push(`flag #${i}: category "${String(obj.category)}" is not an allowed English value`);
    }
    if (!RiskLevelSchema.safeParse(obj.riskLevel).success) {
      issues.push(`flag #${i}: riskLevel "${String(obj.riskLevel)}" is not red/amber/green`);
    }
  });
  console.log(`  raw flags returned by the model: ${flags.length}`);
  return issues;
}

function checkParsed(result: AnalysisResult, language: Language): string[] {
  const issues: string[] = [];
  const script = SCRIPT[language];
  console.log(`  parsed flags: ${result.flags.length}`);
  for (const f of result.flags) {
    const exact = textOf(f.clauseId).includes(f.quote);
    const quoteInScript = script ? scriptShare(f.quote, script.pattern) : 0;
    if (!exact) issues.push(`${f.clauseId}: quote is NOT an exact substring of the English clause`);
    if (quoteInScript > 0.2) issues.push(`${f.clauseId}: quote contains ${script?.name} text (translated?)`);
    if (f.language !== language) issues.push(`${f.clauseId}: flag.language is ${f.language}`);
    if (script) {
      for (const field of ["explanation", "whyItMatters"] as const) {
        const share = scriptShare(f[field], script.pattern);
        if (share < 0.5) issues.push(`${f.clauseId}: ${field} is only ${(share * 100).toFixed(0)}% ${script.name}`);
      }
      const qs = f.questionsToAsk.join(" ");
      if (qs !== "" && scriptShare(qs, script.pattern) < 0.5) issues.push(`${f.clauseId}: questionsToAsk not in ${script.name}`);
    }
  }
  const allExact = result.flags.every((f) => textOf(f.clauseId).includes(f.quote));
  console.log(`  every quote is an exact substring of its English clause: ${allExact}`);
  console.log(`  result.language: ${result.language}`);
  return issues;
}

function showTwo(result: AnalysisResult): void {
  const pick = ["c2", "c7"]
    .map((id) => result.flags.find((f) => f.clauseId === id))
    .filter((f): f is AnalysisResult["flags"][number] => f !== undefined);
  const chosen = pick.length >= 2 ? pick : result.flags.slice(0, 2);
  for (const f of chosen) {
    console.log(`\n  --- ${f.clauseId} | ${f.category} | ${f.riskLevel.toUpperCase()}`);
    console.log(`  quote (English original): ${f.quote}`);
    console.log(`  explanation:  ${f.explanation}`);
    console.log(`  whyItMatters: ${f.whyItMatters}`);
    console.log(`  first question: ${f.questionsToAsk[0] ?? "(none)"}`);
  }
}

async function runLanguage(language: Language): Promise<boolean> {
  console.log(`\n==================== language: ${language} ====================`);
  const raws: string[] = [];
  const analyze = createAnalyze({
    log: (m) => console.log(`[analyze] ${m}`),
    callLlm: async (system, user) => {
      const reply = await realCallLlm(system, user);
      raws.push(reply);
      return reply;
    },
  });
  const request: AnalyzeRequest = {
    documentId: `fake-rental-${language}`,
    docType: "rental",
    clauses: TEN_CLAUSE_AGREEMENT.map((p) => p.clause),
    language,
  };
  const started = Date.now();
  let result: AnalysisResult;
  try {
    result = await analyze(request);
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : "unexpected error";
    console.log(`analyze FAILED after ${seconds(Date.now() - started)} s -> ${reason}`);
    return false;
  }
  console.log(`finished in ${seconds(Date.now() - started)} s`);

  const lastRaw = raws[raws.length - 1] ?? "";
  const rawIssues = checkRaw(lastRaw);
  const parsedIssues = checkParsed(result, language);
  showTwo(result);

  const issues = [...rawIssues, ...parsedIssues];
  console.log(`\n  CHECKS for ${language}: ${issues.length === 0 ? "all passed" : `${issues.length} issue(s)`}`);
  for (const issue of issues) console.log(`   - ${issue}`);
  return issues.length === 0;
}

async function main(): Promise<number> {
  loadEnv();
  console.log(`provider id: ${process.env.CLINE_PROVIDER_ID ?? "(missing)"}`);
  console.log(`model id: ${process.env.CLINE_MODEL_ID ?? "(missing)"}`);
  console.log(`api key: ${process.env.CLINE_API_KEY ? "set (not printed)" : "MISSING"}`);

  const hi = await runLanguage("hi");
  const as = await runLanguage("as");
  console.log(`\nSUMMARY: hi ${hi ? "passed" : "had issues"}, as ${as ? "passed" : "had issues"}`);
  return 0;
}

process.exit(await main());

