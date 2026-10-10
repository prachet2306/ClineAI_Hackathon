// M4 /report: small pure functions that build a Report from grounded flags (no I/O, no logging; the LLM summary call lives in index.ts).
import {
  DISCLAIMER,
  ReportRequestSchema,
  ReportSchema,
  type Flag,
  type Report,
  type ReportRequest,
  type RiskLevel,
} from "../packages/shared/schemas";

/** Word-set overlap above this value counts as a near-duplicate. */
export const SIMILARITY_THRESHOLD = 0.7;

export const NO_FLAGS_SUMMARY =
  "No clauses were flagged for review. This is not a guarantee that the agreement is fair.";

const RISK_ORDER: Record<RiskLevel, number> = { red: 0, amber: 1, green: 2 };

/** "red" if any flag is red, else "amber" if any is amber, else "green". */
export const overallRiskOf = (flags: readonly Flag[]): RiskLevel => {
  if (flags.some((f) => f.riskLevel === "red")) return "red";
  if (flags.some((f) => f.riskLevel === "amber")) return "amber";
  return "green";
};

/** New array, red first then amber then green; original order kept within the same level. */
export const sortFlags = (flags: readonly Flag[]): Flag[] =>
  flags
    .map((flag, position) => ({ flag, position }))
    .sort((a, b) => RISK_ORDER[a.flag.riskLevel] - RISK_ORDER[b.flag.riskLevel] || a.position - b.position)
    .map((entry) => entry.flag);

/** Lowercase words with punctuation removed (Unicode-aware so Indian-language text is kept intact). */
export const wordSet = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\s]/gu, "")
      .split(/\s+/)
      .filter((word) => word.length > 0),
  );

/** Intersection size divided by union size. Two empty sets count as identical. */
export const similarity = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
};

/** Keeps the earlier item whenever a later one overlaps an already-kept item by more than the threshold. */
export const dedupeSimilar = (items: readonly string[], threshold: number = SIMILARITY_THRESHOLD): string[] => {
  const kept: { text: string; words: Set<string> }[] = [];
  for (const text of items) {
    const words = wordSet(text);
    if (!kept.some((k) => similarity(k.words, words) > threshold)) kept.push({ text, words });
  }
  return kept.map((k) => k.text);
};

/** Every flag's questions in the given (already sorted) flag order, near-duplicates removed. */
export const collectQuestions = (sortedFlags: readonly Flag[]): string[] =>
  dedupeSimilar(sortedFlags.flatMap((f) => f.questionsToAsk));

/** Each flag's suggestion (flags without one are skipped), near-duplicates removed. */
export const collectTips = (sortedFlags: readonly Flag[]): string[] =>
  dedupeSimilar(sortedFlags.flatMap((f) => (f.suggestion ? [f.suggestion] : [])));

/** English template summary (used for "en" and as the fallback). */
export const buildSummary = (flags: readonly Flag[]): string => {
  if (flags.length === 0) return NO_FLAGS_SUMMARY;
  const high = flags.filter((f) => f.riskLevel === "red").length;
  const closer = flags.filter((f) => f.riskLevel === "amber").length;
  const noun = flags.length === 1 ? "clause" : "clauses";
  return `${flags.length} ${noun} worth reviewing before signing: ${high} high-concern, ${closer} worth a closer look.`;
};

/** User prompt for the summary call: the number of red, amber and green flags and the list of their categories. Never clause text. */
export const buildSummaryUserPrompt = (flags: readonly Flag[]): string => {
  const count = (level: RiskLevel): number => flags.filter((f) => f.riskLevel === level).length;
  return [
    "A contract was reviewed. Write the overall summary of the review.",
    `Red flags: ${count("red")}`,
    `Amber flags: ${count("amber")}`,
    `Green flags: ${count("green")}`,
    "Flag categories, as JSON:",
    JSON.stringify(flags.map((f) => f.category)),
  ].join("\n");
};

/**
 * Parses the request, builds the Report without touching the caller's data, and parses the result.
 * `summary` replaces the English template summary when given (already written by the caller).
 */
export const buildReport = (input: ReportRequest, summary?: string): Report => {
  const req = ReportRequestSchema.parse(input);
  const flags = sortFlags(structuredClone(req.flags));
  const comparison = req.comparison === undefined ? undefined : structuredClone(req.comparison);
  return ReportSchema.parse({
    documentId: req.ingest.documentId,
    filename: req.ingest.filename,
    generatedAt: new Date().toISOString(),
    language: req.language,
    disclaimer: DISCLAIMER,
    overallRisk: overallRiskOf(flags),
    summary: summary ?? buildSummary(flags),
    flags,
    questionsToAsk: collectQuestions(flags),
    negotiationTips: collectTips(flags),
    ...(comparison === undefined ? {} : { comparison }),
  });
};
