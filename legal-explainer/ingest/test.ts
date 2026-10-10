// Test script for ingest: PDF, image, pasted text, a non-legal text (must be rejected), an unnumbered agreement
// (model split, or the paragraph fallback when no model is configured), and a rapid second submit.
// Run from the repo root: node --env-file=.env --import tsx ingest/test.ts   (env file only needed for model calls)
// Set INGEST_OCR=tesseract to force local OCR. Prints counts, short headings and timings only, never full text or keys.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IngestResultSchema, type IngestResult } from "../packages/shared/schemas";
import { IngestError, realIngest } from "./index";
import { NOT_LEGAL_MESSAGE } from "./legal-gate";

const dir = join(dirname(fileURLToPath(import.meta.url)), "samples");
const read = (file: string) => readFileSync(join(dir, file));
const run = async (file: string): Promise<IngestResult> =>
  IngestResultSchema.parse(await realIngest({ pdf: read(file), filename: file }));

let failed = false;
function report(name: string, checks: Record<string, boolean>, note = "") {
  const ok = Object.values(checks).every(Boolean);
  failed ||= !ok;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${note ? `: ${note}` : ""}`);
  for (const [label, pass] of Object.entries(checks)) if (!pass) console.log(`     failed check: ${label}`);
}
const summary = (r: IngestResult) =>
  `${r.clauses.length} clauses, docType=${r.docType}, usedOcr=${r.usedOcr}\n     headings: ${r.clauses.map((c) => c.heading ?? "-").join(" | ")}`;
const errorLine = (e: unknown) => (e instanceof Error ? `${e.name} ${e.message}` : "unknown error");

/** The clause text must be an exact piece of the source text (no rewriting). */
const allSubstrings = (r: IngestResult, source: string) => r.clauses.every((c) => source.includes(c.text));

async function expectRental(name: string, file: string, expectOcr: boolean) {
  try {
    const r = await run(file);
    report(
      name,
      {
        "has 4+ clauses": r.clauses.length >= 4,
        "docType is rental": r.docType === "rental",
        [`usedOcr is ${expectOcr}`]: r.usedOcr === expectOcr,
        "mentions deposit": r.clauses.some((c) => /deposit/i.test(c.text)),
        "ids unique": new Set(r.clauses.map((c) => c.id)).size === r.clauses.length,
        "no tiny fragments": r.clauses.every((c) => c.text.length >= 40),
      },
      summary(r),
    );
  } catch (error) {
    report(name, { "ran without error": false }, errorLine(error));
  }
}

async function expectRejected(name: string, file: string) {
  try {
    await run(file);
    report(name, { "was rejected": false });
  } catch (error) {
    const ok = error instanceof IngestError && error.code === "BAD_INPUT" && error.message === NOT_LEGAL_MESSAGE;
    report(name, { "rejected with BAD_INPUT and the fixed message": ok }, ok ? "rejected" : errorLine(error));
  }
}

async function unnumbered(name: string, file: string) {
  const source = read(file).toString("utf8");
  const hasModel = ["CLINE_PROVIDER_ID", "CLINE_MODEL_ID", "CLINE_API_KEY"].every((k) => process.env[k]?.trim());
  try {
    const t0 = Date.now();
    const r = await run(file);
    report(
      name,
      {
        "split into 5+ clauses": r.clauses.length >= 5,
        "every clause is an exact substring of the original": allSubstrings(r, source),
        "no tiny fragments": r.clauses.every((c) => c.text.length >= 40),
      },
      `${hasModel ? "model path enabled" : "no model settings: paragraph fallback"}, ${Date.now() - t0} ms, ${summary(r)}`,
    );
  } catch (error) {
    report(name, { "ran without error": false }, errorLine(error));
  }
}

async function rapidSecondSubmit(name: string) {
  // Two submits at once on the scanned sample: both must finish (or fail cleanly), never hang.
  const t0 = Date.now();
  const limit = new Promise<"hang">((resolve) => setTimeout(() => resolve("hang"), 100_000));
  const both = Promise.allSettled([run("sample-scan.png"), run("sample-scan.png")]);
  const outcome = await Promise.race([both, limit]);
  if (outcome === "hang") return report(name, { "both finished within 100 s": false });
  report(
    name,
    {
      "both finished": outcome.length === 2,
      "each succeeded or failed with an IngestError": outcome.every(
        (o) => o.status === "fulfilled" || o.reason instanceof IngestError,
      ),
    },
    `${outcome.map((o) => o.status).join(", ")} in ${Date.now() - t0} ms`,
  );
}

await expectRental("digital PDF", "sample-digital.pdf", false);
await expectRental("scanned image", "sample-scan.png", true);
await expectRental("pasted text", "sample-pasted.txt", false);
await expectRejected("non-legal text (recipe)", "sample-recipe.txt");
await unnumbered("unnumbered agreement", "sample-unnumbered.txt");
await rapidSecondSubmit("rapid second submit");

process.exitCode = failed ? 1 : 0;
