// M4 /report: ReportFn (built by ./build.ts) and RenderPdfFn (implemented in ./pdf.ts).
import type { ReportFn } from "../packages/shared/contracts";
import { ReportRequestSchema, type Report, type ReportRequest } from "../packages/shared/schemas";
import { callLlmJson, type LlmJsonFn } from "../compare/llm";
import { requestLocalizedSummary } from "../compare/summary";
import { buildReport, buildSummary, buildSummaryUserPrompt } from "./build";
import { renderPdf } from "./pdf";

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

// RenderPdfFn lives in ./pdf (pdfkit with the bundled Noto Sans fonts); re-exported here under the same name.
export { renderPdf };
