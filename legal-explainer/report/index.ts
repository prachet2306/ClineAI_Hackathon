// M4 /report: ReportFn (built by ./build.ts) and RenderPdfFn (implemented in ./pdf.ts).
import type { ReportFn } from "../packages/shared/contracts";
import { ReportRequestSchema, type Report, type ReportRequest } from "../packages/shared/schemas";
import { callLlmJson, type LlmJsonFn } from "../compare/llm";
import { requestLocalizedSummary } from "../compare/summary";
import { buildReport, buildSummary, buildSummaryUserPrompt } from "./build";
import { localizeFlags } from "./localize";
import { renderPdf } from "./pdf";

/**
 * Internal (exported for tests): builds the report using the given LLM function. The request is copied, never modified.
 * Flags are localized first (before sorting and before the merged questions and tips are built), so those lists are in
 * the report language too. English keeps the template summary (no LLM call); other languages get one LLM call for the
 * flags (only when some flag is not yet in that language) and one for the summary, with the template as fallback.
 */
export const reportWith = async (req: ReportRequest, llm: LlmJsonFn): Promise<Report> => {
  const parsed = ReportRequestSchema.parse(structuredClone(req));
  const localized = { ...parsed, flags: await localizeFlags(parsed.flags, parsed.language, llm) };
  const summary =
    localized.language === "en"
      ? buildSummary(localized.flags)
      : ((await requestLocalizedSummary(llm, localized.language, buildSummaryUserPrompt(localized.flags))) ??
        buildSummary(localized.flags));
  return buildReport(localized, summary);
};

export const report: ReportFn = (req) => reportWith(req, callLlmJson);

// RenderPdfFn lives in ./pdf (pdfkit with the bundled Noto Sans fonts); re-exported here under the same name.
export { renderPdf };
