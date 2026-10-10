// Tests for the BM25 retriever. Uses fake entries defined here (no real legal content).
// Run with: npx tsx --test ground/retrieve.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRetriever, retrieve, tokenize } from "./retrieve";
import type { CorpusEntry } from "./types";

function fake(partial: Pick<CorpusEntry, "sourceId" | "title" | "snippet"> & Partial<CorpusEntry>): CorpusEntry {
  return {
    url: `https://example.com/${partial.sourceId}`,
    asOf: "2000-01",
    docTypes: ["other"],
    topics: ["other"],
    ...partial,
  };
}

const entries: CorpusEntry[] = [
  fake({
    sourceId: "fake-apple",
    title: "FAKE: Apple storage notes",
    snippet: "FAKE text about keeping apples cool in a cellar so they stay crisp.",
    topics: ["maintenance"],
  }),
  fake({
    sourceId: "fake-boat",
    title: "FAKE: Boat mooring guide",
    snippet: "FAKE text about tying a boat to a mooring buoy in a harbour.",
    topics: ["fees"],
  }),
  fake({
    sourceId: "fake-deposit",
    title: "FAKE: Widget deposit sample",
    snippet: "FAKE text about a widget deposit being returned after inspection.",
    topics: ["deposit"],
  }),
  fake({
    sourceId: "fake-escalation",
    title: "FAKE: Yearly increase sample",
    snippet: "FAKE text about a yearly increase applied on an anniversary.",
    topics: ["rent_escalation"],
  }),
];

const search = createRetriever(entries);

test("tokenize lowercases, splits on punctuation and underscores, drops stopwords and plural s", () => {
  assert.deepEqual(tokenize("The Deposits, of rent_escalation!"), ["deposit", "rent", "escalation"]);
  assert.deepEqual(tokenize("   "), []);
});

test("ranks the entry matching the query first", async () => {
  const results = await search({ query: "boat mooring" });
  assert.equal(results[0]?.sourceId, "fake-boat");
});

test("matches words in the topics field", async () => {
  const results = await search({ query: "rent escalation" });
  assert.equal(results[0]?.sourceId, "fake-escalation");
});

test("matches plurals and ignores case", async () => {
  const results = await search({ query: "APPLES" });
  assert.equal(results[0]?.sourceId, "fake-apple");
});

test("returns the RetrieveFn result shape with the entry's citation fields", async () => {
  const [first] = await search({ query: "widget" });
  assert.deepEqual(first, {
    sourceId: "fake-deposit",
    title: "FAKE: Widget deposit sample",
    snippet: "FAKE text about a widget deposit being returned after inspection.",
    url: "https://example.com/fake-deposit",
    asOf: "2000-01",
  });
});

test("returns an empty array when nothing matches", async () => {
  assert.deepEqual(await search({ query: "unicorn telescope" }), []);
});

test("returns an empty array for an empty or stopword-only query", async () => {
  assert.deepEqual(await search({ query: "" }), []);
  assert.deepEqual(await search({ query: "the of and" }), []);
});

test("respects topK", async () => {
  const everything = createRetriever(entries, { minScore: 0 });
  // "fake" appears in every entry, so all four match.
  assert.equal((await everything({ query: "fake", topK: 2 })).length, 2);
  assert.equal((await everything({ query: "fake", topK: 10 })).length, 4);
});

test("topK of zero or less returns an empty array", async () => {
  const everything = createRetriever(entries, { minScore: 0 });
  assert.deepEqual(await everything({ query: "fake", topK: 0 }), []);
  assert.deepEqual(await everything({ query: "fake", topK: -1 }), []);
});

test("skips results below the minimum score", async () => {
  // A word found in every entry has a very low score, so the default minimum drops it...
  assert.deepEqual(await search({ query: "fake" }), []);
  // ...but it is returned when the minimum is lowered.
  const lenient = createRetriever(entries, { minScore: 0 });
  assert.ok((await lenient({ query: "fake" })).length > 0);
});

test("an empty corpus returns an empty array", async () => {
  assert.deepEqual(await createRetriever([])({ query: "anything" }), []);
});

test("the default retriever never returns the placeholder entry", async () => {
  // Holds for any contents of the shipped corpus: queries built from the placeholder's own words
  // must not bring the placeholder back. (Does not assume the corpus is empty or contains it.)
  const queries = [
    "REPLACE ME placeholder",
    "PLACEHOLDER - replace with a real, verified source",
    "replace-me example.com other",
  ];
  for (const query of queries) {
    const results = await retrieve({ query, topK: 10 });
    assert.ok(
      results.every((result) => result.sourceId !== "placeholder"),
      `placeholder returned for query: ${query}`,
    );
  }
});
