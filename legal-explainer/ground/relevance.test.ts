// Tests for the relevance gate. Uses small fake corpora defined here (never the shipped entries.json).
// Run with: npx tsx --test ground/relevance.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGround } from "./index";
import { RELEVANCE_SCORE_THRESHOLD, passesRelevanceGate, selectCitationSources } from "./relevance";
import { createRetriever, createRetrieverWithScores } from "./retrieve";
import type { CorpusEntry } from "./types";
import type { Clause, Flag } from "../packages/shared/schemas";

function fake(partial: Pick<CorpusEntry, "sourceId" | "title" | "snippet" | "topics">): CorpusEntry {
  return {
    url: `https://example.com/${partial.sourceId}`,
    asOf: "2000-01",
    docTypes: ["rental"],
    ...partial,
  };
}

/** Fake corpus: one entry per topic, plus filler so common words are not in every entry. */
const corpus: CorpusEntry[] = [
  fake({
    sourceId: "fake-deposit",
    title: "FAKE: widget deposit sample",
    snippet: "FAKE text about a widget deposit returned after inspection of the gadget.",
    topics: ["deposit"],
  }),
  fake({
    sourceId: "fake-termination",
    title: "FAKE: gizmo termination sample",
    snippet: "FAKE text about gizmo termination by giving notice to the other party.",
    topics: ["termination"],
  }),
  fake({
    sourceId: "fake-maintenance",
    title: "FAKE: sprocket upkeep sample",
    snippet: "FAKE text about sprocket upkeep and who oils the sprocket.",
    topics: ["maintenance"],
  }),
  fake({ sourceId: "fake-filler-1", title: "FAKE: apple notes", snippet: "FAKE text about apples.", topics: ["other"] }),
  fake({ sourceId: "fake-filler-2", title: "FAKE: boat notes", snippet: "FAKE text about boats.", topics: ["other"] }),
];

const clause: Clause = { id: "c1", index: 0, heading: "Sample", text: "The gizmo can be ended by giving notice.", page: 1 };

function flagFor(category: Flag["category"], quote: string): Flag {
  return {
    clauseId: "c1",
    category,
    riskLevel: "amber",
    quote,
    explanation: "FAKE explanation",
    whyItMatters: "FAKE why it matters",
    questionsToAsk: [],
    language: "en",
    citations: [],
    quoteVerified: false,
    grounding: "unverified",
  };
}

async function groundOne(flag: Flag, entries: CorpusEntry[] = corpus, clauseText: string = clause.text) {
  const ground = createGround({ retrieve: createRetrieverWithScores(entries) });
  const [result] = await ground({ clauses: [{ ...clause, text: clauseText }], flags: [flag] });
  return result;
}

test("the threshold is 6, as agreed", () => {
  assert.equal(RELEVANCE_SCORE_THRESHOLD, 6);
});

test("gate: a topic match passes whatever the score", () => {
  assert.equal(passesRelevanceGate("deposit", { topics: ["deposit"], score: 0.01 }), true);
  assert.equal(passesRelevanceGate("deposit", { topics: ["rent", "deposit"], score: 0.01 }), true);
});

test("gate: no topic match and a low score does not pass", () => {
  assert.equal(passesRelevanceGate("deposit", { topics: ["termination"], score: 5.99 }), false);
  assert.equal(passesRelevanceGate("lock_in", { topics: ["other"], score: 1 }), false);
});

test("gate: a high score passes without a topic match, and the boundary is inclusive", () => {
  assert.equal(passesRelevanceGate("deposit", { topics: ["termination"], score: 6 }), true);
  assert.equal(passesRelevanceGate("deposit", { topics: ["termination"], score: 9 }), true);
  assert.equal(passesRelevanceGate("deposit", { topics: ["termination"], score: 5.9999 }), false);
  assert.equal(passesRelevanceGate("deposit", { topics: ["termination"], score: 3 }, 3), true, "custom threshold");
});

test("selectCitationSources keeps order, applies the gate and limits the count", () => {
  const sources = [
    { id: "a", topics: ["termination"] as CorpusEntry["topics"], score: 4 },
    { id: "b", topics: ["deposit"] as CorpusEntry["topics"], score: 3 },
    { id: "c", topics: ["deposit"] as CorpusEntry["topics"], score: 2 },
    { id: "d", topics: ["termination"] as CorpusEntry["topics"], score: 7 },
    { id: "e", topics: ["deposit"] as CorpusEntry["topics"], score: 1 },
  ];
  assert.deepEqual(selectCitationSources("deposit", sources, 3).map((s) => s.id), ["b", "c", "d"]);
  assert.deepEqual(selectCitationSources("deposit", sources, 0), []);
  assert.deepEqual(selectCitationSources("lock_in", sources, 3).map((s) => s.id), ["d"]);
});

test("a flag whose category matches an entry's topic gets that entry cited and is supported", async () => {
  const flag = flagFor("deposit", "a widget deposit returned after inspection");
  const result = await groundOne(flag, corpus, "Pay a widget deposit returned after inspection of the gadget.");
  assert.equal(result.quoteVerified, true);
  assert.equal(result.grounding, "supported");
  assert.deepEqual(result.citations.map((c) => c.sourceId), ["fake-deposit"]);
});

