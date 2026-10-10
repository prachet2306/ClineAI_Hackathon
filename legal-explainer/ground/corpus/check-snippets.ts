// M3 corpus check: re-extracts each source PDF and fails if any entry's snippet is not an exact substring
// of the PDF text (after whitespace normalisation), or if its title breaks the rules for that source.
// Usage: npx tsx ground/corpus/check-snippets.ts [path-to-entries.json]   (exit code 1 if anything fails)
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PLACEHOLDER_SOURCE_ID, parseCorpus, type CorpusEntry } from "../types";
import { extractNormalizedText, extractPages, normalizeWhitespace } from "./extract-text";

const HERE = dirname(fileURLToPath(import.meta.url));

interface SourceConfig {
  /** Path of the saved source PDF, relative to this folder. */
  pdf: string;
  /** Every entry title from this source must start with this text. */
  titlePrefix: string;
  /** True when the source does not print section numbers we may quote, so titles must not contain any. */
  forbidSectionNumbersInTitle: boolean;
}

/** Registered sources, keyed by the entry `url`. An entry whose url is not listed here fails the check. */
export const SOURCES: Record<string, SourceConfig> = {
  "https://prsindia.org/files/bills_acts/bills_parliament/2021/Legislative%20Brief%20-%20Model%20Tenancy%20Act%202021.pdf": {
    pdf: "source/PRS-Legislative-Brief-MTA-2021.pdf",
    titlePrefix: "PRS summary of the Model Tenancy Act 2021:",
    forbidSectionNumbersInTitle: true,
  },
};

export interface EntryResult {
  sourceId: string;
  skipped: boolean;
  problems: string[];
  warnings: string[];
}

const SECTION_NUMBER_IN_TITLE = /\b(sections?|clauses?|sec\.|s\.)\s*\d/i;
const PRIVATE_USE_CHARACTER = /[\uE000-\uF8FF]/;

/** Rough sentence count (full stops, question and exclamation marks followed by a space or the end). */
function countSentences(text: string): number {
  return (text.match(/[.!?](?=\s|$)/g) ?? []).length;
}

/**
 * Checks every entry except the placeholder. The text of each source PDF is extracted once.
 * An entry passes only if its whitespace-normalised snippet is an exact substring of the
 * whitespace-normalised PDF text. Sentence count and stray bullet characters are warnings only.
 */
export async function checkEntries(entries: readonly CorpusEntry[], baseDir: string = HERE): Promise<EntryResult[]> {
  const textByPdf = new Map<string, string>();

  async function sourceText(pdfPath: string): Promise<string> {
    const cached = textByPdf.get(pdfPath);
    if (cached !== undefined) return cached;
    const text = extractNormalizedText(await extractPages(pdfPath));
    textByPdf.set(pdfPath, text);
    return text;
  }

  const results: EntryResult[] = [];
  for (const entry of entries) {
    const result: EntryResult = { sourceId: entry.sourceId, skipped: false, problems: [], warnings: [] };
    results.push(result);

    if (entry.sourceId === PLACEHOLDER_SOURCE_ID) {
      result.skipped = true;
      continue;
    }

    const source = SOURCES[entry.url];
    if (!source) {
      result.problems.push("url is not registered in SOURCES, so there is no source PDF to check against");
      continue;
    }

    if (!entry.title.startsWith(source.titlePrefix)) {
      result.problems.push(`title must start with "${source.titlePrefix}"`);
    }
    if (source.forbidSectionNumbersInTitle && SECTION_NUMBER_IN_TITLE.test(entry.title)) {
      result.problems.push("title contains a section or clause number, which this source does not allow");
    }

    const pdfPath = resolve(baseDir, source.pdf);
    if (!existsSync(pdfPath)) {
      result.problems.push(`source PDF not found at ${source.pdf}`);
      continue;
    }
    const text = await sourceText(pdfPath);
    if (text.length === 0) {
      result.problems.push("no text could be extracted from the PDF (is it a scan?)");
      continue;
    }

    const snippet = normalizeWhitespace(entry.snippet);
    if (!text.includes(snippet)) {
      result.problems.push(`snippet is not an exact substring of the PDF text: "${snippet.slice(0, 80)}..."`);
    }

    const sentences = countSentences(entry.snippet);
    if (sentences < 1 || sentences > 4) result.warnings.push(`snippet has about ${sentences} sentences (expected 1 to 4)`);
    if (PRIVATE_USE_CHARACTER.test(entry.snippet)) result.warnings.push("snippet contains a private-use character (a PDF bullet?)");
  }
  return results;
}

async function main(): Promise<void> {
  const entriesPath = resolve(process.argv[2] ?? resolve(HERE, "entries.json"));
  let entries: CorpusEntry[];
  try {
    entries = parseCorpus(JSON.parse(readFileSync(entriesPath, "utf8")));
  } catch (error) {
    console.error(`Cannot read corpus entries from ${entriesPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const results = await checkEntries(entries);
  let failed = 0;
  let checked = 0;
  for (const result of results) {
    if (result.skipped) {
      console.log(`SKIP  ${result.sourceId} (placeholder)`);
      continue;
    }
    checked++;
    const ok = result.problems.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${result.sourceId}`);
    for (const problem of result.problems) console.log(`      problem: ${problem}`);
    for (const warning of result.warnings) console.log(`      warning: ${warning}`);
  }
  console.log(`\nchecked ${checked} entries, ${checked - failed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

// Run only when executed directly, not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
