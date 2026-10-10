/**
 * Tests for analyze/parse.ts. Run from the repo root:  npx tsx --test analyze/parse.test.ts
 * Uses only node:test and node:assert, so no extra dependencies.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AnalysisResultSchema,
  FlagSchema,
  IngestResultSchema,
  type Clause,
} from "../packages/shared/schemas";
import {
  extractJson,
  limitGreenFlags,
  normalizeCategory,
  normalizeRisk,
  parseFlags,
  resolveQuote,
} from "./parse";

const clauses: Clause[] = [
  {
    id: "c1",
    index: 0,
    heading: "Security Deposit",
    text:
      "Security Deposit. The Tenant shall pay a security deposit of Rs. 60,000 at signing. The " +
      "Landlord may deduct from the deposit any amounts for damages, cleaning, repainting and " +
      "other charges as the Landlord deems necessary, and the balance will be refunded within a " +
      "reasonable time after the Tenant vacates.",
  },
  {
    id: "c2",
    index: 1,
    heading: "Termination",
    // Typographic apostrophes, a line break and a double space, as real PDF text often has.
    text:
      "Termination. The Tenant shall give three (3) months\u2019 written notice to terminate this " +
      "Agreement.\n  The Landlord may terminate this Agreement at any time by giving fifteen " +
      "(15) days\u2019 notice.",
  },
];

const DEPOSIT_QUOTE =
  "any amounts for damages, cleaning, repainting and other charges as the Landlord deems necessary";

const good = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  clauseId: "c1",
  category: "deposit",
  riskLevel: "red",
  quote: DEPOSIT_QUOTE,
  explanation: "The landlord decides what to deduct.",
  whyItMatters: "This may matter, and is worth asking about.",
  questionsToAsk: ["Can the deductions be listed?"],
  ...overrides,
});

const reply = (items: unknown[]): string => JSON.stringify({ flags: items });

describe("extractJson", () => {
  it("reads JSON wrapped in a ```json fence", () => {
    const raw = '```json\n{"flags": [{"clauseId": "c1"}]}\n```';
    assert.deepEqual(extractJson(raw), { flags: [{ clauseId: "c1" }] });
  });

  it("reads a fence without a language tag and ignores text around it", () => {
    const raw = 'Here is the result:\n```\n{"flags": []}\n```\nHope that helps!';
    assert.deepEqual(extractJson(raw), { flags: [] });
  });

  it("reads bare JSON surrounded by commentary", () => {
    const raw = 'Sure! {"flags": []} Let me know if you need more.';
    assert.deepEqual(extractJson(raw), { flags: [] });
  });

  it("keeps a bare array as an array", () => {
    assert.deepEqual(extractJson('Result: [{"a": 1}]'), [{ a: 1 }]);
  });

  it("throws a generic error that does not echo the text", () => {
    const secret = "CONFIDENTIAL RENT TERMS 12345";
    assert.throws(
      () => extractJson(secret),
      (error: unknown) =>
        error instanceof Error && !error.message.includes(secret) && /valid JSON/.test(error.message),
    );
  });
});

describe("normalizeCategory and normalizeRisk", () => {
  it("normalises category spelling", () => {
    assert.equal(normalizeCategory("Rent Escalation"), "rent_escalation");
    assert.equal(normalizeCategory("notice-period"), "notice_period");
    assert.equal(normalizeCategory("DEPOSIT"), "deposit");
  });

  it("maps an unknown or non-string category to other", () => {
    assert.equal(normalizeCategory("banana"), "other");
    assert.equal(normalizeCategory(42), "other");
  });

  it("maps risk synonyms and rejects unknown values", () => {
    assert.equal(normalizeRisk("RED"), "red");
    assert.equal(normalizeRisk("High"), "red");
    assert.equal(normalizeRisk("medium"), "amber");
    assert.equal(normalizeRisk("low"), "green");
    assert.equal(normalizeRisk("banana"), undefined);
    assert.equal(normalizeRisk("constructor"), undefined);
    assert.equal(normalizeRisk(undefined), undefined);
  });
});

describe("resolveQuote", () => {
  it("returns undefined for an empty or whitespace-only quote", () => {
    assert.equal(resolveQuote("   ", clauses[0]?.text ?? ""), undefined);
  });

  it("returns undefined when the quote is not in the clause", () => {
    assert.equal(resolveQuote("the landlord may enter at any time", clauses[0]?.text ?? ""), undefined);
  });
});

describe("parseFlags", () => {
  it("accepts a valid flag, sets defaults and passes FlagSchema", () => {
    const { flags, dropped } = parseFlags(reply([good()]), clauses, "en");
    assert.equal(dropped.length, 0);
    assert.equal(flags.length, 1);
    const flag = flags[0];
    assert.ok(flag);
    assert.deepEqual(FlagSchema.parse(flag), flag);
    assert.deepEqual(flag.citations, []);
    assert.equal(flag.quoteVerified, false);
    assert.equal(flag.grounding, "unverified");
    assert.equal(flag.quote, DEPOSIT_QUOTE);
  });

  it("parses a fenced reply end to end", () => {
    const raw = "```json\n" + reply([good()]) + "\n```";
    assert.equal(parseFlags(raw, clauses, "en").flags.length, 1);
  });

  it("accepts a bare array of flags", () => {
    assert.equal(parseFlags(JSON.stringify([good()]), clauses, "en").flags.length, 1);
  });

  it("injects language from the request and ignores the LLM's value", () => {
    const { flags } = parseFlags(reply([good({ language: "hi" })]), clauses, "ta");
    assert.equal(flags[0]?.language, "ta");
  });

  it("ignores citations, quoteVerified and grounding sent by the LLM", () => {
    const sneaky = good({
      citations: [{ sourceId: "fake", title: "Fake Act", snippet: "x" }],
      quoteVerified: true,
      grounding: "supported",
    });
    const flag = parseFlags(reply([sneaky]), clauses, "en").flags[0];
    assert.deepEqual(flag?.citations, []);
    assert.equal(flag?.quoteVerified, false);
    assert.equal(flag?.grounding, "unverified");
  });

  it("normalises bad enums and drops a flag with an unknown risk level", () => {
    const raw = reply([
      good({ category: "Rent Escalation", riskLevel: "HIGH" }),
      good({ category: "banana", riskLevel: "medium" }),
      good({ riskLevel: "banana" }),
    ]);
    const { flags, dropped } = parseFlags(raw, clauses, "en");
    assert.deepEqual(
      flags.map((f) => [f.category, f.riskLevel]),
      [
        ["rent_escalation", "red"],
        ["other", "amber"],
      ],
    );
    assert.deepEqual(dropped, [{ index: 2, reason: "bad_risk_level" }]);
  });

  it("drops invalid flags and keeps the valid ones", () => {
    const raw = reply([
      good(),
      null,
      "just a string",
      good({ clauseId: "c99" }),
      { ...good(), explanation: undefined },
      good({ whyItMatters: "   " }),
      good({ quote: 123 }),
    ]);
    const { flags, dropped } = parseFlags(raw, clauses, "en");
    assert.equal(flags.length, 1);
    assert.deepEqual(dropped, [
      { index: 1, reason: "not_an_object" },
      { index: 2, reason: "not_an_object" },
      { index: 3, reason: "unknown_clause" },
      { index: 4, reason: "invalid_shape" },
      { index: 5, reason: "invalid_shape" },
      { index: 6, reason: "invalid_shape" },
    ]);
  });
});


describe("parseFlags: quote handling", () => {
  it("drops a flag whose quote is not in the clause", () => {
    const raw = reply([
      good({ quote: "The Landlord may enter the premises at any hour without notice" }),
      good({ quote: "" }),
    ]);
    const { flags, dropped } = parseFlags(raw, clauses, "en");
    assert.equal(flags.length, 0);
    assert.deepEqual(dropped, [
      { index: 0, reason: "quote_not_found" },
      { index: 1, reason: "quote_not_found" },
    ]);
  });

  it("does not match a quote against a different clause", () => {
    const { flags, dropped } = parseFlags(reply([good({ clauseId: "c2" })]), clauses, "en");
    assert.equal(flags.length, 0);
    assert.deepEqual(dropped, [{ index: 0, reason: "quote_not_found" }]);
  });

  it("replaces the quote with the exact original substring (case, apostrophes)", () => {
    const llmQuote =
      "THE LANDLORD MAY TERMINATE this agreement at any time by giving fifteen (15) days' notice.";
    const { flags } = parseFlags(reply([good({ clauseId: "c2", quote: llmQuote })]), clauses, "en");
    const exact =
      "The Landlord may terminate this Agreement at any time by giving fifteen (15) days\u2019 notice.";
    assert.equal(flags[0]?.quote, exact);
    assert.ok(clauses[1]?.text.includes(flags[0]?.quote ?? "\u0000"));
  });

  it("replaces the quote with the exact original substring (whitespace)", () => {
    const llmQuote = "notice to terminate this Agreement. The Landlord may terminate";
    const { flags } = parseFlags(reply([good({ clauseId: "c2", quote: llmQuote })]), clauses, "en");
    // The clause has a line break and two spaces between the sentences.
    assert.equal(flags[0]?.quote, "notice to terminate this Agreement.\n  The Landlord may terminate");
    assert.ok(clauses[1]?.text.includes(flags[0]?.quote ?? "\u0000"));
  });

  it("trims whitespace around the quote and keeps an already-exact quote unchanged", () => {
    const { flags } = parseFlags(reply([good({ quote: `  ${DEPOSIT_QUOTE}  ` })]), clauses, "en");
    assert.equal(flags[0]?.quote, DEPOSIT_QUOTE);
  });
});

describe("parseFlags: other fields", () => {
  it("omits an empty suggestion and keeps a real one", () => {
    const raw = reply([good({ suggestion: "  " }), good({ suggestion: "Ask for a refund deadline." })]);
    const { flags } = parseFlags(raw, clauses, "en");
    assert.equal(flags[0]?.suggestion, undefined);
    assert.equal(flags[1]?.suggestion, "Ask for a refund deadline.");
  });

  it("coerces questionsToAsk (string, mixed array, missing)", () => {
    const raw = reply([
      good({ questionsToAsk: "One question?" }),
      good({ questionsToAsk: ["A?", 7, "  ", "B?"] }),
      good({ questionsToAsk: undefined }),
    ]);
    const { flags } = parseFlags(raw, clauses, "en");
    assert.deepEqual(
      flags.map((f) => f.questionsToAsk),
      [["One question?"], ["A?", "B?"], []],
    );
  });

  it("returns no flags for an empty list", () => {
    assert.deepEqual(parseFlags('{"flags": []}', clauses, "en"), { flags: [], dropped: [] });
  });

  it("throws when the reply is not JSON or has no flags list", () => {
    assert.throws(() => parseFlags("I cannot help with that.", clauses, "en"), /valid JSON/);
    assert.throws(() => parseFlags('{"result": "ok"}', clauses, "en"), /flags list/);
  });

  it("round-trips the shared mock so validate-mocks still passes", () => {
    const mocks = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "shared", "mocks");
    const load = (name: string): unknown => JSON.parse(readFileSync(join(mocks, name), "utf8"));
    const ingest = IngestResultSchema.parse(load("ingest.json"));
    const analysis = AnalysisResultSchema.parse(load("analysis.json"));

    const { flags, dropped } = parseFlags(JSON.stringify({ flags: analysis.flags }), ingest.clauses, "en");

    assert.deepEqual(dropped, []);
    assert.deepEqual(flags, analysis.flags);
    const textById = new Map(ingest.clauses.map((c) => [c.id, c.text]));
    for (const flag of flags) {
      assert.ok(textById.get(flag.clauseId)?.includes(flag.quote));
    }
  });
});

describe("limitGreenFlags", () => {
  const make = (id: string, riskLevel: "red" | "amber" | "green") =>
    FlagSchema.parse({
      clauseId: id,
      category: "other",
      riskLevel,
      quote: "q",
      explanation: "e",
      whyItMatters: "w",
      questionsToAsk: [],
      language: "en",
    });
  const ids = (flags: { clauseId: string }[]) => flags.map((f) => f.clauseId);

  const mixed = [
    make("a", "green"),
    make("b", "red"),
    make("c", "green"),
    make("d", "green"),
    make("e", "amber"),
    make("f", "green"),
    make("g", "green"),
  ];

  it("keeps the first 3 green flags in order and removes the rest", () => {
    const result = limitGreenFlags(mixed, 3);
    assert.deepEqual(ids(result.flags), ["a", "b", "c", "d", "e"]);
    assert.equal(result.removedGreen, 2);
  });

  it("never removes red or amber flags", () => {
    const result = limitGreenFlags(mixed, 0);
    assert.deepEqual(ids(result.flags), ["b", "e"]);
    assert.equal(result.removedGreen, 5);
  });

  it("changes nothing when the cap is not exceeded", () => {
    const result = limitGreenFlags(mixed, 10);
    assert.deepEqual(ids(result.flags), ids(mixed));
    assert.equal(result.removedGreen, 0);
  });

  it("treats a negative or non-finite cap as zero and does not mutate its input", () => {
    const copy = [...mixed];
    assert.equal(limitGreenFlags(mixed, -1).removedGreen, 5);
    assert.equal(limitGreenFlags(mixed, Number.NaN).removedGreen, 5);
    assert.deepEqual(mixed, copy);
  });
});

