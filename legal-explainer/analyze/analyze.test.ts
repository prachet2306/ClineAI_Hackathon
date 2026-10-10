/**
 * Tests for analyze/analyze.ts. Run from the repo root:  npx tsx --test analyze/analyze.test.ts
 * callLlm is mocked everywhere, so these tests never touch the network or the SDK.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AnalysisResultSchema, type AnalyzeRequest, type Clause } from "../packages/shared/schemas";
import {
  ANALYZE_CONCURRENCY,
  AnalyzeError,
  GREEN_ALLOWED_CATEGORIES,
  analyze as realAnalyze,
  createAnalyze,
  type AnalyzeDeps,
} from "./analyze";
import { LlmError } from "./llm";
import { MAX_GREEN_FLAGS_PER_DOCUMENT } from "./prompt";
import { STUB_ENV_NAME } from "./stub";

const SECRET_TEXT = "CONFIDENTIAL CLAUSE TEXT 98765";

const makeClause = (n: number, extra = ""): Clause => ({
  id: `c${n}`,
  index: n - 1,
  heading: `Heading ${n}`,
  text: `Clause ${n}. The Tenant shall do thing number ${n}. ${extra}`.trim(),
});

const clauses = (count: number): Clause[] => Array.from({ length: count }, (_, i) => makeClause(i + 1));

const request = (count: number, overrides: Partial<AnalyzeRequest> = {}): AnalyzeRequest => ({
  documentId: "doc-1",
  docType: "rental",
  clauses: clauses(count),
  language: "en",
  ...overrides,
});

interface LlmFlag {
  clauseId: string;
  category?: string;
  riskLevel?: string;
  quote?: string;
}

/** A JSON reply the real parseFlags accepts. The quote defaults to a real part of the clause. */
const reply = (items: LlmFlag[]): string =>
  JSON.stringify({
    flags: items.map((item) => ({
      category: "other",
      riskLevel: "amber",
      quote: `The Tenant shall do thing number ${item.clauseId.slice(1)}`,
      explanation: "This may matter.",
      whyItMatters: "Worth asking about.",
      questionsToAsk: ["Can this be clarified?"],
      ...item,
    })),
  });

/** Pulls the clause ids out of a prompt, so a fake LLM can answer for exactly that batch. */
const idsInPrompt = (user: string): string[] =>
  [...user.matchAll(/<<<CLAUSE id=(\S+?)>>>/g)].map((match) => match[1] ?? "");

type CallLlm = AnalyzeDeps["callLlm"];

function setup(callLlm: CallLlm, overrides: Partial<AnalyzeDeps> = {}) {
  const logs: string[] = [];
  const calls: { system: string; user: string }[] = [];
  const analyze = createAnalyze({
    callLlm: (system, user) => {
      calls.push({ system, user });
      return callLlm(system, user);
    },
    env: {},
    log: (message) => logs.push(message),
    ...overrides,
  });
  return { analyze, logs, calls };
}

const fixed = (items: LlmFlag[]): CallLlm => async () => reply(items);

describe("analyze: happy path", () => {
  it("returns a valid AnalysisResult with language and documentId from the request", async () => {
    const { analyze } = setup(fixed([{ clauseId: "c1", category: "deposit", riskLevel: "red" }]));
    const result = await analyze(request(3, { language: "hi" }));
    assert.deepEqual(AnalysisResultSchema.parse(result), result);
    assert.equal(result.documentId, "doc-1");
    assert.equal(result.language, "hi");
    assert.equal(result.flags.length, 1);
    assert.equal(result.flags[0]?.clauseId, "c1");
    assert.equal(result.flags[0]?.language, "hi");
  });

  it("leaves citations, quoteVerified and grounding at the defaults for M3", async () => {
    const { analyze } = setup(fixed([{ clauseId: "c1" }]));
    const flag = (await analyze(request(2))).flags[0];
    assert.deepEqual(flag?.citations, []);
    assert.equal(flag?.quoteVerified, false);
    assert.equal(flag?.grounding, "unverified");
  });

  it("puts only exact substrings of the clause text in quote", async () => {
    const { analyze } = setup(fixed([{ clauseId: "c2", quote: "THE TENANT SHALL DO THING NUMBER 2" }]));
    const input = request(3);
    const flag = (await analyze(input)).flags[0];
    const clause = input.clauses.find((c) => c.id === flag?.clauseId);
    assert.ok(clause?.text.includes(flag?.quote ?? "\u0000"));
  });

  it("asks the LLM once for a short document and puts every clause in the prompt", async () => {
    const { analyze, calls } = setup(fixed([]));
    await analyze(request(4));
    assert.equal(calls.length, 1);
    assert.deepEqual(idsInPrompt(calls[0]?.user ?? ""), ["c1", "c2", "c3", "c4"]);
  });

  it("rejects an invalid request with a safe BAD_INPUT-style error and no LLM call", async () => {
    const { analyze, calls } = setup(fixed([]));
    const bad = { ...request(2), documentId: "", language: SECRET_TEXT } as unknown as AnalyzeRequest;
    await assert.rejects(analyze(bad), (error: unknown) => {
      assert.ok(error instanceof AnalyzeError);
      assert.equal(error.code, "bad_input");
      assert.ok(!error.message.includes(SECRET_TEXT));
      return true;
    });
    assert.equal(calls.length, 0);
  });
});

