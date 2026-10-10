// M4 /compare: pure, LLM-free alignment of the clauses of two contract versions into candidate changes.
import type { Clause } from "../packages/shared/schemas";

export type CandidateKind = "added" | "removed" | "modified";

export interface Candidate {
  id: string; // chg1, chg2, ...
  kind: CandidateKind;
  clauseA?: Clause; // absent when added
  clauseB?: Clause; // absent when removed
}

const SIMILARITY_THRESHOLD = 0.5;

/** Collapses runs of whitespace to one space and trims. Case is kept. */
export const collapseWhitespace = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Lowercase, whitespace-collapsed text used to decide whether two clauses are identical. */
export const normalizeText = (text: string): string => collapseWhitespace(text).toLowerCase();

const normalizeHeading = (heading: string | undefined): string => normalizeText(heading ?? "");

const wordSet = (text: string): Set<string> => new Set(text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []);

/** Intersection divided by union of the lowercase Unicode word sets (0 when both are empty). */
export const wordSimilarity = (a: string, b: string): number => {
  const setA = wordSet(a);
  const setB = wordSet(b);
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared += 1;
  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
};

/**
 * Matches each A clause to at most one B clause: first by heading (all A clauses), then by the highest
 * word similarity above 0.5 for those left over. Returns a map from A position to B position.
 */
const matchClauses = (a: readonly Clause[], b: readonly Clause[]): Map<number, number> => {
  const matches = new Map<number, number>();
  const usedB = new Set<number>();

  a.forEach((clauseA, i) => {
    const heading = normalizeHeading(clauseA.heading);
    if (heading === "") return;
    const j = b.findIndex((clauseB, k) => !usedB.has(k) && normalizeHeading(clauseB.heading) === heading);
    if (j >= 0) {
      matches.set(i, j);
      usedB.add(j);
    }
  });

  a.forEach((clauseA, i) => {
    if (matches.has(i)) return;
    let bestIndex = -1;
    let bestScore = SIMILARITY_THRESHOLD;
    b.forEach((clauseB, k) => {
      if (usedB.has(k)) return;
      const score = wordSimilarity(clauseA.text, clauseB.text);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = k;
      }
    });
    if (bestIndex >= 0) {
      matches.set(i, bestIndex);
      usedB.add(bestIndex);
    }
  });

  return matches;
};

/**
 * Aligns two clause lists and returns the candidate changes with ids chg1, chg2, ...
 * Order: document order of version A (modified and removed), then added clauses in version B order.
 * Matched pairs with identical normalised text are not changes. Inputs are not modified.
 */
export const alignClauses = (versionA: readonly Clause[], versionB: readonly Clause[]): Candidate[] => {
  const a = [...versionA].sort((x, y) => x.index - y.index);
  const b = [...versionB].sort((x, y) => x.index - y.index);
  const matches = matchClauses(a, b);
  const matchedB = new Set(matches.values());

  const drafts: Omit<Candidate, "id">[] = [];
  a.forEach((clauseA, i) => {
    const j = matches.get(i);
    if (j === undefined) {
      drafts.push({ kind: "removed", clauseA });
      return;
    }
    const clauseB = b[j];
    if (clauseB === undefined) return;
    if (normalizeText(clauseA.text) === normalizeText(clauseB.text)) return;
    drafts.push({ kind: "modified", clauseA, clauseB });
  });
  b.forEach((clauseB, k) => {
    if (!matchedB.has(k)) drafts.push({ kind: "added", clauseB });
  });

  return drafts.map((draft, n) => ({ id: `chg${n + 1}`, ...draft }));
};
