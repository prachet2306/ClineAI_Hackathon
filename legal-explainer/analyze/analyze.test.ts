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

