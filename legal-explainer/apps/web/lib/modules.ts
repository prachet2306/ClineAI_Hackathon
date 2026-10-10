// Schema-checked module integration and explicit, safe demo fallbacks; never logs documents.
import { z } from "zod";
import type { AnalyzeFn, GroundFn, CompareFn, ReportFn, RenderPdfFn } from "../../../packages/shared/contracts";
import { AnalysisResultSchema, AnalyzeRequestSchema, CompareRequestSchema, CompareResultSchema,
  FlagSchema, ReportSchema, ReportRequestSchema, DISCLAIMER, type IngestResult, type Language,
  type Flag, type CompareRequest, type Report } from "../../../packages/shared/schemas";
import analysisMock from "../../../packages/shared/mocks/analysis.json";
import groundMock from "../../../packages/shared/mocks/grounded.json";
import reportMock from "../../../packages/shared/mocks/report.json";
import compareMock from "../../../packages/shared/mocks/compare.json";
import { loadModule, deadline } from "../../../agent/runtime";

export async function stage<T>(name: string, real: () => Promise<unknown>, schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  fallback: () => unknown, usedMock: string[], ms = 20_000): Promise<T> {
  try { return schema.parse(await deadline(real(), ms)); }
  catch { usedMock.push(name); return schema.parse(fallback()); }
}

function safeFlags(flags: Flag[], ingest: IngestResult, mock: boolean): Flag[] {
  return flags.map((flag) => {
    const clause = ingest.clauses.find((c) => c.id === flag.clauseId);
    const quoteVerified = !!clause?.text.includes(flag.quote);
    const citations = mock ? [] : flag.citations.filter((c) => !/mock/i.test(c.sourceId + c.title));
    return { ...flag, quoteVerified, citations: flag.grounding === "supported" ? citations : [],
      grounding: flag.grounding === "supported" && citations.length ? "supported" as const : "unverified" as const };
  });
}
function matchedMock(ingest: IngestResult): Flag[] {
  return AnalysisResultSchema.parse(analysisMock).flags.flatMap((flag) => {
    const clause = ingest.clauses.find((c) => c.text.includes(flag.quote));
    return clause ? [{ ...flag, clauseId: clause.id }] : [];
  });
}

export async function pipeline(ingest: IngestResult, language: Language) {
  const usedMock: string[] = [];
  const request = AnalyzeRequestSchema.parse({ ...ingest, language });
  const analysis = await stage("analyze", async () => {
    const fn = (await loadModule("analyze/index.ts")).analyze as AnalyzeFn;
    const value = AnalysisResultSchema.parse(await fn(request));
    if (value.documentId !== ingest.documentId) throw new Error("Wrong document");
    return value;
  }, AnalysisResultSchema, () => ({ ...analysisMock, documentId: ingest.documentId, flags: matchedMock(ingest) }), usedMock, 35_000);
  const flags = await stage("ground", async () => {
    const fn = (await loadModule("ground/index.ts")).ground as GroundFn;
    return fn({ clauses: ingest.clauses, flags: analysis.flags });
  }, z.array(FlagSchema), () => {
    const templates = z.array(FlagSchema).parse(groundMock);
    return analysis.flags.map((flag) => ({ ...templates.find((f) => f.category === flag.category), ...flag,
      citations: [], grounding: "unverified", quoteVerified: false }));
  }, usedMock, 8_000);
  const grounded = safeFlags(flags, ingest, usedMock.includes("ground"));
  const reportRequest = ReportRequestSchema.parse({ ingest, flags: grounded, language });
  const report = await stage("report", async () => {
    const fn = (await loadModule("report/index.ts")).report as ReportFn;
    return fn(reportRequest);
  }, ReportSchema, () => ({ ...reportMock, documentId: ingest.documentId, filename: ingest.filename,
    generatedAt: new Date().toISOString(), flags: grounded, language: analysis.language,
    summary: "Demo fallback: review the available flags; this is not a complete assessment.",
    overallRisk: grounded.some((f) => f.riskLevel === "red") ? "red" : "amber",
    questionsToAsk: [...new Set(grounded.flatMap((f) => f.questionsToAsk))],
    negotiationTips: grounded.flatMap((f) => f.suggestion ? [f.suggestion] : []) }), usedMock);
  return { report: ReportSchema.parse({ ...report, documentId: ingest.documentId, filename: ingest.filename,
    disclaimer: DISCLAIMER, flags: safeFlags(report.flags, ingest, usedMock.includes("ground")) }), usedMock };
}

export async function compareDocuments(input: CompareRequest) {
  const req = CompareRequestSchema.parse(input);
  const usedMock: string[] = [];
  const comparison = await stage("compare", async () => {
    const fn = (await loadModule("compare/index.ts")).compare as CompareFn;
    return fn(req);
  }, CompareResultSchema, () => ({ ...compareMock, documentIdA: req.versionA.documentId,
    documentIdB: req.versionB.documentId, changes: compareMock.changes.map((change) => ({ ...change,
      clauseIdA: req.versionA.clauses.find((c) => c.text.includes(change.beforeText))?.id,
      clauseIdB: req.versionB.clauses.find((c) => c.text.includes(change.afterText))?.id,
    })) }), usedMock, 45_000);
  return { comparison, usedMock };
}

export async function renderPdf(report: Report): Promise<Buffer> {
  const fn = (await loadModule("report/index.ts")).renderPdf as RenderPdfFn;
  const buffer = await deadline(fn(ReportSchema.parse(report)), 15_000);
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 5).toString() !== "%PDF-") throw new Error("PDF unavailable");
  return buffer;
}