test("a keyword-only match from a different topic is not cited, and the flag stays unverified", async () => {
  // Category is "deposit", but the corpus has no deposit entry; the only words that match are about
  // termination (a different topic). (The deposit entry is left out because the query contains the word
  // "deposit", which would make it a genuine topic match.)
  const withoutDeposit = corpus.filter((entry) => entry.sourceId !== "fake-deposit");
  const flag = flagFor("deposit", "giving notice");
  const clauseText = "The agreement ends by giving notice to the other party.";

  // The keyword search does find the termination entry, above the old minimum score of 1 (the query is built
  // the way ground builds it: category, clause heading, quote)...
  const candidates = await createRetrieverWithScores(withoutDeposit)({ query: "deposit Sample giving notice", topK: 10 });
  const keywordOnly = candidates.find((c) => c.sourceId === "fake-termination");
  assert.ok(keywordOnly, "the fake termination entry should be a keyword candidate");
  assert.ok(keywordOnly.score >= 1 && keywordOnly.score < RELEVANCE_SCORE_THRESHOLD, `score ${keywordOnly.score}`);
  assert.ok(!keywordOnly.topics.includes("deposit"));

  // ...but the gate refuses to cite it for a deposit flag.
  const result = await groundOne(flag, withoutDeposit, clauseText);
  assert.equal(result.quoteVerified, true);
  assert.deepEqual(result.citations, []);
  assert.equal(result.grounding, "unverified");
});

test("a lock_in flag gets no citation when no entry covers lock_in", async () => {
  // The corpus has termination, deposit and maintenance entries but nothing for lock_in. The quote still shares
  // words with the termination entry, so a keyword-only search would have cited it.
  const flag = flagFor("lock_in", "giving notice");
  const clauseText = "The agreement ends by giving notice to the other party.";
  const candidates = await createRetrieverWithScores(corpus)({ query: "lock in Sample giving notice", topK: 10 });
  assert.ok(candidates.some((c) => c.sourceId === "fake-termination"), "a keyword-only candidate exists");
  assert.ok(candidates.every((c) => !c.topics.includes("lock_in")), "no entry covers lock_in");

  const result = await groundOne(flag, corpus, clauseText);
  assert.equal(result.quoteVerified, true);
  assert.deepEqual(result.citations, []);
  assert.equal(result.grounding, "unverified");
});

test("when an entry does cover lock_in, a lock_in flag is cited", async () => {
  const withLockIn = [
    ...corpus,
    fake({
      sourceId: "fake-lock-in",
      title: "FAKE: lock-in sample",
      snippet: "FAKE text about a lock-in period during which the gizmo cannot be ended.",
      topics: ["lock_in"],
    }),
  ];
  const flag = flagFor("lock_in", "a lock-in period during which the gizmo cannot be ended");
  const result = await groundOne(flag, withLockIn, "There is a lock-in period during which the gizmo cannot be ended.");
  assert.equal(result.grounding, "supported");
  assert.ok(result.citations.some((c) => c.sourceId === "fake-lock-in"));
});

test("a very high keyword score from a different topic passes the gate", async () => {
  // This quote matches the termination entry strongly (a score above the threshold), though the flag is "deposit".
  const quote = "gizmo termination by giving notice";
  const clauseText = "The agreement allows gizmo termination by giving notice to the other party.";
  const scored = await createRetrieverWithScores(corpus)({ query: `deposit Sample ${quote}`, topK: 10 });
  const top = scored.find((c) => c.sourceId === "fake-termination");
  assert.ok(top && top.score >= RELEVANCE_SCORE_THRESHOLD, `expected a score of at least 6, got ${top?.score}`);
  assert.ok(passesRelevanceGate("deposit", top));

  const result = await groundOne(flagFor("deposit", quote), corpus, clauseText);
  assert.ok(result.citations.some((c) => c.sourceId === "fake-termination"), "cited on score alone");
  assert.equal(result.grounding, "supported");
});

test("only gated results are cited: a mix keeps the topic match and drops the keyword-only match", async () => {
  const mixed: CorpusEntry[] = [
    ...corpus,
    fake({
      sourceId: "fake-deposit-2",
      title: "FAKE: gizmo deposit sample",
      snippet: "FAKE text about a gizmo deposit and notice before it is returned.",
      topics: ["deposit"],
    }),
  ];
  const flag = flagFor("deposit", "gizmo deposit notice");
  const result = await groundOne(flag, mixed, "A gizmo deposit notice applies.");
  const ids = result.citations.map((c) => c.sourceId);
  assert.ok(ids.includes("fake-deposit-2"), "the deposit-topic entry is cited");
  assert.ok(!ids.includes("fake-termination"), "the keyword-only termination entry is not cited");
  assert.equal(result.grounding, "supported");
});

test("an unverified quote is still not retrieved or cited", async () => {
  const flag = flagFor("deposit", "text that is not in the clause");
  const result = await groundOne(flag, corpus, "A widget deposit returned after inspection.");
  assert.equal(result.quoteVerified, false);
  assert.deepEqual(result.citations, []);
  assert.equal(result.grounding, "unverified");
});

test("a plain RetrieveFn (no topics or score) is not gated, so existing injected retrievers keep working", async () => {
  const ground = createGround({ retrieve: createRetriever(corpus) });
  const [result] = await ground({
    clauses: [{ ...clause, text: "The agreement ends by giving notice to the other party." }],
    flags: [flagFor("lock_in", "giving notice")],
  });
  assert.equal(result.grounding, "supported", "ungated: a plain retriever's results are cited as before");
});

test("createRetrieverWithScores returns topics and a numeric score; createRetriever returns neither", async () => {
  const scored = await createRetrieverWithScores(corpus)({ query: "widget deposit", topK: 3 });
  assert.ok(scored.length > 0);
  assert.deepEqual(scored[0].topics, ["deposit"]);
  assert.equal(typeof scored[0].score, "number");
  const plain = await createRetriever(corpus)({ query: "widget deposit", topK: 3 });
  assert.deepEqual(Object.keys(plain[0]).sort(), ["asOf", "snippet", "sourceId", "title", "url"]);
});

