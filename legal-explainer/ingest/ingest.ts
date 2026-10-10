// Real ingest implementation of IngestFn: digital PDF, scanned PDF, image (png/jpg/webp) or pasted text -> IngestResult.
// The input type is detected from the bytes: %PDF = PDF, image magic bytes = image, anything else = UTF-8 text.
// Order: extract text -> legal-document gate (legal-gate.ts) -> clause split (clauses.ts) -> doc type.
// Everything stays in memory. Nothing is written to disk and no document text is logged.
import { randomUUID } from "node:crypto";
import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import type { IngestFn } from "../packages/shared/contracts";
import { IngestResultSchema } from "../packages/shared/schemas";
import { modelPieces, needsModelSplit, splitClauses } from "./clauses";
import { guessDocType } from "./doctype";
import { IngestError } from "./errors";
import { assertLegalDocument } from "./legal-gate";
import { ocrImages, type OcrImage } from "./ocr";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_OCR_PAGES = 10;
const MIN_CHARS_PER_PAGE = 40; // below this average, a PDF is treated as scanned

type Kind = "pdf" | "image" | "text";

function detect(bytes: Uint8Array): { kind: Kind; mediaType?: OcrImage["mediaType"] } {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x25, 0x50, 0x44, 0x46)) return { kind: "pdf" }; // %PDF
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { kind: "image", mediaType: "image/png" };
  if (starts(0xff, 0xd8, 0xff)) return { kind: "image", mediaType: "image/jpeg" };
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { kind: "image", mediaType: "image/webp" };
  }
  return { kind: "text" };
}

const countChars = (pages: string[]): number => pages.join("").replace(/\s/g, "").length;

async function readPdf(bytes: Uint8Array): Promise<{ pages: string[]; usedOcr: boolean }> {
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes)); // copy: pdf.js may detach the buffer
    pages = (await extractText(pdf, { mergePages: false })).text;
  } catch {
    throw new IngestError("EXTRACTION_FAILED", "Could not read this PDF");
  }
  if (pages.length === 0) throw new IngestError("EXTRACTION_FAILED", "The PDF has no pages");
  if (countChars(pages) / pages.length >= MIN_CHARS_PER_PAGE) return { pages, usedOcr: false };

  // Little or no text: render each page to an image and OCR it.
  const images: OcrImage[] = [];
  try {
    const count = Math.min(pages.length, MAX_OCR_PAGES);
    for (let n = 1; n <= count; n++) {
      const png = await renderPageAsImage(new Uint8Array(bytes), n, {
        // Native addon: must be loaded by Node at runtime, not bundled by Next.
        canvasImport: () => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "@napi-rs/canvas"),
        scale: 2,
      });
      images.push({ data: new Uint8Array(png), mediaType: "image/png" });
    }
  } catch {
    throw new IngestError("EXTRACTION_FAILED", "Could not render the scanned PDF for OCR");
  }
  return { pages: await ocrImages(images), usedOcr: true };
}

export const ingest: IngestFn = async ({ pdf, filename }) => {
  if (!pdf || pdf.length === 0) throw new IngestError("BAD_INPUT", "The document is empty");
  if (pdf.length > MAX_BYTES) throw new IngestError("BAD_INPUT", "The document is too large (max 20 MB)");

  const bytes = new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  const { kind, mediaType } = detect(bytes);

  let pages: string[];
  let usedOcr = false;
  if (kind === "pdf") {
    ({ pages, usedOcr } = await readPdf(bytes));
  } else if (kind === "image") {
    pages = await ocrImages([{ data: bytes, mediaType: mediaType ?? "image/png" }]);
    usedOcr = true;
  } else {
    pages = [new TextDecoder("utf-8").decode(bytes)]; // pasted text: used as is
  }

  const fullText = pages.join("\n\n");
  if (!fullText.trim()) throw new IngestError("EXTRACTION_FAILED", "No readable text was found in the document");

  await assertLegalDocument(fullText); // rejects non-legal documents before any clause work

  // Unnumbered text: ONE model call proposes the split; splitClauses only uses it if every piece is an exact substring.
  const pieces = needsModelSplit(pages) ? await modelPieces(pages) : null;
  const clauses = splitClauses(pages, pieces);
  if (clauses.length === 0) throw new IngestError("EXTRACTION_FAILED", "No readable text was found in the document");

  return IngestResultSchema.parse({
    documentId: randomUUID(),
    filename,
    docType: guessDocType(fullText),
    pageCount: Math.max(pages.length, 1),
    usedOcr,
    clauses,
  });
};
