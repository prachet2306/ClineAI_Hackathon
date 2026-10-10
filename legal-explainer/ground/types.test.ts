// Tests for the corpus schema and loader. Uses fake entries defined here (no real legal content).
// Run with: npx tsx --test ground/types.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CorpusEntrySchema, PLACEHOLDER_SOURCE_ID, loadCorpus, parseCorpus } from "./types";

const validEntry = {
  sourceId: "fake-entry",
  title: "FAKE: sample title",
  snippet: "FAKE sample snippet.",
  url: "https://example.com/fake-entry",
  asOf: "2000-01",
  docTypes: ["rental", "other"],
  topics: ["deposit", "fees"],
};

test("accepts a valid entry", () => {
  assert.deepEqual(parseCorpus([validEntry]), [validEntry]);
});

test("accepts asOf as YYYY, YYYY-MM or YYYY-MM-DD", () => {
  for (const asOf of ["2000", "2000-01", "2000-01-31"]) {
    assert.equal(CorpusEntrySchema.safeParse({ ...validEntry, asOf }).success, true, asOf);
  }
});

test("rejects data that is not an array", () => {
  assert.throws(() => parseCorpus({}), /must be a JSON array/);
});

test("names the entry and field for a bad value", () => {
  assert.throws(
    () => parseCorpus([validEntry, { ...validEntry, sourceId: "bad-one", topics: ["not_a_category"] }]),
    /Entry #2 \(sourceId "bad-one"\): topics\.0/,
  );
});

test("rejects missing, empty and malformed fields", () => {
  const bad: Record<string, unknown>[] = [
    { ...validEntry, snippet: "" },
    { ...validEntry, url: "not a url" },
    { ...validEntry, asOf: "last year" },
    { ...validEntry, docTypes: [] },
    { ...validEntry, docTypes: ["contract"] },
    { ...validEntry, topics: [] },
  ];
  for (const entry of bad) {
    assert.throws(() => parseCorpus([entry]), /Invalid corpus/);
  }
  const { url: _url, ...withoutUrl } = validEntry;
  assert.throws(() => parseCorpus([withoutUrl]), /url/);
});

test("rejects unknown fields so typos are caught", () => {
  assert.throws(() => parseCorpus([{ ...validEntry, topic: ["deposit"] }]), /Invalid corpus/);
});

test("rejects duplicate sourceIds", () => {
  assert.throws(() => parseCorpus([validEntry, validEntry]), /must be unique/);
});

test("reports every problem in one error", () => {
  try {
    parseCorpus([{ ...validEntry, url: "nope" }, { ...validEntry, sourceId: "second", asOf: "nope" }]);
    assert.fail("expected parseCorpus to throw");
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.match(error.message, /2 problems/);
    assert.match(error.message, /Entry #1/);
    assert.match(error.message, /Entry #2/);
  }
});

test("the shipped entries.json loads, has real entries and no placeholder", () => {
  const corpus = loadCorpus();
  assert.ok(corpus.length >= 1);
  // The placeholder has been replaced by real entries; none of its marker values may remain.
  assert.ok(corpus.every((entry) => entry.sourceId !== PLACEHOLDER_SOURCE_ID), "placeholder entry is still present");
  assert.ok(corpus.every((entry) => entry.snippet !== "REPLACE ME"), "a REPLACE ME snippet is still present");
  assert.ok(corpus.every((entry) => !entry.url.includes("example.com")), "an example.com url is still present");
});
