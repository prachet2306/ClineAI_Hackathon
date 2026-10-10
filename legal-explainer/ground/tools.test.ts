// Tests for the retrieve_law and verify_quote tools. Fake sources only (no real legal content).
// Run with: npx tsx --test ground/tools.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { RetrieveFn } from "../packages/shared/contracts";
import { createRetriever } from "./retrieve";
import type { CorpusEntry } from "./types";
import {
  QUERY_MAX_LENGTH,
  RetrieveLawInputSchema,
  TOP_K_MAX,
  VerifyQuoteInputSchema,
  createRetrieveLawTool,
  retrieveLawTool,
  verifyQuoteTool,
} from "./tools";

/** Minimal context, as in the SDK docs' "Testing Tools" examples (only agentId and iteration are required). */
const context: Parameters<typeof verifyQuoteTool.execute>[1] = { agentId: "test", iteration: 1 };

const fakeSource = {
  sourceId: "fake-source",
  title: "FAKE: sample source",
  snippet: "FAKE snippet text.",
  url: "https://example.com/fake-source",
  asOf: "2000-01",
};

function recordingRetriever(results: Awaited<ReturnType<RetrieveFn>>) {
  const calls: Parameters<RetrieveFn>[0][] = [];
  const fn: RetrieveFn = async (input) => {
    calls.push(input);
    return results;
  };
  return { fn, calls };
}

test("retrieve_law input: query must be 1 to 500 characters", () => {
  assert.equal(RetrieveLawInputSchema.safeParse({ query: "a" }).success, true);
  assert.equal(RetrieveLawInputSchema.safeParse({ query: "a".repeat(QUERY_MAX_LENGTH) }).success, true);
  assert.equal(RetrieveLawInputSchema.safeParse({ query: "" }).success, false);
  assert.equal(RetrieveLawInputSchema.safeParse({ query: "a".repeat(QUERY_MAX_LENGTH + 1) }).success, false);
  assert.equal(RetrieveLawInputSchema.safeParse({}).success, false);
  assert.equal(RetrieveLawInputSchema.safeParse({ query: 5 }).success, false);
});

test("retrieve_law input: topK is an optional integer from 1 to 5", () => {
  for (const topK of [1, 2, 5]) assert.equal(RetrieveLawInputSchema.safeParse({ query: "x", topK }).success, true);
  assert.equal(RetrieveLawInputSchema.safeParse({ query: "x" }).success, true);
  for (const topK of [0, 6, -1, 1.5, "3", null]) {
    assert.equal(RetrieveLawInputSchema.safeParse({ query: "x", topK }).success, false, String(topK));
  }
});

test("verify_quote input: both fields are required strings", () => {
  assert.equal(VerifyQuoteInputSchema.safeParse({ clauseText: "a", quote: "a" }).success, true);
  assert.equal(VerifyQuoteInputSchema.safeParse({ clauseText: "a" }).success, false);
  assert.equal(VerifyQuoteInputSchema.safeParse({ quote: "a" }).success, false);
  assert.equal(VerifyQuoteInputSchema.safeParse({ clauseText: 1, quote: "a" }).success, false);
});

test("tool names, descriptions and JSON schemas", () => {
  assert.equal(retrieveLawTool.name, "retrieve_law");
  assert.equal(verifyQuoteTool.name, "verify_quote");
  assert.match(retrieveLawTool.description, /reference sources/i);
  assert.match(verifyQuoteTool.description, /quote/i);
  const props = retrieveLawTool.inputSchema.properties as Record<string, Record<string, unknown>>;
  assert.equal(retrieveLawTool.inputSchema.type, "object");
  assert.deepEqual(retrieveLawTool.inputSchema.required, ["query"]);
  assert.equal(props.query.minLength, 1);
  assert.equal(props.query.maxLength, QUERY_MAX_LENGTH);
  assert.equal(props.topK.minimum, 1);
  assert.equal(props.topK.maximum, TOP_K_MAX);
  assert.deepEqual(verifyQuoteTool.inputSchema.required, ["clauseText", "quote"]);
});

test("retrieve_law passes query and topK to the retriever and returns its results", async () => {
  const { fn, calls } = recordingRetriever([fakeSource]);
  const output = await createRetrieveLawTool(fn).execute({ query: "deposit refund", topK: 2 }, context);
  assert.deepEqual(output, { results: [fakeSource] });
  assert.deepEqual(calls, [{ query: "deposit refund", topK: 2 }]);
});

test("retrieve_law leaves topK to the retriever when it is omitted", async () => {
  const { fn, calls } = recordingRetriever([]);
  await createRetrieveLawTool(fn).execute({ query: "deposit" }, context);
  assert.equal(calls[0].topK, undefined);
});

