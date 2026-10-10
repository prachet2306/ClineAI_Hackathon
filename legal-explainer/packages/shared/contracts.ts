/**
 * MODULE FUNCTION CONTRACTS
 *
 * Each module owner implements ONE plain function with exactly this signature in their own
 * folder (e.g. /ingest/index.ts exports `ingest`). The function must be usable without the UI,
 * the web server or the Cline agent. M4 wraps these functions as Cline SDK tools afterwards.
 *
 * Until a module is ready, its folder must export a stub that returns the matching mock from
 * /packages/shared/mocks so downstream members are never blocked.
 */
import type {
  AnalysisResult,
  AnalyzeRequest,
  Clause,
  CompareRequest,
  CompareResult,
  Flag,
  IngestResult,
  Language,
  Report,
  ReportRequest,
} from "./schemas";

/** M1: /ingest */
export type IngestFn = (input: { pdf: Buffer; filename: string }) => Promise<IngestResult>;

/** M2: /analyze */
export type AnalyzeFn = (req: AnalyzeRequest) => Promise<AnalysisResult>;

/** M3: /ground. Takes M2's flags, returns the same flags with citations, quoteVerified, grounding set. */
export type GroundFn = (input: { clauses: Clause[]; flags: Flag[] }) => Promise<Flag[]>;

/** M3: used by the chat agent to look up reference material. */
export type RetrieveFn = (input: { query: string; topK?: number }) => Promise<
  { sourceId: string; title: string; snippet: string; url?: string; asOf?: string }[]
>;

/** M4: /compare */
export type CompareFn = (req: CompareRequest) => Promise<CompareResult>;

/** M4: /report */
export type ReportFn = (req: ReportRequest) => Promise<Report>;

/** M4: renders a Report to a PDF buffer for download. */
export type RenderPdfFn = (report: Report) => Promise<Buffer>;

export type { Language };
