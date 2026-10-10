// M3 grounding module: exports `ground` (GroundFn) and `retrieve` (RetrieveFn).
// `ground` checks each flag's quote against its clause and attaches citations only when retrieval supports them.
import { z } from "zod";
import type { GroundFn, RetrieveFn } from "../packages/shared/contracts";
import { FlagSchema, type Citation, type Clause, type Flag } from "../packages/shared/schemas";
import groundedMock from "../packages/shared/mocks/grounded.json" with { type: "json" };
import { retrieve } from "./retrieve";
import { verifyQuote } from "./verifyQuote";

export { retrieve };

const FlagsSchema = z.array(FlagSchema);

/** How many sources to retrieve per flag. */
const TOP_K = 3;

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
function toCitation(source: Awaited<ReturnType<RetrieveFn>>[number]): Citation {
  const citation: Citation = { sourceId: source.sourceId, title: source.title, snippet: source.snippet };
  if (source.url !== undefined) citation.url = source.url;
  if (source.asOf !== undefined) citation.asOf = source.asOf;
  return citation;
}

/**
 * Builds a GroundFn that uses the given retriever. Exported so tests can inject a fake retriever;
 * the app uses `ground` below.
 *
 * For each flag (order and count are preserved):
 *  - clause missing, or quote not found in the clause: quoteVerified=false, citations=[],
 *    grounding="unverified", and retrieval is skipped;
 *  - quote verified: retrieve up to TOP_K sources; "supported" only if at least one was found;
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
          const sources = await deps.retrieve({ query: buildQuery(flag, clause), topK: TOP_K });
          const citations = sources.map(toCitation);
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

/** The real GroundFn, backed by the corpus retriever in ./retrieve. */
export const ground: GroundFn = createGround({ retrieve });
