// M4 /compare: CompareFn. Aligns clauses in code (align.ts), classifies changes with one LLM call and assembles the result (build.ts).
// `compareWith` takes the LLM function as a parameter so tests can inject a fake; `compare` uses the real one.
import type { CompareFn } from "../packages/shared/contracts";
import {
  CompareRequestSchema,
  CompareResultSchema,
  type CompareRequest,
  type CompareResult,
} from "../packages/shared/schemas";
import { alignClauses } from "./align";
import { assembleChanges, buildSummary, buildSummaryUserPrompt, classifyCandidates } from "./build";
import { callLlmJson, type LlmJsonFn } from "./llm";
import { requestLocalizedSummary } from "./summary";

/** Internal: compare two versions using the given LLM function. The request is copied, never modified. */
export const compareWith = async (req: CompareRequest, llm: LlmJsonFn): Promise<CompareResult> => {
  const { versionA, versionB, language } = CompareRequestSchema.parse(structuredClone(req));

  const candidates = alignClauses(versionA.clauses, versionB.clauses);
  const classifications =
    candidates.length === 0
      ? new Map()
      : await classifyCandidates(versionA.clauses, versionB.clauses, candidates, language, llm);
  const changes = assembleChanges(candidates, classifications, language);

  // English keeps the template (no LLM call); other languages get one LLM call built from metadata only, with the template as fallback.
  const summary =
    language === "en"
      ? buildSummary(changes)
      : ((await requestLocalizedSummary(llm, language, buildSummaryUserPrompt(changes))) ?? buildSummary(changes));

  return CompareResultSchema.parse({
    documentIdA: versionA.documentId,
    documentIdB: versionB.documentId,
    summary,
    changes,
  });
};

export const compare: CompareFn = (req) => compareWith(req, callLlmJson);