/** A small in-test corpus of fake entries, so these tests never depend on the shipped corpus/entries.json. */
const fakeCorpus: CorpusEntry[] = [
  {
    sourceId: "fake-apple",
    title: "FAKE: Apple storage notes",
    snippet: "FAKE text about keeping apples cool in a cellar.",
    url: "https://example.com/fake-apple",
    asOf: "2000-01",
    docTypes: ["other"],
    topics: ["maintenance"],
  },
  {
    sourceId: "fake-boat",
    title: "FAKE: Boat mooring guide",
    snippet: "FAKE text about tying a boat to a mooring buoy.",
    url: "https://example.com/fake-boat",
    asOf: "2000-01",
    docTypes: ["other"],
    topics: ["fees"],
  },
];

test("retrieve_law returns an empty results array when the retriever finds nothing", async () => {
  const { fn, calls } = recordingRetriever([]);
  const output = await createRetrieveLawTool(fn).execute({ query: "unicorn" }, context);
  assert.deepEqual(output, { results: [] });
  assert.equal(calls.length, 1);
});

test("retrieve_law returns { results: [] } with no invented citations when a real retriever has no match in a small corpus", async () => {
  const tool = createRetrieveLawTool(createRetriever(fakeCorpus));
  const output = await tool.execute({ query: "unicorn telescope" }, context);
  assert.deepEqual(output, { results: [] });
  assert.ok(!("error" in output), "no match is an empty result, not an error");
  // Nothing was made up: no sources and no URLs appear anywhere in the output.
  assert.ok(!JSON.stringify(output).includes("http"));

  // The same tool does return a source when the query does match, so the empty result above is a real "no match".
  const matching = await tool.execute({ query: "boat mooring" }, context);
  assert.ok("results" in matching && matching.results.length > 0);
  assert.equal("results" in matching && matching.results[0].sourceId, "fake-boat");
});

test("retrieve_law returns only the documented fields and omits missing optional ones", async () => {
  const withExtras = { ...fakeSource, score: 9.5, topics: ["deposit"] };
  const bare = { sourceId: "fake-bare", title: "FAKE: bare", snippet: "FAKE bare snippet." };
  const { fn } = recordingRetriever([withExtras, bare]);
  const output = await createRetrieveLawTool(fn).execute({ query: "x" }, context);
  assert.deepEqual(output, { results: [fakeSource, bare] });
});

test("retrieve_law rejects invalid input without calling the retriever, and does not echo the values", async () => {
  const { fn, calls } = recordingRetriever([fakeSource]);
  const tool = createRetrieveLawTool(fn);
  const secret = "SECRET-DOCUMENT-TEXT-".repeat(40); // 840 characters, over the 500 limit
  const inputs: unknown[] = [
    { query: "" },
    { query: secret },
    { query: "x", topK: 0 },
    { query: "x", topK: 6 },
    { query: "x", topK: 2.5 },
    {},
    null,
    "not an object",
  ];
  for (const input of inputs) {
    const output = await tool.execute(input, context);
    assert.ok("error" in output, `expected an error for ${JSON.stringify(input)?.slice(0, 40)}`);
    assert.ok(!output.error.includes("SECRET-DOCUMENT-TEXT"), "error message must not echo the input");
  }
  assert.equal(calls.length, 0);
});

test("verify_quote returns { verified: true } for an exact quote", async () => {
  const output = await verifyQuoteTool.execute(
    { clauseText: "The Landlord may terminate this Agreement at any time.", quote: "terminate this Agreement" },
    context,
  );
  assert.deepEqual(output, { verified: true });
});

test("verify_quote returns { verified: true } for whitespace and curly-quote differences", async () => {
  const output = await verifyQuoteTool.execute(
    { clauseText: "fifteen (15)  days'\nnotice", quote: "fifteen (15) days\u2019 notice" },
    context,
  );
  assert.deepEqual(output, { verified: true });
});

test("verify_quote returns { verified: false } for a quote not in the clause and for an empty quote", async () => {
  const clauseText = "The Landlord may terminate this Agreement at any time.";
  assert.deepEqual(await verifyQuoteTool.execute({ clauseText, quote: "The Tenant may terminate" }, context), {
    verified: false,
  });
  assert.deepEqual(await verifyQuoteTool.execute({ clauseText, quote: "" }, context), { verified: false });
});

test("verify_quote rejects missing or non-string input without echoing it", async () => {
  const inputs: unknown[] = [{ clauseText: "a" }, { quote: "a" }, { clauseText: 1, quote: "a" }, null, undefined];
  for (const input of inputs) {
    const output = await verifyQuoteTool.execute(input, context);
    assert.ok("error" in output);
  }
  const output = await verifyQuoteTool.execute({ clauseText: "SECRET-CLAUSE", quote: 5 }, context);
  assert.ok("error" in output);
  assert.ok(!output.error.includes("SECRET-CLAUSE"));
});

test("index.ts does not import tools.ts, so ground works without the SDK", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(!/from\s+["']\.\/tools["']/.test(source), "index.ts must not import ./tools");
  assert.ok(!source.includes("@cline/sdk"), "index.ts must not import @cline/sdk");
});
