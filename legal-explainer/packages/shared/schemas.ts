/**
 * SHARED SCHEMAS: the single source of truth for every data shape in the project.
 *
 * RULES
 *  - Only M1 (integration lead) edits this file, after telling the team in the group chat.
 *  - Everyone else imports from here. Never redefine or copy these types.
 *  - Every module's output must pass the matching schema's `.parse()`.
 *
 * Usage:  import { Flag, FlagSchema } from "../shared/schemas";
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const DISCLAIMER =
  "This report highlights issues to review. It is not legal advice or a legal conclusion. " +
  "For important decisions, consult a qualified lawyer.";

export const LANGUAGES = ["en", "hi", "as", "bn", "ta", "te", "mr"] as const;
export const LanguageSchema = z.enum(LANGUAGES);
export type Language = z.infer<typeof LanguageSchema>;

export const DocumentTypeSchema = z.enum(["rental", "employment", "loan", "other"]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const RiskLevelSchema = z.enum(["green", "amber", "red"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const ClauseCategorySchema = z.enum([
  "deposit",
  "rent",
  "rent_escalation",
  "lock_in",
  "termination",
  "notice_period",
  "maintenance",
  "penalties",
  "fees",
  "entry_access",
  "renewal",
  "dispute_resolution",
  "non_compete",
  "other",
]);
export type ClauseCategory = z.infer<typeof ClauseCategorySchema>;

/* ------------------------------------------------------------------ */
/* Module 1: Ingest                                                    */
/* ------------------------------------------------------------------ */

export const ClauseSchema = z.object({
  id: z.string().min(1), // stable within one document, e.g. "c1", "c2"
  index: z.number().int().nonnegative(), // order in the document
  heading: z.string().optional(), // e.g. "Security Deposit"
  text: z.string().min(1), // exact clause text; later quotes must be substrings of this
  page: z.number().int().positive().optional(),
});
export type Clause = z.infer<typeof ClauseSchema>;

export const IngestResultSchema = z.object({
  documentId: z.string().min(1),
  filename: z.string(),
  docType: DocumentTypeSchema,
  pageCount: z.number().int().positive(),
  usedOcr: z.boolean(),
  clauses: z.array(ClauseSchema),
});
export type IngestResult = z.infer<typeof IngestResultSchema>;

/* ------------------------------------------------------------------ */
/* Module 2: Analysis                                                  */
/* ------------------------------------------------------------------ */

export const CitationSchema = z.object({
  sourceId: z.string().min(1), // id in the reference corpus
  title: z.string(),
  snippet: z.string(), // short supporting text from the corpus
  url: z.string().url().optional(),
  asOf: z.string().optional(), // date of the source, e.g. "2021-06"
});
export type Citation = z.infer<typeof CitationSchema>;

export const FlagSchema = z.object({
  clauseId: z.string().min(1), // must match a Clause.id
  category: ClauseCategorySchema,
  riskLevel: RiskLevelSchema,
  quote: z.string().min(1), // EXACT substring of the clause text (checked in module 3)
  explanation: z.string(), // plain-language meaning, in `language`
  whyItMatters: z.string(), // phrased as "worth asking about", never a verdict
  questionsToAsk: z.array(z.string()),
  suggestion: z.string().optional(), // negotiation idea
  language: LanguageSchema,
  // Filled in by module 3 (grounding). Module 2 leaves these at defaults.
  citations: z.array(CitationSchema).default([]),
  quoteVerified: z.boolean().default(false),
  grounding: z.enum(["supported", "unverified"]).default("unverified"),
});
export type Flag = z.infer<typeof FlagSchema>;

export const AnalysisResultSchema = z.object({
  documentId: z.string().min(1),
  language: LanguageSchema,
  flags: z.array(FlagSchema),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

/* ------------------------------------------------------------------ */
/* Module 4: Comparison                                                */
/* ------------------------------------------------------------------ */

export const ChangeTypeSchema = z.enum(["added", "removed", "softened", "hardened", "reworded"]);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;

export const ChangeSchema = z.object({
  id: z.string().min(1),
  changeType: ChangeTypeSchema,
  clauseIdA: z.string().optional(), // clause id in the older version (absent if added)
  clauseIdB: z.string().optional(), // clause id in the newer version (absent if removed)
  beforeText: z.string().optional(),
  afterText: z.string().optional(),
  severity: RiskLevelSchema,
  favors: z.enum(["signer", "other_party", "neutral"]), // who the change benefits
  explanation: z.string(),
  whyItMatters: z.string(),
  language: LanguageSchema,
});
export type Change = z.infer<typeof ChangeSchema>;

export const CompareResultSchema = z.object({
  documentIdA: z.string().min(1),
  documentIdB: z.string().min(1),
  summary: z.string(),
  changes: z.array(ChangeSchema),
});
export type CompareResult = z.infer<typeof CompareResultSchema>;

/* ------------------------------------------------------------------ */
/* Module 5: Report                                                    */
/* ------------------------------------------------------------------ */

export const ReportSchema = z.object({
  documentId: z.string().min(1),
  filename: z.string(),
  generatedAt: z.string().datetime(),
  language: LanguageSchema,
  disclaimer: z.string(),
  overallRisk: RiskLevelSchema,
  summary: z.string(),
  flags: z.array(FlagSchema),
  questionsToAsk: z.array(z.string()), // merged, de-duplicated, most important first
  negotiationTips: z.array(z.string()),
  comparison: CompareResultSchema.optional(),
});
export type Report = z.infer<typeof ReportSchema>;

/* ------------------------------------------------------------------ */
/* API envelopes and request bodies                                    */
/* ------------------------------------------------------------------ */

export const ApiErrorSchema = z.object({
  code: z.enum(["BAD_INPUT", "EXTRACTION_FAILED", "LLM_FAILED", "GROUNDING_FAILED", "INTERNAL"]),
  message: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const apiResponse = <T extends z.ZodTypeAny>(data: T) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: ApiErrorSchema }),
  ]);

export const AnalyzeRequestSchema = z.object({
  documentId: z.string().min(1),
  docType: DocumentTypeSchema,
  clauses: z.array(ClauseSchema),
  language: LanguageSchema.default("en"),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const GroundRequestSchema = z.object({
  clauses: z.array(ClauseSchema),
  flags: z.array(FlagSchema),
});
export type GroundRequest = z.infer<typeof GroundRequestSchema>;

export const CompareRequestSchema = z.object({
  versionA: IngestResultSchema,
  versionB: IngestResultSchema,
  language: LanguageSchema.default("en"),
});
export type CompareRequest = z.infer<typeof CompareRequestSchema>;

export const ReportRequestSchema = z.object({
  ingest: IngestResultSchema,
  flags: z.array(FlagSchema), // grounded flags
  comparison: CompareResultSchema.optional(),
  language: LanguageSchema.default("en"),
});
export type ReportRequest = z.infer<typeof ReportRequestSchema>;

export const ChatRequestSchema = z.object({
  sessionId: z.string().optional(), // omit to start a new agent session
  documentId: z.string().min(1),
  message: z.string().min(1),
  language: LanguageSchema.default("en"),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatResponseSchema = z.object({
  sessionId: z.string(),
  answer: z.string(),
  citations: z.array(CitationSchema).default([]),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
