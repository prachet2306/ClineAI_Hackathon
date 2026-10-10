/**
 * Checks that every mock file matches the shared schemas, and that every flag quote really
 * appears in its clause text. Run:  npm run validate:mocks
 * Run it after ANY change to schemas.ts or to a mock file.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  AnalysisResultSchema,
  CompareResultSchema,
  FlagSchema,
  IngestResultSchema,
  ReportSchema,
} from "./schemas";

const dir = join(dirname(fileURLToPath(import.meta.url)), "mocks");
const load = (name: string) => JSON.parse(readFileSync(join(dir, name), "utf8"));

let failed = false;
const check = (name: string, schema: z.ZodTypeAny) => {
  const result = schema.safeParse(load(name));
  if (result.success) {
    console.log(`OK    ${name}`);
  } else {
    failed = true;
    console.error(`FAIL  ${name}`);
    console.error(JSON.stringify(result.error.issues, null, 2));
  }
};

check("ingest.json", IngestResultSchema);
check("analysis.json", AnalysisResultSchema);
check("grounded.json", z.array(FlagSchema));
check("compare.json", CompareResultSchema);
check("report.json", ReportSchema);

// Quote-back rule: every flag quote must be an exact substring of its clause.
const ingest = IngestResultSchema.parse(load("ingest.json"));
const byId = new Map(ingest.clauses.map((c) => [c.id, c.text]));
const flagSets: [string, z.infer<typeof FlagSchema>[]][] = [
  ["analysis.json", AnalysisResultSchema.parse(load("analysis.json")).flags],
  ["grounded.json", z.array(FlagSchema).parse(load("grounded.json"))],
];
for (const [name, flags] of flagSets) {
  for (const flag of flags) {
    const text = byId.get(flag.clauseId);
    if (!text || !text.includes(flag.quote)) {
      failed = true;
      console.error(`FAIL  ${name}: quote for clause ${flag.clauseId} is not in the clause text`);
    }
  }
}

if (failed) process.exit(1);
console.log("All mocks valid.");