describe("analyze: empty flags", () => {
  it("treats an empty flags list from a valid reply as success, with no retry", async () => {
    const { analyze, calls } = setup(fixed([]));
    const result = await analyze(request(3));
    assert.deepEqual(result.flags, []);
    assert.equal(calls.length, 1);
  });
});

describe("analyze: retry once", () => {
  it("retries a batch after an LLM error and then succeeds", async () => {
    let n = 0;
    const { analyze, calls, logs } = setup(async () => {
      n += 1;
      if (n === 1) throw new LlmError("failed", "LLM request failed");
      return reply([{ clauseId: "c1" }]);
    });
    const result = await analyze(request(2));
    assert.equal(calls.length, 2);
    assert.equal(result.flags.length, 1);
    assert.ok(logs.some((line) => line.includes("(retrying)")));
  });

  it("retries after a timeout", async () => {
    let n = 0;
    const { analyze, calls } = setup(async () => {
      n += 1;
      if (n === 1) throw new LlmError("timeout", "LLM request timed out");
      return reply([]);
    });
    await analyze(request(2));
    assert.equal(calls.length, 2);
  });

  it("retries after a reply that cannot be parsed", async () => {
    let n = 0;
    const { analyze, calls } = setup(async () => {
      n += 1;
      return n === 1 ? "Sorry, I cannot help with that." : reply([{ clauseId: "c1" }]);
    });
    const result = await analyze(request(2));
    assert.equal(calls.length, 2);
    assert.equal(result.flags.length, 1);
  });

  it("throws after the retry also fails, with a short generic error", async () => {
    const { analyze, calls } = setup(async () => {
      throw new LlmError("failed", `bad: ${SECRET_TEXT}`);
    });
    await assert.rejects(analyze(request(2)), (error: unknown) => {
      assert.ok(error instanceof AnalyzeError);
      assert.equal(error.code, "llm_failed");
      assert.ok(!error.message.includes(SECRET_TEXT));
      return true;
    });
    assert.equal(calls.length, 2, "exactly one retry, no more");
  });

  it("throws when both replies are unusable", async () => {
    const { analyze, calls } = setup(async () => "not json at all");
    await assert.rejects(analyze(request(2)), (error: unknown) => error instanceof AnalyzeError);
    assert.equal(calls.length, 2);
  });

  it("does not retry a missing-configuration error", async () => {
    const { analyze, calls } = setup(async () => {
      throw new LlmError("not_configured", "Missing environment variable: CLINE_API_KEY");
    });
    await assert.rejects(analyze(request(2)), (error: unknown) => {
      assert.ok(error instanceof LlmError);
      assert.equal(error.code, "not_configured");
      return true;
    });
    assert.equal(calls.length, 1);
  });
});

