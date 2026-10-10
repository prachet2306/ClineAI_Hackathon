// M3 retrieval: a small in-house BM25 keyword search over corpus entries, implementing RetrieveFn.
// Also offers a scored variant (adds topics and the BM25 score) that the relevance gate in index.ts uses.
import type { RetrieveFn } from "../packages/shared/contracts";
import { PLACEHOLDER_SOURCE_ID, loadCorpus, type CorpusEntry } from "./types";

/** Standard BM25 constants. */
const K1 = 1.2;
const B = 0.75;

/** A match in the title or topics counts more than a match in the snippet. */
const FIELD_WEIGHTS = { title: 2, topics: 2, snippet: 1 } as const;

export const DEFAULT_TOP_K = 3;
/** Results scoring below this are dropped. Rare-word matches score around 1 or more; words found in most entries score far lower. */
export const DEFAULT_MIN_SCORE = 1;

/** Very common English words that carry no meaning for matching. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it",
  "of", "on", "or", "s", "that", "the", "this", "to", "with",
]);

export interface RetrieverOptions {
  /** Results scoring below this are dropped (default DEFAULT_MIN_SCORE). */
  minScore?: number;
  /** Used when the caller does not pass topK (default DEFAULT_TOP_K). */
  defaultTopK?: number;
}

/** A RetrieveFn result plus the entry's topics and its BM25 score, for relevance checks. */
export type ScoredSource = Awaited<ReturnType<RetrieveFn>>[number] & {
  topics: CorpusEntry["topics"];
  score: number;
};

/** Like RetrieveFn, but each result also carries the entry's topics and BM25 score. */
export type RetrieveWithScoresFn = (input: { query: string; topK?: number }) => Promise<ScoredSource[]>;

/** Crude plural handling so "deposits" matches "deposit". Applied to both entries and queries. */
function stem(token: string): string {
  return token.length > 3 && token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token;
}

/** Lowercases, splits on anything that is not a letter or digit (so rent_escalation becomes two words), drops stopwords. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
    .map(stem);
}

interface IndexedEntry {
  entry: CorpusEntry;
  /** Weighted count of each term across title, snippet and topics. */
  termFreq: Map<string, number>;
  /** Weighted total number of terms. */
  length: number;
}

function indexEntry(entry: CorpusEntry): IndexedEntry {
  const termFreq = new Map<string, number>();
  let length = 0;
  const fields: [string[], number][] = [
    [tokenize(entry.title), FIELD_WEIGHTS.title],
    [tokenize(entry.snippet), FIELD_WEIGHTS.snippet],
    [tokenize(entry.topics.join(" ")), FIELD_WEIGHTS.topics],
  ];
  for (const [tokens, weight] of fields) {
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + weight);
      length += weight;
    }
  }
  return { entry, termFreq, length };
}

/**
 * Builds a retriever over the given entries that reports topics and BM25 score with each result.
 * The index is built once, up front. Results are ranked by BM25 score (ties broken by sourceId),
 * limited to topK, and anything below the minimum score is skipped. Returns [] when nothing matches.
 */
export function createRetrieverWithScores(
  entries: readonly CorpusEntry[],
  options: RetrieverOptions = {},
): RetrieveWithScoresFn {
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const defaultTopK = options.defaultTopK ?? DEFAULT_TOP_K;

  const docs = entries.map(indexEntry);
  const docCount = docs.length;
  const avgLength = docCount === 0 ? 0 : docs.reduce((sum, doc) => sum + doc.length, 0) / docCount;

  const docFreq = new Map<string, number>();
  for (const doc of docs) {
    for (const term of doc.termFreq.keys()) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  function score(doc: IndexedEntry, queryTerms: readonly string[]): number {
    let total = 0;
    for (const term of queryTerms) {
      const tf = doc.termFreq.get(term) ?? 0;
      if (tf === 0) continue;
      const df = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
      const lengthNorm = 1 - B + B * (doc.length / avgLength);
      total += (idf * (tf * (K1 + 1))) / (tf + K1 * lengthNorm);
    }
    return total;
  }

  return async ({ query, topK }) => {
    const limit = Math.floor(topK ?? defaultTopK);
    if (!(limit > 0) || docCount === 0) return [];

    const queryTerms = [...new Set(tokenize(query))];
    if (queryTerms.length === 0) return [];

    return docs
      .map((doc) => ({ entry: doc.entry, score: score(doc, queryTerms) }))
      .filter((scored) => scored.score > 0 && scored.score >= minScore)
      .sort((a, b) => b.score - a.score || a.entry.sourceId.localeCompare(b.entry.sourceId))
      .slice(0, limit)
      .map(({ entry, score }) => ({
        sourceId: entry.sourceId,
        title: entry.title,
        snippet: entry.snippet,
        url: entry.url,
        asOf: entry.asOf,
        topics: entry.topics,
        score,
      }));
  };
}

/** Builds a plain RetrieveFn over the given entries (same ranking as createRetrieverWithScores, without topics and score). */
export function createRetriever(entries: readonly CorpusEntry[], options: RetrieverOptions = {}): RetrieveFn {
  const scored = createRetrieverWithScores(entries, options);
  return async (input) => {
    const results = await scored(input);
    return results.map(({ sourceId, title, snippet, url, asOf }) => ({ sourceId, title, snippet, url, asOf }));
  };
}

let defaultScoredRetriever: RetrieveWithScoresFn | undefined;

/** The shipped corpus without any placeholder entry, which must never be returned or cited. */
function shippedEntries(): CorpusEntry[] {
  return loadCorpus().filter((entry) => entry.sourceId !== PLACEHOLDER_SOURCE_ID);
}

/** Searches the shipped corpus (corpus/entries.json) with scores, ignoring any placeholder entry. Loaded on first use. */
export const retrieveWithScores: RetrieveWithScoresFn = async (input) => {
  defaultScoredRetriever ??= createRetrieverWithScores(shippedEntries());
  return defaultScoredRetriever(input);
};

let defaultRetriever: RetrieveFn | undefined;

/** Searches the shipped corpus (corpus/entries.json), ignoring any placeholder entry. Loaded on first use. */
export const retrieve: RetrieveFn = async (input) => {
  defaultRetriever ??= createRetriever(shippedEntries());
  return defaultRetriever(input);
};
