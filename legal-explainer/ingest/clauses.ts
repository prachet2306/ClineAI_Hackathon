// Splits extracted page text into clauses on numbering (1., 1.1, Clause 1) and headings, falling back to paragraphs.
// Sub-points (a), (b), (i) stay inside their parent clause; fragments under ~40 characters (lone headings, "(a)")
// are merged into the clause they belong to. When the text has no numbering or headings, ONE model call may split it
// into provisions (needsModelSplit + modelPieces); every piece must be an exact substring of the original, in order,
// or paragraph splitting is used instead. Clause text is always an exact substring of the extracted text
// (only leading and trailing whitespace is trimmed); nothing inside a clause is ever rewritten.
import type { Clause } from "../packages/shared/schemas";
import { askModel } from "./llm";

const TOP_LEVEL: RegExp[] = [
  /^(?:clause|article|section)\s+\d+(?:\.\d+)*\s*[.:)\-\u2013\u2014]?(?=\s|$)/i, // Clause 1, Article 2.1
  /^\d+(?:\.\d+)*[.)](?=\s+\S)/, // 1.  1.1.  2)
  /^\d+(?:\.\d+)+(?=\s+[A-Z("'])/, // 1.1 Text (capital letter avoids "10.5 lakh")
];
const SUBPOINT = /^\(\s*(?:[a-z]|[ivxl]+|\d+)\s*\)(?=\s+\S)/i; // (a) (iv) (1)

const MIN_CLAUSE_CHARS = 40;
const MODEL_SPLIT_MAX_CHARS = 12_000; // longer documents use paragraph splitting (the model would need to echo the whole text)
const MODEL_SPLIT_TIMEOUT_MS = 30_000;
const MIN_COVERAGE = 0.9; // model pieces must account for at least this share of the non-space characters

const isTopLevel = (line: string): boolean => TOP_LEVEL.some((re) => re.test(line));
const isSubpoint = (line: string): boolean => SUBPOINT.test(line);

/** A heading is a short ALL CAPS line, or a short line ending with a colon. */
function isHeading(line: string): boolean {
  if (line.length < 3 || line.length > 80) return false;
  const letters = line.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return false;
  if (letters === letters.toUpperCase() && !/[.;,]$/.test(line)) return true;
  return /^[A-Z][A-Za-z &/'-]{2,60}:$/.test(line);
}

type Line = { start: number; text: string };
type Range = { start: number; end: number; bodyStart: number }; // bodyStart: where the clause's own text begins (after merged fragments)

function toLines(full: string): Line[] {
  const lines: Line[] = [];
  let pos = 0;
  for (const raw of full.split("\n")) {
    lines.push({ start: pos, text: raw });
    pos += raw.length + 1;
  }
  return lines;
}

/** Start offsets from numbering and headings. A heading directly followed by a numbered line stays one clause. */
function markerStarts(lines: Line[], includeSubpoints: boolean): number[] {
  const starts: number[] = [];
  let afterHeading = false;
  for (const line of lines) {
    const t = line.text.trim();
    if (!t) {
      afterHeading = false; // a blank line ends the heading: a title alone is its own clause
      continue;
    }
    const numbered = isTopLevel(t) || (includeSubpoints && isSubpoint(t));
    const heading = !numbered && !isSubpoint(t) && isHeading(t);
    if ((numbered || heading) && afterHeading) {
      afterHeading = heading;
      continue;
    }
    if (numbered || heading) starts.push(line.start);
    afterHeading = heading;
  }
  return starts;
}

/** Numbering and headings; (a)/(b) sub-points only count when nothing else gives structure. */
function structureStarts(lines: Line[]): number[] {
  const starts = markerStarts(lines, false);
  return starts.length >= 2 ? starts : markerStarts(lines, true);
}

/** Fallback 1: paragraphs separated by blank lines. */
function paragraphStarts(lines: Line[]): number[] {
  const starts: number[] = [];
  lines.forEach((line, i) => {
    if (line.text.trim() && (i === 0 || !lines[i - 1].text.trim())) starts.push(line.start);
  });
  return starts;
}

/** Fallback 2: a new clause after any line that ends a sentence (for text with hard line breaks and no blank lines). */
function sentenceLineStarts(lines: Line[]): number[] {
  const starts: number[] = [];
  let previousEnded = true;
  for (const line of lines) {
    const t = line.text.trim();
    if (!t) continue;
    if (previousEnded) starts.push(line.start);
    previousEnded = /[.!?:;]$/.test(t);
  }
  return starts;
}

/** Heading from the first line: a heading line itself, or the lead-in of "1. Security Deposit. The Tenant...". */
function headingOf(clauseText: string): string | undefined {
  const first = clauseText.split("\n")[0].trim();
  if (!isTopLevel(first) && !isSubpoint(first) && isHeading(first)) return first.replace(/:$/, "");
  const marker = [...TOP_LEVEL, SUBPOINT].find((re) => re.test(first));
  const stripped = (marker ? first.replace(marker, "") : first).trim();
  const lead = /^([A-Z][^.:\u2013\u2014]{1,58})[.:\u2013\u2014]\s/.exec(`${stripped} `);
  if (lead && lead[1].split(/\s+/).length <= 6) return lead[1].trim();
  return undefined;
}

/** Joins pieces shorter than MIN_CLAUSE_CHARS into the clause that follows (or the one before, at the end). */
function mergeFragments(full: string, ranges: Range[]): Range[] {
  const merged: Range[] = [];
  let carryStart: number | undefined;
  for (const r of ranges) {
    if (full.slice(r.start, r.end).trim().length < MIN_CLAUSE_CHARS) {
      if (carryStart === undefined) carryStart = r.start;
      continue;
    }
    merged.push({ start: carryStart ?? r.start, end: r.end, bodyStart: r.start });
    carryStart = undefined;
  }
  if (carryStart !== undefined && ranges.length > 0) {
    const end = ranges[ranges.length - 1].end;
    if (merged.length > 0) merged[merged.length - 1].end = end;
    else merged.push({ start: carryStart, end, bodyStart: carryStart }); // the whole text is tiny: keep it as one clause
  }
  return merged;
}

/** True when the text has no numbering or headings, so the caller may try the model split. */
export function needsModelSplit(pages: string[]): boolean {
  const full = pages.join("\n\n");
  return full.length <= MODEL_SPLIT_MAX_CHARS && structureStarts(toLines(full)).length < 2;
}

/** ONE model call asking for the provisions as a JSON array of exact copies. Returns null on any failure. */
export async function modelPieces(pages: string[]): Promise<string[] | null> {
  const full = pages.join("\n\n").trim();
  if (!full || full.length > MODEL_SPLIT_MAX_CHARS) return null;
  const system =
    "You split legal agreements into their separate provisions. You output only a JSON array of strings. " +
    "You never change, fix, shorten or reorder any wording.";
  const prompt =
    "Split the agreement below into its separate provisions (one clause or paragraph of obligations per item). " +
    "Output ONLY a JSON array of strings. Every string must be copied from the text exactly, character for character, " +
    "in the original order, with no changes to wording, spelling or punctuation. Keep a heading together with the " +
    `provision it introduces.\n\n--- AGREEMENT ---\n${full}\n--- END ---`;
  try {
    const answer = await askModel(system, prompt, MODEL_SPLIT_TIMEOUT_MS);
    const start = answer.indexOf("[");
    const end = answer.lastIndexOf("]");
    if (start < 0 || end <= start) return null;
    const parsed: unknown = JSON.parse(answer.slice(start, end + 1));
    if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === "string")) return null;
    return parsed as string[];
  } catch {
    return null;
  }
}

/** Finds each piece in the original, in order. Returns null if any piece is not an exact substring or text went missing. */
function locatePieces(full: string, pieces: string[]): Range[] | null {
  const ranges: Range[] = [];
  let cursor = 0;
  let covered = 0;
  for (const piece of pieces) {
    const text = piece.trim();
    if (!text) return null;
    const at = full.indexOf(text, cursor);
    if (at < 0) return null;
    ranges.push({ start: at, end: at + text.length, bodyStart: at });
    cursor = at + text.length;
    covered += text.replace(/\s/g, "").length;
  }
  const total = full.replace(/\s/g, "").length;
  return ranges.length >= 2 && covered >= total * MIN_COVERAGE ? ranges : null;
}

/** `pieces` (optional) come from modelPieces; they are used only if every one verifies as an exact substring. */
export function splitClauses(pages: string[], pieces?: string[] | null): Clause[] {
  const pageStarts: number[] = [];
  let offset = 0;
  for (const page of pages) {
    pageStarts.push(offset);
    offset += page.length + 2; // pages are joined with a blank line
  }
  const full = pages.join("\n\n");

  let ranges = pieces ? locatePieces(full, pieces) : null;
  if (!ranges) {
    const lines = toLines(full);
    let starts = structureStarts(lines);
    if (starts.length < 2) starts = paragraphStarts(lines);
    if (starts.length < 2) starts = sentenceLineStarts(lines);
    if (starts.length === 0 || (starts[0] > 0 && full.slice(0, starts[0]).trim())) starts.unshift(0);
    ranges = starts.map((start, k) => ({ start, end: starts[k + 1] ?? full.length, bodyStart: start }));
  }

  const clauses: Clause[] = [];
  for (const range of mergeFragments(full, ranges)) {
    const raw = full.slice(range.start, range.end);
    const text = raw.trim();
    if (!text) continue;
    const textStart = range.start + (raw.length - raw.trimStart().length);
    let page = 1;
    pageStarts.forEach((p, i) => {
      if (p <= textStart) page = i + 1;
    });
    const heading = headingOf(full.slice(range.bodyStart, range.end).trim());
    clauses.push({
      id: `c${clauses.length + 1}`,
      index: clauses.length,
      ...(heading ? { heading } : {}),
      text,
      page,
    });
  }
  return clauses;
}
