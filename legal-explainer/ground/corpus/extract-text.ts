// M3 corpus tool: extracts the text of a source PDF (one string per page) using unpdf.
// Used by check-snippets.ts, and run directly to dump the text to a file for reading.
// Usage: npx tsx ground/corpus/extract-text.ts <pdf-path> [output-txt-path]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { extractText, getDocumentProxy } from "unpdf";

/** Extracts the text of every page of a PDF. Index 0 is page 1. */
export async function extractPages(pdfPath: string): Promise<string[]> {
  const data = new Uint8Array(readFileSync(pdfPath));
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

/** Collapses every run of whitespace (including newlines) into one space and trims the ends. Nothing else changes. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The whole document as one whitespace-normalised string. Pages are joined with a single space. */
export function extractNormalizedText(pages: readonly string[]): string {
  return normalizeWhitespace(pages.join(" "));
}

async function main(): Promise<void> {
  const [pdfPath, outPath] = process.argv.slice(2);
  if (!pdfPath) {
    console.error("Usage: npx tsx ground/corpus/extract-text.ts <pdf-path> [output-txt-path]");
    process.exit(2);
  }
  const pages = await extractPages(pdfPath);
  console.log(`pages: ${pages.length}, characters: ${pages.reduce((sum, page) => sum + page.length, 0)}`);
  if (outPath) {
    const body = pages.map((page, i) => `\n===== PAGE ${i + 1} =====\n${page}`).join("\n");
    writeFileSync(outPath, body, "utf8");
    console.log(`wrote ${outPath}`);
  }
}

// Run only when executed directly, not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
