// M3 grounding module: exports `ground` (GroundFn) and `retrieve` (RetrieveFn).
// `ground` checks each flag's quote against its clause and attaches citations only when retrieval supports them
// (the source's topics include the flag's category, or its keyword score is very high).
import { z } from "zod";
import type { GroundFn, RetrieveFn } from "../packages/shared/contracts";
import { FlagSchema, type Citation, type Clause, type ClauseCategory, type Flag } from "../packages/shared/schemas";
import groundedMock from "../packages/shared/mocks/grounded.json" with { type: "json" };
import { passesRelevanceGate } from "./relevance";
import { retrieve, retrieveWithScores, type ScoredSource } from "./retrieve";
import { verifyQuote } from "./verifyQuote";

export { retrieve };

const FlagsSchema = z.array(FlagSchema);

/** The most citations attached to one flag. */
const MAX_CITATIONS = 3;

/** How many candidates to retrieve per flag before the relevance gate keeps up to MAX_CITATIONS. */
const CANDIDATE_TOP_K = 10;

type RetrievedSource = Awaited<ReturnType<RetrieveFn>>[number];

/** True for results from a scored retriever (they carry the entry's topics and BM25 score). */
function isScored(source: RetrievedSource): source is ScoredSource {
  const candidate = source as Partial<ScoredSource>;
  return typeof candidate.score === "number" && Array.isArray(candidate.topics);
}

/**
 * Keeps the sources that may be cited for this category, best first, at most MAX_CITATIONS.
 * Scored results must pass the relevance gate. Results from a plain retriever carry no topics or score,
 * so there is nothing to gate on and they are kept as they are.
 */
function selectSources(category: ClauseCategory, sources: readonly RetrievedSource[]): RetrievedSource[] {
  return sources.filter((source) => !isScored(source) || passesRelevanceGate(category, source)).slice(0, MAX_CITATIONS);
}

/** Set GROUND_USE_MOCK=1 to return packages/shared/mocks/grounded.json instead of grounding for real. */
function useMock(): boolean {
  return process.env.GROUND_USE_MOCK === "1";
}

/**
 * Search text for one flag: the category (underscores as spaces), the clause heading if there is one,
 * and the quoted text. The explanation and whyItMatters are left out on purpose: they may be written
 * in another language, while the corpus is English.
 */
function buildQuery(flag: Flag, clause: Clause): string {
  const heading = clause.heading?.trim();
  return [flag.category.replace(/_/g, " "), heading, flag.quote].filter((part) => part && part.length > 0).join(" ");
}

/** The result for a flag we could not support: no citations, unverified. */
function unverified(flag: Flag, quoteVerified: boolean): Flag {
  return { ...flag, quoteVerified, citations: [], grounding: "unverified" };
}

/** Copies only the CitationSchema fields from a retrieved source, never adding anything of our own. */
function toCitation(source: RetrievedSource): Citation {
  const citation: Citation = { sourceId: source.sourceId, title: source.title, snippet: source.snippet };
  if (source.url !== undefined) citation.url = source.url;
  if (source.asOf !== undefined) citation.asOf = source.asOf;
  return citation;
}

/**
 * Builds a GroundFn that uses the given retriever. Exported so tests can inject a fake retriever;
 * the app uses `ground` below. The retriever may be a plain RetrieveFn or a scored one (see retrieve.ts);
 * a scored retriever's results go through the relevance gate in relevance.ts.
 *
 * For each flag (order and count are preserved):
 *  - clause missing, or quote not found in the clause: quoteVerified=false, citations=[],
 *    grounding="unverified", and retrieval is skipped;
 *  - quote verified: retrieve candidates, keep up to MAX_CITATIONS that may be cited, and set
 *    "supported" only if at least one remains; if none passes the gate the flag stays "unverified"
 *    with no citations;
 *  - retrieval throws for this flag: citations=[], grounding="unverified" (quoteVerified stays true),
 *    and the other flags carry on. The error is deliberately not logged or returned.
 */
export function createGround(deps: { retrieve: RetrieveFn }): GroundFn {
  return async ({ clauses, flags }) => {
    if (useMock()) {
      return FlagsSchema.parse(groundedMock);
    }

    const grounded = await Promise.all(
      flags.map(async (flag): Promise<Flag> => {
        const clause = clauses.find((candidate) => candidate.id === flag.clauseId);
        if (!clause || !verifyQuote(clause.text, flag.quote)) {
          return unverified(flag, false);
        }

        try {
          const sources = await deps.retrieve({ query: buildQuery(flag, clause), topK: CANDIDATE_TOP_K });
          const citations = selectSources(flag.category, sources).map(toCitation);
          return citations.length > 0
            ? { ...flag, quoteVerified: true, citations, grounding: "supported" }
            : unverified(flag, true);
        } catch {
          return unverified(flag, true);
        }
      }),
    );

    return FlagsSchema.parse(grounded);
  };
}

/** The real GroundFn, backed by the scored corpus retriever in ./retrieve and the relevance gate. */
export const ground: GroundFn = createGround({ retrieve: retrieveWithScores });
