/**
 * MANUAL live check for the real analyze() (NOT part of the test suite; the name does not end
 * in .test.ts). Runs analyze on a FAKE rental agreement with 3 planted traps and 7 fair clauses,
 * then reports which traps were flagged and whether any fair clause was marked red.
 * Run from the repo root:  npx tsx analyze/live-analyze.ts
 * Loads ../.env into this process only (never edited). Never prints the API key. It prints the
 * fake clause excerpts, which is fine because the sample is invented.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnalysisResult, AnalyzeRequest, Clause } from "../packages/shared/schemas";
import { analyze } from "./analyze";

const HERE = dirname(fileURLToPath(import.meta.url));

type Kind = "TRAP" | "FAIR";
interface Planted {
  kind: Kind;
  trap?: string;
  clause: Clause;
}

const c = (n: number, heading: string, text: string): Clause => ({
  id: `c${n}`,
  index: n - 1,
  heading,
  text,
  page: 1,
});

const PLANTED: Planted[] = [
  {
    kind: "FAIR",
    clause: c(
      1,
      "Parties and Premises",
      "Parties and Premises. This Agreement is made between Mr. A. Kumar (the Landlord) and Ms. R. " +
        "Singh (the Tenant) for the residential flat at 12 Example Street, Sample City, for use as a " +
        "private residence only.",
    ),
  },
  {
    kind: "TRAP",
    trap: "vague deposit deduction",
    clause: c(
      2,
      "Security Deposit",
      "Security Deposit. The Tenant shall pay a security deposit of Rs. 50,000 at signing. The " +
        "Landlord may deduct from the deposit any amounts for damages, cleaning, repainting and other " +
        "charges as the Landlord deems necessary, and the balance will be refunded within a " +
        "reasonable time after the Tenant vacates.",
    ),
  },
  {
    kind: "FAIR",
    clause: c(
      3,
      "Term",
      "Term. This Agreement starts on 1 January and continues for eleven (11) months, and may be " +
        "renewed for a further term by written agreement of both parties.",
    ),
  },
  {
    kind: "FAIR",
    clause: c(
      4,
      "Rent and Payment",
      "Rent and Payment. The Tenant shall pay monthly rent of Rs. 20,000 on or before the 5th day " +
        "of each month by bank transfer, and the Landlord shall give a written receipt on request.",
    ),
  },
  {
    kind: "TRAP",
    trap: "automatic rent escalation",
    clause: c(
      5,
      "Rent Revision",
      "Rent Revision. The monthly rent shall increase by 15% every year on the anniversary of this " +
        "Agreement, without the need for any notice to the Tenant.",
    ),
  },
  {
    kind: "FAIR",
    clause: c(
      6,
      "Utilities",
      "Utilities. The Tenant shall pay electricity and water charges according to the meter " +
        "readings, and the Landlord shall pay property tax and society maintenance charges.",
    ),
  },
  {
    kind: "TRAP",
    trap: "one-sided notice period",
    clause: c(
      7,
      "Termination",
      "Termination. The Tenant shall give three (3) months' written notice to terminate this " +
        "Agreement. The Landlord may terminate this Agreement at any time by giving fifteen (15) " +
        "days' notice.",
    ),
  },
  {
    kind: "FAIR",
    clause: c(
      8,
      "Repairs",
      "Repairs. The Landlord shall pay for structural repairs and repairs to fixtures supplied by " +
        "the Landlord. The Tenant shall pay for minor repairs caused by the Tenant's own use, up to " +
        "Rs. 1,000 per repair.",
    ),
  },
  {
    kind: "FAIR",
    clause: c(
      9,
      "Landlord Access",
      "Landlord Access. The Landlord may inspect the premises once every three months after giving " +
        "the Tenant at least 48 hours' prior notice, and at any time without notice only in an " +
        "emergency.",
    ),
  },
  {
    kind: "FAIR",
    clause: c(
      10,
      "Governing Law",
      "Governing Law. This Agreement is governed by the laws of India, and the courts at Sample " +
        "City shall have jurisdiction over any dispute.",
    ),
  },
];

function loadEnv(): void {
  try {
    process.loadEnvFile(resolve(HERE, "..", ".env"));
  } catch {
    console.log("No .env file loaded; using the existing environment.");
  }
}

const textOf = (id: string): string => PLANTED.find((p) => p.clause.id === id)?.clause.text ?? "";

function printFlags(result: AnalysisResult): void {
  for (const flag of result.flags) {
    const planted = PLANTED.find((p) => p.clause.id === flag.clauseId);
    console.log(
      `--- ${flag.clauseId} | ${flag.category} | ${flag.riskLevel.toUpperCase()} | ` +
        `clause is ${planted?.kind ?? "?"}`,
    );
    console.log(`  quote:        ${flag.quote}`);
    console.log(`  explanation:  ${flag.explanation}`);
    console.log(`  whyItMatters: ${flag.whyItMatters}`);
    console.log(`  questions:    ${flag.questionsToAsk.join(" | ")}`);
    if (flag.suggestion) console.log(`  suggestion:   ${flag.suggestion}`);
    console.log(`  quote is exact substring of its clause: ${textOf(flag.clauseId).includes(flag.quote)}`);
  }
}

function checkTraps(result: AnalysisResult): void {
  console.log("\nTRAP CHECK");
  const traps = PLANTED.filter((p) => p.kind === "TRAP");
  let flagged = 0;
  for (const trap of traps) {
    const hit = result.flags.find((f) => f.clauseId === trap.clause.id);
    if (hit) flagged += 1;
    console.log(`  ${trap.clause.id} (${trap.trap}): ${hit ? `flagged ${hit.riskLevel}` : "NOT FLAGGED"}`);
  }
  console.log(`  -> ${flagged} of ${traps.length} traps flagged`);
}

function checkFair(result: AnalysisResult): void {
  console.log("\nFAIR CLAUSE CHECK");
  const fair = PLANTED.filter((p) => p.kind === "FAIR");
  const levelsFor = (id: string): string[] =>
    result.flags.filter((f) => f.clauseId === id).map((f) => f.riskLevel);
  const flaggedFair = fair.filter((p) => levelsFor(p.clause.id).length > 0);
  const wronglyRed = fair.filter((p) => levelsFor(p.clause.id).includes("red"));
  for (const p of flaggedFair) {
    console.log(`  ${p.clause.id} (${p.clause.heading}) is FAIR but flagged: ${levelsFor(p.clause.id).join(",")}`);
  }
  console.log(`  -> fair clauses flagged at all: ${flaggedFair.length} of ${fair.length}`);
  const ids = wronglyRed.map((p) => p.clause.id).join(", ");
  console.log(`  -> fair clauses wrongly marked RED: ${wronglyRed.length}${ids ? ` (${ids})` : ""}`);
}

async function main(): Promise<number> {
  loadEnv();
  console.log(`provider id: ${process.env.CLINE_PROVIDER_ID ?? "(missing)"}`);
  console.log(`model id: ${process.env.CLINE_MODEL_ID ?? "(missing)"}`);
  console.log(`api key: ${process.env.CLINE_API_KEY ? "set (not printed)" : "MISSING"}`);
  console.log(`stub: ${process.env.ANALYZE_USE_STUB === "1" ? "ON (mock, not a real test)" : "off"}`);

  const request: AnalyzeRequest = {
    documentId: "fake-rental-001",
    docType: "rental",
    clauses: PLANTED.map((p) => p.clause),
    language: "en",
  };

  const started = Date.now();
  let result: AnalysisResult;
  try {
    result = await analyze(request);
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : "unexpected error";
    console.log(`\nanalyze FAILED after ${((Date.now() - started) / 1000).toFixed(1)} s -> ${reason}`);
    return 1;
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\nanalyze finished in ${seconds} s: ${result.flags.length} flags\n`);
  printFlags(result);
  checkTraps(result);
  checkFair(result);
  console.log(`\nTotal time: ${seconds} s`);
  return 0;
}

process.exit(await main());

