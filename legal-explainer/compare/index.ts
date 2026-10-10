// M4 /compare: stub CompareFn that returns packages/shared/mocks/compare.json, parsed with its Zod schema.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompareFn } from "../packages/shared/contracts";
import { CompareResultSchema } from "../packages/shared/schemas";

const mockPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "shared",
  "mocks",
  "compare.json",
);

export const compare: CompareFn = async (_req) => {
  const raw: unknown = JSON.parse(readFileSync(mockPath, "utf8"));
  return CompareResultSchema.parse(raw);
};
