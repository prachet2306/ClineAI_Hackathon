// M3 relevance gate: decides which retrieved sources may become citations for a flag.
// A source passes only if its topics include the flag's category, or its keyword (BM25) score is very high.
import type { ClauseCategory } from "../packages/shared/schemas";
import type { ScoredSource } from "./retrieve";

/**
 * BM25 score at or above which a source may be cited even when its topics do not include the flag's category.
 *
 * Measured on the 8-entry PRS corpus, over 14 queries built the way `ground` builds them (the demo's three
 * clauses plus phrases and longer clauses for deposit, rent, entry, maintenance, lock-in and eviction): the highest
 * score of a wrong-topic entry was 6.17 (the demo's 15-day termination clause against the written-agreement
 * entry); the next were 5.70, 5.41 and 5.24. 7 sits 0.83 above the worst case, so none of those loose matches is
 * cited on score alone. (An earlier value of 6 was calibrated before the placeholder was removed and the
 * written-agreement topics were narrowed; those changes lifted that pair from 5.88 to 6.17.)
 * Scores shift with corpus size, wording and topics, so RE-MEASURE THIS VALUE WHEN THE CORPUS GROWS OR CHANGES.
 */
export const RELEVANCE_SCORE_THRESHOLD = 7;

/** True if the source's topics include the flag's category, or its score is at or above the threshold. */
export function passesRelevanceGate(
  category: ClauseCategory,
  source: Pick<ScoredSource, "topics" | "score">,
  threshold: number = RELEVANCE_SCORE_THRESHOLD,
): boolean {
  return source.topics.includes(category) || source.score >= threshold;
}

/** Keeps only the sources that pass the gate, in their original (best score first) order, at most `max` of them. */
export function selectCitationSources<T extends Pick<ScoredSource, "topics" | "score">>(
  category: ClauseCategory,
  sources: readonly T[],
  max: number,
  threshold: number = RELEVANCE_SCORE_THRESHOLD,
): T[] {
  return sources.filter((source) => passesRelevanceGate(category, source, threshold)).slice(0, Math.max(0, max));
}
