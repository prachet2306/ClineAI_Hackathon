// M3 agent tools: thin Cline SDK wrappers (retrieve_law, verify_quote) around the plain functions in /ground.
// Not imported by index.ts, so `ground` works without the SDK. M1 registers these tools in /agent.
import { createTool } from "@cline/sdk";
import { z } from "zod";
import type { RetrieveFn } from "../packages/shared/contracts";
import { retrieve } from "./retrieve";
import { verifyQuote } from "./verifyQuote";

/** Limits shared by the Zod schema (used to validate) and the JSON Schema (shown to the model). */
export const QUERY_MIN_LENGTH = 1;
export const QUERY_MAX_LENGTH = 500;
export const TOP_K_MIN = 1;
export const TOP_K_MAX = 5;

export const RetrieveLawInputSchema = z.object({
  query: z.string().min(QUERY_MIN_LENGTH).max(QUERY_MAX_LENGTH),
  topK: z.number().int().min(TOP_K_MIN).max(TOP_K_MAX).optional(),
});

export const VerifyQuoteInputSchema = z.object({
  clauseText: z.string(),
  quote: z.string(),
});

/**
 * JSON Schemas handed to createTool. Why not pass the Zod schemas directly: createTool only converts
 * Zod 4 schemas from the SDK's own copy of zod, and this project uses zod 3, so a Zod 3 schema would
 * reach the model unconverted. The SDK also does not validate input before calling execute, so each
 * execute below parses its input with the Zod schema above. Keep the two in step (tools.test.ts checks).
 */
const retrieveLawJsonSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      minLength: QUERY_MIN_LENGTH,
      maxLength: QUERY_MAX_LENGTH,
      description:
        "Short English keywords or a short phrase describing what to look up, e.g. a clause topic such as 'security deposit refund'.",
    },
    topK: {
      type: "integer",
      minimum: TOP_K_MIN,
      maximum: TOP_K_MAX,
      description: `Maximum number of sources to return, from ${TOP_K_MIN} to ${TOP_K_MAX}. Defaults to 3.`,
    },
  },
  required: ["query"],
  additionalProperties: false,
} satisfies Record<string, unknown>;

const verifyQuoteJsonSchema = {
  type: "object",
  properties: {
    clauseText: {
      type: "string",
      description: "The full text of the clause the quote is supposed to come from.",
    },
    quote: {
      type: "string",
      description: "The exact words claimed to appear in the clause.",
    },
  },
  required: ["clauseText", "quote"],
  additionalProperties: false,
} satisfies Record<string, unknown>;

type RetrievedSource = Awaited<ReturnType<RetrieveFn>>[number];

export type RetrieveLawOutput = { results: RetrievedSource[] } | { error: string };
export type VerifyQuoteOutput = { verified: boolean } | { error: string };

/** Describes what was wrong with the input by field name and rule only, never echoing the values. */
function describeInputProblem(error: z.ZodError): string {
  const problems = error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`);
  return `Invalid input. ${problems.join("; ")}`;
}

/** Copies only the fields we expose, so nothing extra from the retriever reaches the model. */
function toResult(source: RetrievedSource): RetrievedSource {
  const result: RetrievedSource = { sourceId: source.sourceId, title: source.title, snippet: source.snippet };
  if (source.url !== undefined) result.url = source.url;
  if (source.asOf !== undefined) result.asOf = source.asOf;
  return result;
}

/** Builds the retrieve_law tool around the given retriever. Exported so tests can inject a fake one. */
export function createRetrieveLawTool(retrieveFn: RetrieveFn) {
  return createTool<unknown, RetrieveLawOutput>({
    name: "retrieve_law",
    description:
      "Look up reference sources from the curated corpus (tenancy, contract, loan and labour guidance). " +
      "Use this when you need a source to support or check a point about a contract clause. " +
      "Returns { results: [{ sourceId, title, snippet, url, asOf }] }, best match first. " +
      "An empty results array means nothing in the corpus supports the point: say so, and do not cite " +
      "or invent any statute, section number, figure or URL. " +
      "Keyword search over English text, so use short English keywords. Read-only.",
    inputSchema: retrieveLawJsonSchema,
    async execute(input) {
      const parsed = RetrieveLawInputSchema.safeParse(input);
      if (!parsed.success) return { error: describeInputProblem(parsed.error) };

      const sources = await retrieveFn({ query: parsed.data.query, topK: parsed.data.topK });
      return { results: sources.map(toResult) };
    },
  });
}

/** retrieve_law: looks up reference sources using the corpus retriever in ./retrieve. */
export const retrieveLawTool = createRetrieveLawTool(retrieve);

/** verify_quote: confirms a quote appears in a clause, using verifyQuote from ./verifyQuote. */
export const verifyQuoteTool = createTool<unknown, VerifyQuoteOutput>({
  name: "verify_quote",
  description:
    "Check whether a quote really appears in a clause's text. " +
    "Use this to confirm a quote is exact before presenting it as words taken from the document. " +
    "Returns { verified: true } only if the quote is an exact substring of clauseText " +
    "(differences in runs of whitespace and in curly versus straight quotes are ignored); otherwise { verified: false }. " +
    "It checks the wording only and says nothing about whether the clause is fair. Read-only.",
  inputSchema: verifyQuoteJsonSchema,
  async execute(input) {
    const parsed = VerifyQuoteInputSchema.safeParse(input);
    if (!parsed.success) return { error: describeInputProblem(parsed.error) };

    return { verified: verifyQuote(parsed.data.clauseText, parsed.data.quote) };
  },
});
