// M4 live check for the Hindi report summary (separate from check.ts because it calls the real model).
// Run: npx.cmd tsx --env-file=.env compare/live-check-hi.ts   Prints only the report's summary field.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AnalysisResultSchema, IngestResultSchema, ReportRequestSchema } from "../packages/shared/schemas";
import { report } from "../report/index";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string): unknown =>
  JSON.parse(readFileSync(join(here, "..", "packages", "shared", "mocks", name), "utf8"));

const main = async () => {
  try {
    const ingest = IngestResultSchema.parse(load("ingest.json"));
    const analysis = AnalysisResultSchema.parse(load("analysis.json"));
    const req = ReportRequestSchema.parse({ ingest, flags: analysis.flags, language: "hi" });
    const result = await report(req);
    console.log(result.summary);
  } catch {
    console.log("FAIL");
    process.exitCode = 1;
  }
};

void main();
