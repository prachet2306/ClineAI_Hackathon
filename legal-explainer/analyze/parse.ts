/**
 * Turns raw LLM text into validated flags (module 2). Pure functions: no LLM call, no network.
 * Extracts JSON, normalises enums, drops invalid flags, and replaces each quote with the exact
 * substring from the clause text. Never puts document text into errors or dropped-flag records.
 */
import {
  ClauseCategorySchema,
  FlagSchema,
  RiskLevelSchema,
  type Clause,
  type ClauseCategory,
  type Flag,
  type Language,
  type RiskLevel,
} from "../packages/shared/schemas";

export type DropReason =
  | "not_an_object"
  | "unknown_clause"
  | "bad_risk_level"
  | "quote_not_found"
  | "invalid_shape";

/** Safe metadata about a dropped flag: its position in the LLM list and why. No text. */
export interface DroppedFlag {
  index: number;
  reason: DropReason;
}

export interface ParsedFlags {
  flags: Flag[];
  dropped: DroppedFlag[];
}

type BuildResult = { ok: true; flag: Flag } | { ok: false; reason: DropReason };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/* ------------------------------------------------------------------ */
/* JSON extraction                                                     */
/* ------------------------------------------------------------------ */

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Slices from the first `{` or `[` to the last matching closer, then parses it. */
function parseOuterJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const braceAt = text.indexOf("{");
  const bracketAt = text.indexOf("[");
  const starts = [braceAt, bracketAt].filter((i) => i >= 0);
  if (starts.length === 0) return { ok: false };

  const start = Math.min(...starts);
  const closer = text.charAt(start) === "{" ? "}" : "]";
  const end = text.lastIndexOf(closer);
  if (end <= start) return { ok: false };

  return tryParseJson(text.slice(start, end + 1));
}

/**
 * Finds JSON in LLM text that may be wrapped in a markdown fence or surrounded by commentary.
 * Throws a generic Error (without echoing the text) if no valid JSON is found.
 */
export function extractJson(raw: string): unknown {
  const text = raw.trim();
  const candidates: string[] = [];

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1] !== undefined) candidates.push(fence[1].trim());
  candidates.push(text);

  for (const candidate of candidates) {
    const whole = tryParseJson(candidate);
    if (whole.ok) return whole.value;
    const outer = parseOuterJson(candidate);
    if (outer.ok) return outer.value;
  }
  throw new Error("LLM output did not contain valid JSON");
}

function extractFlagItems(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed as unknown[];
  if (isRecord(parsed) && Array.isArray(parsed.flags)) return parsed.flags as unknown[];
  throw new Error("LLM output did not contain a flags list");
}

/* ------------------------------------------------------------------ */
/* Enum normalisation                                                  */
/* ------------------------------------------------------------------ */

/** Accepts "Rent Escalation", "rent-escalation", etc. Unknown values become "other". */
export function normalizeCategory(value: unknown): ClauseCategory {
  if (typeof value !== "string") return "other";
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const parsed = ClauseCategorySchema.safeParse(key);
  return parsed.success ? parsed.data : "other";
}

const RISK_ALIASES: ReadonlyMap<string, RiskLevel> = new Map<string, RiskLevel>([
  ["high", "red"],
  ["severe", "red"],
  ["critical", "red"],
  ["medium", "amber"],
  ["moderate", "amber"],
  ["yellow", "amber"],
  ["orange", "amber"],
  ["low", "green"],
  ["safe", "green"],
  ["fair", "green"],
  ["ok", "green"],
]);

/** Maps red/amber/green (any case) and common synonyms. Returns undefined if unrecognised. */
export function normalizeRisk(value: unknown): RiskLevel | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  const direct = RiskLevelSchema.safeParse(key);
  return direct.success ? direct.data : RISK_ALIASES.get(key);
}

/* ------------------------------------------------------------------ */
/* Quote matching                                                      */
/* ------------------------------------------------------------------ */

/** Same-length replacements so typographic quotes compare equal to plain ones. */
function foldQuoteChar(ch: string): string {
  switch (ch) {
    case "\u2018":
    case "\u2019":
    case "\u201A":
    case "\u201B":
    case "\u2032":
      return "'";
    case "\u201C":
    case "\u201D":
    case "\u201E":
    case "\u201F":
      return '"';
    default:
      return ch;
  }
}

