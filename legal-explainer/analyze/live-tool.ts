/**
 * MANUAL live check for the analyze_clause tool (NOT part of the test suite; the name does not
 * end in .test.ts). Calls the tool's execute() directly on ONE trap clause of the FAKE rental
 * agreement. It does not run an agent loop. Run from the repo root:  npx tsx analyze/live-tool.ts
 * Loads ../.env into this process only (never edited). Never prints the API key. The agreement
 * is invented, so printing clause and flag text is fine.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FlagSchema } from "../packages/shared/schemas";
import { TEN_CLAUSE_AGREEMENT } from "./fake-agreements";
import { analyzeClauseTool } from "./tool";

const HERE = dirname(fileURLToPath(import.meta.url));

function loadEnv(): void {
  try {
    process.loadEnvFile(resolve(HERE, "..", ".env"));
  } catch {
    console.log("No .env file loaded; using the existing environment.");
  }
}

async function main(): Promise<number> {
  loadEnv();
  console.log(`provider id: ${process.env.CLINE_PROVIDER_ID ?? "(missing)"}`);
  console.log(`model id: ${process.env.CLINE_MODEL_ID ?? "(missing)"}`);
  console.log(`api key: ${process.env.CLINE_API_KEY ? "set (not printed)" : "MISSING"}`);
  console.log(`stub: ${process.env.ANALYZE_USE_STUB === "1" ? "ON (mock, not a real test)" : "off"}`);
  console.log(
    `tool: ${analyzeClauseTool.name}, retryable=${String(analyzeClauseTool.retryable)}, ` +
      `timeoutMs=${analyzeClauseTool.timeoutMs}`,
  );

  const trap = TEN_CLAUSE_AGREEMENT.find((p) => p.kind === "TRAP" && p.clause.id === "c2");
  if (!trap) throw new Error("trap clause c2 missing from the fake agreement");
  const input = {
    clauseId: trap.clause.id,
    text: trap.clause.text,
    heading: trap.clause.heading,
    docType: "rental",
    language: "en",
  };
  console.log(`\ninput clause: ${input.clauseId} (${input.heading}) planted trap: ${trap.trap}`);
  console.log(`clause text:  ${input.text}\n`);

  const started = Date.now();
  let output;
  try {
    output = await analyzeClauseTool.execute(input, { agentId: "live-check", iteration: 1 });
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : "unexpected error";
    console.log(`execute FAILED after ${((Date.now() - started) / 1000).toFixed(1)} s -> ${reason}`);
    return 1;
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\nexecute finished in ${seconds} s`);
  console.log(`output keys: ${Object.keys(output).join(", ")}`);
  console.log(`flags returned: ${output.flags.length}\n`);
  for (const flag of output.flags) {
    console.log(`--- ${flag.clauseId} | ${flag.category} | ${flag.riskLevel.toUpperCase()}`);
    console.log(`  quote:        ${flag.quote}`);
    console.log(`  explanation:  ${flag.explanation}`);
    console.log(`  whyItMatters: ${flag.whyItMatters}`);
    console.log(`  questions:    ${flag.questionsToAsk.join(" | ")}`);
    if (flag.suggestion) console.log(`  suggestion:   ${flag.suggestion}`);
    console.log(`  quote is an exact substring of the clause: ${input.text.includes(flag.quote)}`);
  }

  const valid = output.flags.every((f) => FlagSchema.safeParse(f).success);
  const exact = output.flags.every((f) => input.text.includes(f.quote));
  const untouched = output.flags.every(
    (f) => f.citations.length === 0 && !f.quoteVerified && f.grounding === "unverified",
  );
  console.log("\nCHECKS");
  console.log(`  output is exactly { flags }: ${Object.keys(output).join() === "flags"}`);
  console.log(`  every flag passes FlagSchema: ${valid}`);
  console.log(`  every quote is an exact substring: ${exact}`);
  console.log(`  M3 fields left at defaults: ${untouched}`);
  console.log(`  flag for the planted trap clause: ${output.flags.some((f) => f.clauseId === input.clauseId)}`);
  return 0;
}

process.exit(await main());