describe("analyze: green flags", () => {
  it("only allows green for deposit, notice_period and termination", () => {
    assert.deepEqual([...GREEN_ALLOWED_CATEGORIES].sort(), ["deposit", "notice_period", "termination"]);
  });

  it("drops green flags in other categories without changing their risk level", async () => {
    const { analyze } = setup(
      fixed([
        { clauseId: "c1", category: "deposit", riskLevel: "green" },
        { clauseId: "c2", category: "maintenance", riskLevel: "green" },
        { clauseId: "c3", category: "rent", riskLevel: "green" },
        { clauseId: "c4", category: "termination", riskLevel: "green" },
        { clauseId: "c5", category: "notice_period", riskLevel: "green" },
        { clauseId: "c6", category: "maintenance", riskLevel: "amber" },
        { clauseId: "c7", category: "rent", riskLevel: "red" },
      ]),
      { concurrency: 1 },
    );
    const flags = (await analyze(request(7))).flags;
    assert.deepEqual(
      flags.map((f) => [f.clauseId, f.category, f.riskLevel]),
      [
        ["c1", "deposit", "green"],
        ["c4", "termination", "green"],
        ["c5", "notice_period", "green"],
        ["c6", "maintenance", "amber"],
        ["c7", "rent", "red"],
      ],
    );
  });

  it("caps green flags across batches at the document limit, in clause order", async () => {
    const total = 6;
    const { analyze, calls } = setup(
      async (_system, user) =>
        reply(idsInPrompt(user).map((id) => ({ clauseId: id, category: "deposit", riskLevel: "green" }))),
      { maxChunkChars: 150, concurrency: 3 },
    );
    const result = await analyze(request(total));
    assert.ok(calls.length > 1, "the document must be split into several batches");
    assert.equal(MAX_GREEN_FLAGS_PER_DOCUMENT, 3);
    assert.deepEqual(
      result.flags.map((f) => f.clauseId),
      ["c1", "c2", "c3"],
      "the first three green flags in clause order are kept",
    );
  });

  it("never caps red or amber flags", async () => {
    const { analyze } = setup(
      async (_system, user) =>
        reply(idsInPrompt(user).map((id) => ({ clauseId: id, category: "rent", riskLevel: "red" }))),
      { maxChunkChars: 150 },
    );
    assert.equal((await analyze(request(6))).flags.length, 6);
  });

  it("tells every batch it may use the full green allowance", async () => {
    const { analyze, calls } = setup(fixed([]), { maxChunkChars: 150 });
    await analyze(request(6));
    assert.ok(calls.length > 1);
    for (const call of calls) assert.match(call.system, /at most 3 green flags in this reply/);
  });
});


describe("analyze: clause order", () => {
  it("sorts flags by clause order even when batches finish out of order", async () => {
    const delays: Record<string, number> = { c1: 60, c3: 30, c5: 0 };
    const { analyze } = setup(
      async (_system, user) => {
        const ids = idsInPrompt(user);
        await new Promise((resolve) => setTimeout(resolve, delays[ids[0] ?? ""] ?? 0));
        return reply(ids.map((id) => ({ clauseId: id })));
      },
      { maxChunkChars: 150, concurrency: 3 },
    );
    const result = await analyze(request(6));
    assert.deepEqual(
      result.flags.map((f) => f.clauseId),
      ["c1", "c2", "c3", "c4", "c5", "c6"],
    );
  });

  it("keeps the LLM's order for two flags on the same clause", async () => {
    const { analyze } = setup(
      fixed([
        { clauseId: "c2", category: "fees" },
        { clauseId: "c1", category: "rent" },
        { clauseId: "c2", category: "penalties" },
      ]),
    );
    const flags = (await analyze(request(3))).flags;
    assert.deepEqual(
      flags.map((f) => [f.clauseId, f.category]),
      [
        ["c1", "rent"],
        ["c2", "fees"],
        ["c2", "penalties"],
      ],
    );
  });
});

describe("analyze: concurrency limit", () => {
  const measure = async (concurrency: number | undefined) => {
    let running = 0;
    let peak = 0;
    const overrides: Partial<AnalyzeDeps> = { maxChunkChars: 120 };
    if (concurrency !== undefined) overrides.concurrency = concurrency;
    const { analyze, calls } = setup(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
      return reply([]);
    }, overrides);
    await analyze(request(12));
    return { peak, batches: calls.length };
  };

  it("never runs more batches at once than the limit, and uses the whole limit", async () => {
    const { peak, batches } = await measure(2);
    assert.ok(batches >= 6, `needs many batches for this test, got ${batches}`);
    assert.equal(peak, 2);
  });

  it("runs batches one at a time when the limit is 1", async () => {
    assert.equal((await measure(1)).peak, 1);
  });

  it("defaults to the named constant (3)", async () => {
    assert.equal(ANALYZE_CONCURRENCY, 3);
    assert.equal((await measure(undefined)).peak, 3);
  });

  it("stops starting new batches after one fails for good", async () => {
    const { analyze, calls } = setup(
      async () => {
        throw new LlmError("failed", "LLM request failed");
      },
      { maxChunkChars: 120, concurrency: 1 },
    );
    await assert.rejects(analyze(request(12)), (error: unknown) => error instanceof AnalyzeError);
    assert.equal(calls.length, 2, "first batch, its one retry, and then nothing else");
  });
});


