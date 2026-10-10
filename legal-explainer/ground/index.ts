// M3 grounding module: exports `ground` (GroundFn) and `retrieve` (RetrieveFn).
// `ground` checks each flag's quote against its clause and attaches citations only when retrieval supports them.
import { z } from "zod";
import type { GroundFn, RetrieveFn } from "../packages/shared/contracts";
import { FlagSchema, type Citation, type Flag } from "../packages/shared/schemas";
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

/** Search text for one flag: its category, the quoted text and the plain-language explanation. */
function buildQuery(flag: Flag): string {
  return [flag.category, flag.quote, flag.explanation].join(" ");
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
 * For each flag (order and count are preserved): find its clause, set quoteVerified, retrieve up to
 * TOP_K sources, and set citations plus grounding ("supported" only if sources were found).
 * A flag whose clause is missing is kept as-is except quoteVerified=false and grounding="unverified".
 */
export function createGround(deps: { retrieve: RetrieveFn }): GroundFn {
  return async ({ clauses, flags }) => {
    if (useMock()) {
      return FlagsSchema.parse(groundedMock);
    }

    const grounded = await Promise.all(
      flags.map(async (flag): Promise<Flag> => {
        const clause = clauses.find((candidate) => candidate.id === flag.clauseId);
        if (!clause) {
          return { ...flag, quoteVerified: false, grounding: "unverified" };
        }

        const quoteVerified = verifyQuote(clause.text, flag.quote);
        const sources = await deps.retrieve({ query: buildQuery(flag), topK: TOP_K });
        const citations = sources.map(toCitation);

        return {
          ...flag,
          quoteVerified,
          citations,
          grounding: citations.length > 0 ? "supported" : "unverified",
        };
      }),
    );

    return FlagsSchema.parse(grounded);
  };
}

/** The real GroundFn, backed by the corpus retriever in ./retrieve. */
export const ground: GroundFn = createGround({ retrieve });
