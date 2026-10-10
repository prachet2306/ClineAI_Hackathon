// M4 /report: ReportFn (built by ./build.ts) and stub RenderPdfFn (returns a tiny placeholder PDF; never includes report text).
import type { RenderPdfFn, ReportFn } from "../packages/shared/contracts";
import { ReportRequestSchema, ReportSchema, type Report, type ReportRequest } from "../packages/shared/schemas";
import { callLlmJson, type LlmJsonFn } from "../compare/llm";
import { requestLocalizedSummary } from "../compare/summary";
import { buildReport, buildSummary, buildSummaryUserPrompt } from "./build";

/**
 * Internal (exported for tests): builds the report using the given LLM function. The request is copied, never modified.
 * English keeps the template summary (no LLM call); other languages get one LLM call, with the template as fallback.
 */
export const reportWith = async (req: ReportRequest, llm: LlmJsonFn): Promise<Report> => {
  const parsed = ReportRequestSchema.parse(structuredClone(req));
  const summary =
    parsed.language === "en"
      ? buildSummary(parsed.flags)
      : ((await requestLocalizedSummary(llm, parsed.language, buildSummaryUserPrompt(parsed.flags))) ??
        buildSummary(parsed.flags));
  return buildReport(parsed, summary);
};

export const report: ReportFn = (req) => reportWith(req, callLlmJson);

// Minimal valid one-page blank PDF so the download route has something real to serve until the real renderer exists.
const PLACEHOLDER_PDF =
  "%PDF-1.4\n" +
  "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
  "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
  "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n" +
  "trailer\n<< /Root 1 0 R /Size 4 >>\n%%EOF\n";

export const renderPdf: RenderPdfFn = async (input) => {
  ReportSchema.parse(input); // parse at the boundary; the content is not used by the stub
  return Buffer.from(PLACEHOLDER_PDF, "latin1");
};