describe("analyze: stub switch", () => {
  const loadStub = () => AnalysisResultSchema.parse({ documentId: "stub-doc", language: "en", flags: [] });

  it("is OFF by default: the real path runs and the stub is not loaded", async () => {
    let stubLoaded = 0;
    const { analyze, calls } = setup(fixed([]), {
      loadStub: () => {
        stubLoaded += 1;
        return loadStub();
      },
    });
    const result = await analyze(request(2));
    assert.equal(stubLoaded, 0);
    assert.equal(calls.length, 1);
    assert.equal(result.documentId, "doc-1");
  });

  it("returns the stub only when ANALYZE_USE_STUB is exactly 1, without calling the LLM", async () => {
    const { analyze, calls } = setup(fixed([]), { env: { [STUB_ENV_NAME]: "1" }, loadStub });
    assert.equal((await analyze(request(2))).documentId, "stub-doc");
    assert.equal(calls.length, 0);
  });

  it("ignores other values such as 0, true, yes and empty", async () => {
    for (const value of ["0", "true", "yes", ""]) {
      const { analyze, calls } = setup(fixed([]), { env: { [STUB_ENV_NAME]: value }, loadStub });
      const result = await analyze(request(2));
      assert.equal(result.documentId, "doc-1", `value "${value}" must not enable the stub`);
      assert.equal(calls.length, 1);
    }
  });

  it("the real stub reads analysis.json with fs and passes the schema", async () => {
    const analyze = createAnalyze({ env: { [STUB_ENV_NAME]: "1" }, log: () => {} });
    const result = await analyze(request(1));
    assert.deepEqual(AnalysisResultSchema.parse(result), result);
    assert.equal(result.documentId, "doc-mock-001");
    assert.equal(result.flags.length, 3);
  });

  it("the exported analyze is off by default (no stub variable set)", () => {
    assert.equal(process.env[STUB_ENV_NAME], undefined);
    assert.equal(typeof realAnalyze, "function");
  });
});

describe("analyze: final schema validation", () => {
  it("rejects a result that would not pass AnalysisResultSchema (empty quote)", async () => {
    const broken = createAnalyze({
      callLlm: async () => "{}",
      parseFlags: () => ({
        flags: [
          {
            clauseId: "c1",
            category: "other",
            riskLevel: "red",
            quote: "",
            explanation: "e",
            whyItMatters: "w",
            questionsToAsk: [],
            language: "en",
            citations: [],
            quoteVerified: false,
            grounding: "unverified",
          },
        ],
        dropped: [],
      }),
      env: {},
      log: () => {},
    });
    await assert.rejects(broken(request(1)));
  });

  it("every returned flag has a quote that is an exact substring of its clause", async () => {
    const { analyze } = setup(
      async (_system, user) =>
        reply(
          idsInPrompt(user).map((id) => ({
            clauseId: id,
            quote: `THE TENANT SHALL DO THING NUMBER ${id.slice(1)}`,
          })),
        ),
      { maxChunkChars: 150 },
    );
    const input = request(6);
    const result = await analyze(input);
    assert.equal(result.flags.length, 6);
    for (const flag of result.flags) {
      assert.ok(input.clauses.find((c) => c.id === flag.clauseId)?.text.includes(flag.quote));
    }
  });
});

describe("analyze: logging", () => {
  it("logs only counts and codes, never clause text, prompts or error text", async () => {
    let n = 0;
    const { analyze, logs } = setup(async () => {
      n += 1;
      if (n === 1) throw new LlmError("failed", `secret: ${SECRET_TEXT}`);
      return reply([{ clauseId: "c1", category: "deposit", riskLevel: "green" }]);
    });
    await analyze({ ...request(2), clauses: [makeClause(1, SECRET_TEXT), makeClause(2)] });
    assert.ok(logs.length >= 3);
    const joined = logs.join("\n");
    for (const forbidden of [SECRET_TEXT, "Clause 1.", "Tenant shall", "SECURITY RULES", "worth asking"]) {
      assert.ok(!joined.includes(forbidden), `log must not contain: ${forbidden}`);
    }
    assert.match(joined, /code=failed/);
  });
});


