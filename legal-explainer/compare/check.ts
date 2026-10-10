// M4 check: calls each stub (compare, report, renderPdf), runs .parse() on the result and prints PASS or FAIL per module.
// Failure output lists only schema issue paths and codes, never document text or values.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { IngestResultSchema, CompareResultSchema, ReportSchema } from "../packages/shared/schemas";
import { compare } from "./index";
import { renderPdf, report } from "../report/index";

const mocksDir = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "shared", "mocks");
const ingest = IngestResultSchema.parse(JSON.parse(readFileSync(join(mocksDir, "ingest.json"), "utf8")));

let failed = false;

const run = async (name: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL  ${name}`);
    if (err instanceof z.ZodError) {
      for (const issue of err.issues) console.error(`      ${issue.path.join(".")}: ${issue.code}`);
    } else {
      console.error(`      ${err instanceof Error ? err.name : "UnknownError"}`);
    }
  }
};

const main = async () => {
  await run("compare", async () => CompareResultSchema.parse(await compare({ versionA: ingest, versionB: ingest, language: "en" })));

  let sampleReport: z.infer<typeof ReportSchema> | undefined;
  await run("report", async () => {
    sampleReport = ReportSchema.parse(await report({ ingest, flags: [], language: "en" }));
  });

  await run("renderPdf", async () => {
    if (!sampleReport) throw new Error("report unavailable");
    const pdf = z.instanceof(Buffer).parse(await renderPdf(sampleReport));
    z.string().startsWith("%PDF-").parse(pdf.subarray(0, 5).toString("latin1"));
  });

  if (failed) process.exit(1);
};

void main();
