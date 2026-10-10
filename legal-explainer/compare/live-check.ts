// M4 live check for compare (separate from check.ts because it calls the real model).
// Run: npx.cmd tsx --env-file=.env compare/live-check.ts   Prints only the change count and each change's id, changeType, severity and favors.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CompareRequestSchema } from "../packages/shared/schemas";
import { compare } from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const load = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const main = async () => {
  try {
    const req = CompareRequestSchema.parse({
      versionA: load(join(here, "..", "packages", "shared", "mocks", "ingest.json")),
      versionB: load(join(here, "fixtures", "versionB.json")),
      language: "en",
    });
    const result = await compare(req);
    console.log(`changes: ${result.changes.length}`);
    for (const change of result.changes) {
      console.log(`${change.id} changeType=${change.changeType} severity=${change.severity} favors=${change.favors}`);
    }
  } catch {
    console.log("FAIL");
    process.exitCode = 1;
  }
};

void main();