/* ------------------------------------------------------------------------------------------ */
/* Strict quote-back: M3 checks flag.quote with a plain String.includes (no normalisation).    */
/* ------------------------------------------------------------------------------------------ */

const CURLY_APOS = "\u2019";
const LEFT_DQ = "\u201C";
const RIGHT_DQ = "\u201D";
const hasDevanagari = (text: string): boolean => /[\u0900-\u097F]/.test(text);

/** The exact check M3 will run on every flag: a plain substring test, nothing normalised. */
function assertStrictQuotes(
  flags: readonly { clauseId: string; quote: string }[],
  source: readonly Clause[],
): void {
  for (const flag of flags) {
    const clause = source.find((c) => c.id === flag.clauseId);
    assert.ok(clause, `flag points at an unknown clause ${flag.clauseId}`);
    assert.ok(flag.quote.length > 0, `empty quote on ${flag.clauseId}`);
    assert.equal(
      clause.text.includes(flag.quote),
      true,
      `quote on ${flag.clauseId} is not a strict substring of its clause`,
    );
  }
}

interface QuoteCase {
  label: string;
  clauseText: string;
  /** What the mocked model says. It is NOT a strict substring of clauseText. */
  llmQuote: string;
  /** The exact original text analyze() must return. */
  expected: string;
}

const QUOTE_CASES: QuoteCase[] = [
  {
    label: "different case",
    clauseText:
      "Security Deposit. The Landlord may deduct any amounts for damages and other charges as the Landlord deems necessary from the deposit.",
    llmQuote: "AS THE LANDLORD DEEMS NECESSARY",
    expected: "as the Landlord deems necessary",
  },
  {
    label: "extra spaces in the quote",
    clauseText: "Termination. The Tenant shall give three (3) months written notice to terminate this Agreement.",
    llmQuote: "The   Tenant shall   give three (3)  months written notice",
    expected: "The Tenant shall give three (3) months written notice",
  },
  {
    label: "a line break in the clause, a space in the quote",
    clauseText: "Rent Revision. The monthly rent shall increase\nby 15% every year on the anniversary of this Agreement.",
    llmQuote: "The monthly rent shall increase by 15% every year",
    expected: "The monthly rent shall increase\nby 15% every year",
  },
  {
    label: "line breaks in the quote, spaces in the clause",
    clauseText: "Notice. The Landlord may terminate this Agreement at any time by giving fifteen (15) days notice.",
    llmQuote: "terminate this Agreement\nat any time by giving\nfifteen (15) days notice",
    expected: "terminate this Agreement at any time by giving fifteen (15) days notice",
  },
  {
    label: "curly apostrophe in the clause, straight in the quote",
    clauseText: `Notice. The Tenant shall give three (3) months${CURLY_APOS} written notice.`,
    llmQuote: "three (3) months' written notice",
    expected: `three (3) months${CURLY_APOS} written notice`,
  },
  {
    label: "straight apostrophe in the clause, curly in the quote",
    clauseText: "Repairs. The Tenant shall pay for the Tenant's own repairs up to Rs. 1,000.",
    llmQuote: `the Tenant${CURLY_APOS}s own repairs`,
    expected: "the Tenant's own repairs",
  },
  {
    label: "curly double quotes in the clause, straight in the quote",
    clauseText: `Notice. The notice must be ${LEFT_DQ}written${RIGHT_DQ} and signed by both parties.`,
    llmQuote: 'be "written" and signed',
    expected: `be ${LEFT_DQ}written${RIGHT_DQ} and signed`,
  },
  {
    label: "case, spaces, a line break and an apostrophe all at once",
    clauseText: `Entry.  The Landlord${CURLY_APOS}s agents may enter\nthe premises at any time.`,
    llmQuote: "THE LANDLORD'S AGENTS MAY   ENTER THE PREMISES",
    expected: `The Landlord${CURLY_APOS}s agents may enter\nthe premises`,
  },
];


const caseClauses: Clause[] = QUOTE_CASES.map((c, i) => ({
  id: `c${i + 1}`,
  index: i,
  heading: `Case ${i + 1}`,
  text: c.clauseText,
}));
const caseFor = (id: string): QuoteCase | undefined => QUOTE_CASES[Number(id.slice(1)) - 1];