/**
 * Lowercases, folds typographic quotes and collapses whitespace runs to one space.
 * `map[i]` is the index in the original text of normalised character `i`.
 */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let previousWasSpace = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (/\s/.test(ch)) {
      if (!previousWasSpace) {
        norm += " ";
        map.push(i);
        previousWasSpace = true;
      }
      continue;
    }
    previousWasSpace = false;
    const folded = foldQuoteChar(ch).toLowerCase();
    for (let k = 0; k < folded.length; k++) {
      norm += folded.charAt(k);
      map.push(i);
    }
  }
  return { norm, map };
}

/**
 * Finds `quote` in `clauseText` ignoring case, whitespace differences and typographic quotes.
 * Returns the EXACT original substring of the clause text, or undefined if there is no match.
 */
export function resolveQuote(quote: string, clauseText: string): string | undefined {
  const needle = normalizeWithMap(quote).norm.trim();
  if (needle.length === 0) return undefined;

  const { norm, map } = normalizeWithMap(clauseText);
  const at = norm.indexOf(needle);
  if (at < 0) return undefined;

  const start = map[at];
  const end = map[at + needle.length - 1];
  if (start === undefined || end === undefined) return undefined;

  return clauseText.slice(start, end + 1);
}


/* ------------------------------------------------------------------ */
/* Flag building                                                       */
/* ------------------------------------------------------------------ */

function toStringList(value: unknown): string[] {
  const items = typeof value === "string" ? [value] : Array.isArray(value) ? (value as unknown[]) : [];
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildFlag(
  item: unknown,
  textById: ReadonlyMap<string, string>,
  language: Language,
): BuildResult {
  if (!isRecord(item)) return { ok: false, reason: "not_an_object" };

  const clauseId = toText(item.clauseId);
  const clauseText = textById.get(clauseId);
  if (clauseText === undefined) return { ok: false, reason: "unknown_clause" };

  const riskLevel = normalizeRisk(item.riskLevel);
  if (riskLevel === undefined) return { ok: false, reason: "bad_risk_level" };

  if (typeof item.quote !== "string") return { ok: false, reason: "invalid_shape" };
  const quote = resolveQuote(item.quote, clauseText);
  if (quote === undefined) return { ok: false, reason: "quote_not_found" };

  const explanation = toText(item.explanation);
  const whyItMatters = toText(item.whyItMatters);
  if (explanation === "" || whyItMatters === "") return { ok: false, reason: "invalid_shape" };

  const suggestion = toText(item.suggestion);

  // citations, quoteVerified and grounding are module 3's fields: never copied from the LLM,
  // so the schema defaults apply. `language` is set from the request, not trusted from the LLM.
  const parsed = FlagSchema.safeParse({
    clauseId,
    category: normalizeCategory(item.category),
    riskLevel,
    quote,
    explanation,
    whyItMatters,
    questionsToAsk: toStringList(item.questionsToAsk),
    ...(suggestion !== "" ? { suggestion } : {}),
    language,
  });

  return parsed.success ? { ok: true, flag: parsed.data } : { ok: false, reason: "invalid_shape" };
}

/**
 * Parses one LLM reply (for one batch of clauses) into valid flags.
 * - Throws an Error if the reply has no JSON or no flags list.
 * - Drops (never throws on) individual bad flags, and reports why in `dropped`.
 * - Each returned quote is the exact substring from the clause text.
 */
export function parseFlags(
  raw: string,
  clauses: readonly Clause[],
  language: Language,
): ParsedFlags {
  const items = extractFlagItems(extractJson(raw));
  const textById = new Map<string, string>(clauses.map((c) => [c.id, c.text]));

  const flags: Flag[] = [];
  const dropped: DroppedFlag[] = [];

  items.forEach((item, index) => {
    const result = buildFlag(item, textById, language);
    if (result.ok) flags.push(result.flag);
    else dropped.push({ index, reason: result.reason });
  });

  return { flags, dropped };
}

/**
 * Enforces the per-document green flag cap in code, so it does not rely on the LLM obeying the
 * prompt. Keeps red and amber flags untouched, keeps the first `maxGreen` green flags in order,
 * and removes any further green ones. `maxGreen` of 0 removes all green flags.
 */
export function limitGreenFlags(
  flags: readonly Flag[],
  maxGreen: number,
): { flags: Flag[]; removedGreen: number } {
  const allowed = Number.isFinite(maxGreen) ? Math.max(0, Math.floor(maxGreen)) : 0;
  let kept = 0;
  let removedGreen = 0;
  const result: Flag[] = [];

  for (const flag of flags) {
    if (flag.riskLevel === "green") {
      if (kept >= allowed) {
        removedGreen += 1;
        continue;
      }
      kept += 1;
    }
    result.push(flag);
  }
  return { flags: result, removedGreen };
}

