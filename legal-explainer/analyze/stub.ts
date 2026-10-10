/**
 * Stub for module 2: returns the shared analysis.json mock so others are never blocked.
 * OFF by default. analyze() uses it only when the environment variable ANALYZE_USE_STUB is
 * exactly "1". The mock is read with fs (read-only) and validated against AnalysisResultSchema.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AnalysisResultSchema, type AnalysisResult } from "../packages/shared/schemas";

export const STUB_ENV_NAME = "ANALYZE_USE_STUB";

/** True only when ANALYZE_USE_STUB is exactly "1". Any other value (or none) means off. */
export function isStubEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[STUB_ENV_NAME] === "1";
}

/** Reads packages/shared/mocks/analysis.json and validates it. */
export function loadStubResult(): AnalysisResult {
  const mockPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "packages",
    "shared",
    "mocks",
    "analysis.json",
  );
  return AnalysisResultSchema.parse(JSON.parse(readFileSync(mockPath, "utf8")));
}
