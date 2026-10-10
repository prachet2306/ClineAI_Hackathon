// M4 /report: stub ReportFn (returns packages/shared/mocks/report.json, parsed with ReportSchema)
// and stub RenderPdfFn (returns a tiny placeholder PDF; never includes report text).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RenderPdfFn, ReportFn } from "../packages/shared/contracts";
import { ReportSchema } from "../packages/shared/schemas";

const mockPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "shared",
  "mocks",
  "report.json",
);

export const report: ReportFn = async (_req) => {
  const raw: unknown = JSON.parse(readFileSync(mockPath, "utf8"));
  return ReportSchema.parse(raw);
};

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
