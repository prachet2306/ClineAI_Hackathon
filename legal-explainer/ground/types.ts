// M3 corpus types: the Zod schema for reference entries and a loader that validates corpus/entries.json.
import { z } from "zod";
import { CitationSchema, ClauseCategorySchema, DocumentTypeSchema } from "../packages/shared/schemas";
import entriesJson from "./corpus/entries.json" with { type: "json" };

/** The sourceId of the stand-in entry in entries.json. Retrieval never returns it. */
export const PLACEHOLDER_SOURCE_ID = "placeholder";

const AS_OF_PATTERN = /^\d{4}(-\d{2}(-\d{2})?)?$/;

/**
 * A reference source. Extends CitationSchema (sourceId, title, snippet, url, asOf), but the
 * project rules require a real url and an asOf date for every corpus entry, so both are required
 * here. Strict, so a misspelt field is reported instead of silently dropped.
 */
export const CorpusEntrySchema = CitationSchema.extend({
  title: z.string().min(1),
  snippet: z.string().min(1),
  url: z.string().url(),
  asOf: z.string().regex(AS_OF_PATTERN, "must look like YYYY, YYYY-MM or YYYY-MM-DD"),
  docTypes: z.array(DocumentTypeSchema).min(1),
  topics: z.array(ClauseCategorySchema).min(1),
}).strict();
export type CorpusEntry = z.infer<typeof CorpusEntrySchema>;

/** Human-readable label for an entry in error messages: its position and sourceId when readable. */
function entryLabel(item: unknown, index: number): string {
  if (typeof item === "object" && item !== null && "sourceId" in item && typeof item.sourceId === "string") {
    return `Entry #${index + 1} (sourceId "${item.sourceId}")`;
  }
  return `Entry #${index + 1}`;
}

/**
 * Validates raw corpus data. Throws one Error listing every problem found (bad fields,
 * duplicate sourceIds, or data that is not an array), so a contributor can fix them in one pass.
 */
export function parseCorpus(raw: unknown): CorpusEntry[] {
  if (!Array.isArray(raw)) {
    throw new Error("Invalid corpus: entries.json must be a JSON array of entries. See ground/corpus/README.md.");
  }

  const problems: string[] = [];
  const entries: CorpusEntry[] = [];
  const seenIds = new Set<string>();

  raw.forEach((item: unknown, index) => {
    const label = entryLabel(item, index);
    const result = CorpusEntrySchema.safeParse(item);
    if (!result.success) {
      for (const issue of result.error.issues) {
        problems.push(`${label}: ${issue.path.join(".") || "(entry)"} - ${issue.message}`);
      }
      return;
    }
    if (seenIds.has(result.data.sourceId)) {
      problems.push(`${label}: sourceId - must be unique, but it is already used by an earlier entry`);
      return;
    }
    seenIds.add(result.data.sourceId);
    entries.push(result.data);
  });

  if (problems.length > 0) {
    throw new Error(
      `Invalid corpus (${problems.length} problem${problems.length === 1 ? "" : "s"}). ` +
        `See ground/corpus/README.md.\n- ${problems.join("\n- ")}`,
    );
  }
  return entries;
}

let cachedCorpus: CorpusEntry[] | undefined;

/** Loads and validates corpus/entries.json (cached after the first successful load). */
export function loadCorpus(): CorpusEntry[] {
  cachedCorpus ??= parseCorpus(entriesJson);
  return cachedCorpus;
}