describe("analyze: strict quote-back after repair (case, spaces, line breaks, apostrophes)", () => {
  const answerAll = async (_system: string, user: string): Promise<string> =>
    reply(idsInPrompt(user).map((id) => ({ clauseId: id, quote: caseFor(id)?.llmQuote ?? "" })));

  it("precondition: every mocked model quote fails the strict check before analyze()", () => {
    for (const c of QUOTE_CASES) {
      assert.equal(c.clauseText.includes(c.llmQuote), false, `${c.label}: the model quote must not already match`);
    }
  });

  it("returns every flag with a quote that is a strict substring of its clause", async () => {
    const { analyze } = setup(answerAll);
    const input = request(0, { clauses: caseClauses });
    const result = await analyze(input);
    assert.equal(result.flags.length, QUOTE_CASES.length, "no flag may be lost");
    assertStrictQuotes(result.flags, input.clauses);
    for (const flag of result.flags) {
      const expected = caseFor(flag.clauseId);
      assert.equal(flag.quote, expected?.expected, expected?.label);
      assert.notEqual(flag.quote, expected?.llmQuote, "the model's own quote must have been replaced");
    }
  });

  it("holds when the document is split into several batches run in parallel", async () => {
    const { analyze, calls } = setup(answerAll, { maxChunkChars: 120, concurrency: 3 });
    const input = request(0, { clauses: caseClauses });
    const result = await analyze(input);
    assert.ok(calls.length > 1, "the document must be split into several batches");
    assert.equal(result.flags.length, QUOTE_CASES.length);
    assertStrictQuotes(result.flags, input.clauses);
  });

  it("returns an already exact quote unchanged", async () => {
    const exact = QUOTE_CASES.map((c) => c.expected);
    const { analyze } = setup(async (_s, user) =>
      reply(idsInPrompt(user).map((id) => ({ clauseId: id, quote: exact[Number(id.slice(1)) - 1] ?? "" }))),
    );
    const input = request(0, { clauses: caseClauses });
    const result = await analyze(input);
    assert.deepEqual(result.flags.map((f) => f.quote), exact);
    assertStrictQuotes(result.flags, input.clauses);
  });
});

describe("analyze: a quote that does not match is dropped, never returned", () => {
  const clause: Clause = {
    id: "c1",
    index: 0,
    heading: "Security Deposit",
    text: "Security Deposit. The Landlord may deduct any amounts the Landlord deems necessary from the deposit.",
  };
  const other: Clause = { id: "c2", index: 1, text: "Term. This Agreement lasts eleven (11) months." };
  const input = (): AnalyzeRequest => request(0, { clauses: [clause, other] });

  const bad: [string, string][] = [
    ["words that are not in the clause", "The Landlord must refund the deposit within 7 days"],
    ["a paraphrase of the clause", "The landlord can take money out of the deposit freely"],
    ["a real phrase from a different clause", "This Agreement lasts eleven (11) months"],
    ["a quote with one wrong word", "The Landlord may deduct any sums the Landlord deems necessary"],
    ["an empty quote", ""],
    ["a whitespace-only quote", "   \n  "],
  ];

  for (const [label, quote] of bad) {
    it(`drops the flag when the quote is ${label}`, async () => {
      const { analyze } = setup(fixed([{ clauseId: "c1", quote }]));
      const result = await analyze(input());
      assert.deepEqual(result.flags, [], "a flag with a bad quote must never be returned");
    });
  }

  it("keeps the good flags and drops only the bad one, and does not retry", async () => {
    const { analyze, calls } = setup(
      fixed([
        { clauseId: "c1", quote: "any amounts the Landlord deems necessary" },
        { clauseId: "c1", quote: "a sentence that is not in the clause" },
        { clauseId: "c2", quote: "eleven (11) months" },
      ]),
    );
    const source = input();
    const result = await analyze(source);
    assert.equal(calls.length, 1, "dropping a bad flag is not an error, so there is no retry");
    assert.deepEqual(result.flags.map((f) => f.clauseId), ["c1", "c2"]);
    assertStrictQuotes(result.flags, source.clauses);
  });

  it("logs the drop by count only, never the quote text", async () => {
    const leaky = "a quote naming CONFIDENTIAL CLAUSE TEXT 98765";
    const { analyze, logs } = setup(fixed([{ clauseId: "c1", quote: leaky }]));
    await analyze(input());
    assert.match(logs.join("\n"), /dropped=1 \(quote_not_found:1\)/);
    assert.ok(!logs.join("\n").includes("CONFIDENTIAL"));
  });
});


