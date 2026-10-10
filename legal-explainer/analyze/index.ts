/**
 * Public entry point of module 2 (/analyze). Other modules and the API layer import from here.
 * `analyze` implements AnalyzeFn from packages/shared/contracts.ts.
 */
export {
  ANALYZE_ATTEMPTS_PER_BATCH,
  ANALYZE_CONCURRENCY,
  AnalyzeError,
  GREEN_ALLOWED_CATEGORIES,
  analyze,
  createAnalyze,
} from "./analyze";
export type { AnalyzeDeps, AnalyzeErrorCode } from "./analyze";
export { MAX_GREEN_FLAGS_PER_DOCUMENT } from "./prompt";
export {
  ANALYZE_CLAUSE_TOOL_NAME,
  ANALYZE_TOOL_TIMEOUT_MS,
  analyzeClauseTool,
  createAnalyzeClauseTool,
} from "./tool";
export type { AnalyzeClauseOutput } from "./tool";
export { STUB_ENV_NAME } from "./stub";
export type { AnalyzeFn } from "../packages/shared/contracts";
export type {
  AnalysisResult,
  AnalyzeRequest,
  Clause,
  ClauseCategory,
  Flag,
  Language,
  RiskLevel,
} from "../packages/shared/schemas";
