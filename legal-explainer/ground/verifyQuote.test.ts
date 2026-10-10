// Tests for verifyQuote, including checks against the shared ingest and analysis mocks.
// Run with: npx tsx --test ground/verifyQuote.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyQuote } from "./verifyQuote";
import { AnalysisResultSchema, IngestResultSchema } from "../packages/shared/schemas";
import ingestMock from "../packages/shared/mocks/ingest.json" with { type: "json" };
import analysisMock from "../packages/shared/mocks/analysis.json" with { type: "json" };

const clause =
  "The Landlord may terminate this Agreement at any time by giving fifteen (15) days' notice.";

test("exact substring matches", () => {
  assert.equal(verifyQuote(clause, "terminate this Agreement at any time"), true);
  assert.equal(verifyQuote(clause, clause), true);
});

test("matching is case-sensitive for exact and fallback paths", () => {
  assert.equal(verifyQuote(clause, "the landlord may terminate"), false);
});

test("whitespace differences still match", () => {
  const spaced = "The monthly rent shall\n  increase by   15%\tevery year.";
  assert.equal(verifyQuote(spaced, "The monthly rent shall increase by 15% every year"), true);
  assert.equal(verifyQuote("The monthly rent shall increase by 15% every year", "rent   shall\nincrease"), true);
});

test("curly versus straight quotes still match", () => {
  assert.equal(verifyQuote(clause, "fifteen (15) days\u2019 notice"), true);
  const curlyClause = "The Landlord may keep the \u201Cdeposit\u201D if the tenant\u2019s rent is late.";
  assert.equal(verifyQuote(curlyClause, "the \"deposit\" if the tenant's rent"), true);
});

test("a quote that is not in the clause returns false", () => {
  assert.equal(verifyQuote(clause, "The Tenant may terminate this Agreement"), false);
  assert.equal(verifyQuote(clause, "fifteen (15) days notice period of one month"), false);
});

test("empty quotes return false", () => {
  assert.equal(verifyQuote(clause, ""), false);
  assert.equal(verifyQuote(clause, "   \n\t "), false);
  assert.equal(verifyQuote("", ""), false);
});

test("a non-empty quote against empty clause text returns false", () => {
  assert.equal(verifyQuote("", "anything"), false);
});

/* ---- Mock-based tests: real clause text and real flag quotes from packages/shared/mocks ---- */

const ingest = IngestResultSchema.parse(ingestMock);
const analysis = AnalysisResultSchema.parse(analysisMock);

/** Returns the quote with its longest word replaced, so exactly one word differs. */
function changeOneWord(quote: string): string {
  const words = quote.split(" ");
  let longestIndex = 0;
  words.forEach((word, i) => {
    if (word.length > words[longestIndex].length) longestIndex = i;
  });
  words[longestIndex] = "zzzzzz";
  return words.join(" ");
}

test("mock data has flags whose clauses exist in the ingest mock", () => {
  assert.ok(analysis.flags.length > 0);
  for (const flag of analysis.flags) {
    assert.ok(
      ingest.clauses.some((c) => c.id === flag.clauseId),
      `flag references unknown clause ${flag.clauseId}`,
    );
  }
});

test("every mock flag quote verifies against its clause text", () => {
  for (const flag of analysis.flags) {
    const clause = ingest.clauses.find((c) => c.id === flag.clauseId);
    assert.ok(clause, `missing clause ${flag.clauseId}`);
    assert.equal(verifyQuote(clause.text, flag.quote), true, `quote failed for clause ${flag.clauseId}`);
  }
});

test("changing one word of a mock flag quote makes verification fail", () => {
  for (const flag of analysis.flags) {
    const clause = ingest.clauses.find((c) => c.id === flag.clauseId);
    assert.ok(clause, `missing clause ${flag.clauseId}`);
    const altered = changeOneWord(flag.quote);
    assert.notEqual(altered, flag.quote);
    assert.equal(verifyQuote(clause.text, altered), false, `altered quote still verified for clause ${flag.clauseId}`);
  }
});
