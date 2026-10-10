// Tests for verifyQuote. Run with: npx tsx --test ground/verifyQuote.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyQuote } from "./verifyQuote";

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