describe("analyze: Hindi request keeps the quote in the clause's original language", () => {
  const english: Clause = {
    id: "c1",
    index: 0,
    heading: "Security Deposit",
    text: "Security Deposit. The Landlord may deduct any amounts for damages and other charges as the Landlord deems necessary.",
  };
  const hindiClause: Clause = {
    id: "c2",
    index: 1,
    heading: "सुरक्षा जमा",
    text: "सुरक्षा जमा। मकान मालिक नुकसान और अन्य शुल्क के नाम पर जमा राशि से कोई भी रकम काट सकता है।",
  };

  /** A Hindi reply: explanation fields in Devanagari, JSON keys and enums in English. */
  const hindiReply = (items: { clauseId: string; quote: string }[]): string =>
    JSON.stringify({
      flags: items.map((item) => ({
        ...item,
        category: "deposit",
        riskLevel: "red",
        explanation: "मकान मालिक अपनी मर्ज़ी से रकम काट सकता है।",
        whyItMatters: "यह पूछना ज़रूरी हो सकता है।",
        questionsToAsk: ["क्या कटौती की सूची तय हो सकती है?"],
      })),
    });

  it("English contract, language hi: explanation in Hindi, quote still the English original", async () => {
    const source = request(0, { clauses: [english], language: "hi" });
    const { analyze, calls } = setup(async () =>
      hindiReply([{ clauseId: "c1", quote: "AS THE LANDLORD DEEMS NECESSARY" }]),
    );
    const result = await analyze(source);
    assert.match(calls[0]?.system ?? "", /Hindi/);
    assert.equal(result.language, "hi");
    const flag = result.flags[0];
    assert.ok(flag, "the flag must be returned");
    assert.equal(flag.language, "hi");
    assert.equal(hasDevanagari(flag.explanation), true, "explanation is in Hindi");
    assert.equal(hasDevanagari(flag.quote), false, "the quote is not translated");
    assert.equal(flag.quote, "as the Landlord deems necessary");
    assertStrictQuotes(result.flags, source.clauses);
  });

  it("drops a flag whose quote was translated into Hindi, because it is not in the English clause", async () => {
    const source = request(0, { clauses: [english], language: "hi" });
    const { analyze } = setup(async () =>
      hindiReply([{ clauseId: "c1", quote: "जैसा मकान मालिक आवश्यक समझे" }]),
    );
    assert.deepEqual((await analyze(source)).flags, []);
  });

  it("Hindi contract text, language hi: the Devanagari quote passes the strict check", async () => {
    const source = request(0, { clauses: [hindiClause], language: "hi" });
    const quote = "जमा राशि से कोई भी रकम काट सकता है";
    assert.equal(hindiClause.text.includes(quote), true, "precondition: the quote is in the clause");
    const { analyze } = setup(async () => hindiReply([{ clauseId: "c2", quote }]));
    const result = await analyze(source);
    assert.equal(result.flags.length, 1);
    assert.equal(result.flags[0]?.quote, quote);
    assert.equal(hasDevanagari(result.flags[0]?.quote ?? ""), true);
    assertStrictQuotes(result.flags, source.clauses);
  });

  it("Hindi contract: a quote differing only in spacing is repaired to the exact original", async () => {
    const source = request(0, { clauses: [hindiClause], language: "hi" });
    const { analyze } = setup(async () =>
      hindiReply([{ clauseId: "c2", quote: "जमा  राशि से   कोई भी\nरकम काट सकता है" }]),
    );
    const result = await analyze(source);
    assert.equal(result.flags[0]?.quote, "जमा राशि से कोई भी रकम काट सकता है");
    assertStrictQuotes(result.flags, source.clauses);
  });

  it("a mixed document (English and Hindi clauses) keeps every quote in its own clause's language", async () => {
    const source = request(0, { clauses: [english, hindiClause], language: "hi" });
    const { analyze } = setup(async () =>
      hindiReply([
        { clauseId: "c1", quote: "The Landlord may deduct any amounts" },
        { clauseId: "c2", quote: "मकान मालिक नुकसान और अन्य शुल्क" },
      ]),
    );
    const result = await analyze(source);
    assert.deepEqual(result.flags.map((f) => hasDevanagari(f.quote)), [false, true]);
    assertStrictQuotes(result.flags, source.clauses);
  });
});

