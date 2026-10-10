/**
 * Tests for analyze/tool.ts. Run from the repo root:  npx tsx --test analyze/tool.test.ts
 * analyze() is replaced by a fake (or the real analyze() gets a fake callLlm), so these tests
 * never touch the network. Importing tool.ts loads the SDK module, which makes no network call.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { AnalyzeFn } from "../packages/shared/contracts";
import {
  AnalyzeRequestSchema,
  ClauseSchema,
  FlagSchema,
  LANGUAGES,
  type AnalyzeRequest,
  type Flag,
} from "../packages/shared/schemas";
import { AnalyzeError, createAnalyze } from "./analyze";
import { LLM_TIMEOUT_MS, LlmError } from "./llm";
import {
  ANALYZE_CLAUSE_INPUT_JSON_SCHEMA,
  ANALYZE_CLAUSE_TOOL_NAME,
  ANALYZE_TOOL_TIMEOUT_MS,
  AnalyzeClauseInputSchema,
  TOOL_DOCUMENT_ID,
  createAnalyzeClauseTool,
} from "./tool";

const ctx = { agentId: "test-agent", iteration: 1 };
const SECRET = "CONFIDENTIAL CLAUSE TEXT 98765";

const flag = (clauseId: string): Flag =>
  FlagSchema.parse({
    clauseId,
    category: "deposit",
    riskLevel: "red",
    quote: "q",
    explanation: "e",
    whyItMatters: "w",
    questionsToAsk: [],
    language: "en",
  });

/** A tool whose analyze() is a fake that records the request it was given. */
function setup(flags: Flag[] = []) {
  const requests: AnalyzeRequest[] = [];
  const fake: AnalyzeFn = async (req) => {
    requests.push(req);
    return { documentId: req.documentId, language: req.language, flags };
  };
  return { tool: createAnalyzeClauseTool({ analyze: fake }), requests };
}

const validInput = {
  clauseId: "c2",
  text: "Security Deposit. The Landlord may deduct any charges the Landlord deems necessary.",
  heading: "Security Deposit",
  docType: "rental",
  language: "hi",
};

describe("analyze_clause: the request passed to analyze()", () => {
  it("is one clause with the right id, heading, text, docType and language", async () => {
    const { tool, requests } = setup();
    await tool.execute(validInput, ctx);
    assert.equal(requests.length, 1, "analyze() is called exactly once");
    assert.deepEqual(requests[0], {
      documentId: TOOL_DOCUMENT_ID,
      docType: "rental",
      language: "hi",
      clauses: [{ id: "c2", index: 0, heading: "Security Deposit", text: validInput.text }],
    });
    assert.equal(AnalyzeRequestSchema.safeParse(requests[0]).success, true);
  });

  it('uses documentId "tool-call"', () => {
    assert.equal(TOOL_DOCUMENT_ID, "tool-call");
  });

  it("defaults docType to other and language to en", async () => {
    const { tool, requests } = setup();
    await tool.execute({ clauseId: "c1", text: "Some clause text." }, ctx);
    assert.equal(requests[0]?.docType, "other");
    assert.equal(requests[0]?.language, "en");
  });

  it("leaves the heading out when none (or only blanks) is given", async () => {
    const { tool, requests } = setup();
    await tool.execute({ clauseId: "c1", text: "Some clause text." }, ctx);
    await tool.execute({ clauseId: "c1", text: "Some clause text.", heading: "  " }, ctx);
    for (const req of requests) assert.equal("heading" in (req.clauses[0] ?? {}), false);
  });

  it("passes the clause text unchanged, including surrounding whitespace", async () => {
    const { tool, requests } = setup();
    const text = "  Clause text with  two spaces.\n";
    await tool.execute({ clauseId: "c1", text }, ctx);
    assert.equal(requests[0]?.clauses[0]?.text, text);
  });

  it("ignores extra keys the model adds, such as its own documentId", async () => {
    const { tool, requests } = setup();
    await tool.execute({ ...validInput, documentId: "evil", index: 99 }, ctx);
    assert.equal(requests[0]?.documentId, TOOL_DOCUMENT_ID);
    assert.equal(requests[0]?.clauses[0]?.index, 0);
  });
});

describe("analyze_clause: return value", () => {
  it("returns { flags } with exactly the flags analyze() produced", async () => {
    const flags = [flag("c2"), flag("c2")];
    const { tool } = setup(flags);
    const result = await tool.execute(validInput, ctx);
    assert.deepEqual(result, { flags });
    assert.deepEqual(Object.keys(result), ["flags"]);
  });

  it("accepts an empty flags list as a normal result", async () => {
    const { tool } = setup([]);
    assert.deepEqual(await tool.execute(validInput, ctx), { flags: [] });
  });
});

describe("analyze_clause: bad input", () => {
  const bad: [string, unknown, RegExp][] = [
    ["missing text", { clauseId: "c1", heading: SECRET }, /text/],
    ["bad language code", { clauseId: "c1", text: SECRET, language: "xx" }, /language/],
    ["bad docType", { clauseId: "c1", text: SECRET, docType: SECRET }, /docType/],
    ["blank text", { clauseId: "c1", text: "   " }, /text/],
    ["missing clauseId", { text: SECRET }, /clauseId/],
    ["empty clauseId", { clauseId: "", text: SECRET }, /clauseId/],
    ["text is a number", { clauseId: "c1", text: 12345 }, /text/],
    ["input is a string", SECRET, /input/],
    ["input is null", null, /input/],
  ];

  for (const [label, input, names] of bad) {
    it(`${label}: throws a short Error without the clause text, and never calls analyze()`, async () => {
      const { tool, requests } = setup();
      await assert.rejects(async () => tool.execute(input, ctx), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /^Invalid analyze_clause input: /);
        assert.match(error.message, names);
        assert.ok(!error.message.includes(SECRET), "message must not contain clause text");
        assert.ok(error.message.length < 100, "message must stay short");
        return true;
      });
      assert.equal(requests.length, 0);
    });
  }
});

describe("analyze_clause: inputSchema", () => {
  const schema = ANALYZE_CLAUSE_INPUT_JSON_SCHEMA;
  const sent = setup().tool.inputSchema;
  const zodKeys = Object.keys(AnalyzeClauseInputSchema.shape);

  it('is a JSON Schema object with type "object", the expected properties and required fields', () => {
    assert.equal(sent.type, "object");
    const properties = sent.properties as Record<string, unknown>;
    assert.deepEqual(Object.keys(properties).sort(), ["clauseId", "docType", "heading", "language", "text"]);
    assert.deepEqual(sent.required, ["clauseId", "text"]);
    assert.equal(sent.additionalProperties, false);
  });

  it("is plain JSON Schema, not a zod object (the zod 3 pitfall)", () => {
    assert.equal(typeof sent.parse, "undefined");
    assert.equal(typeof sent.safeParse, "undefined");
    assert.equal("_def" in sent, false);
    assert.doesNotThrow(() => JSON.stringify(sent));
  });

  it("every property key matches our zod input schema, and nothing is missing", () => {
    assert.deepEqual(Object.keys(schema.properties).sort(), [...zodKeys].sort());
  });

  it("every property maps onto our request schemas (AnalyzeRequest and Clause)", () => {
    const requestKeys = Object.keys(AnalyzeRequestSchema.shape);
    const clauseKeys = Object.keys(ClauseSchema.shape);
    assert.ok(requestKeys.includes("docType") && requestKeys.includes("language"));
    assert.ok(clauseKeys.includes("heading") && clauseKeys.includes("text") && clauseKeys.includes("id"));
  });

  it("enums match our schemas exactly", () => {
    assert.deepEqual([...schema.properties.language.enum], [...LANGUAGES]);
    assert.deepEqual([...schema.properties.docType.enum], ["rental", "employment", "loan", "other"]);
  });

  it("the required list is exactly what our zod schema cannot do without", () => {
    // docType and language have zod defaults and heading is optional, so the model may omit them.
    const optionalForModel = ["docType", "language", "heading"];
    const mustHave = zodKeys.filter((key) => !optionalForModel.includes(key));
    assert.deepEqual([...mustHave].sort(), [...schema.required].sort());
    assert.equal(AnalyzeClauseInputSchema.safeParse({ clauseId: "c1", text: "x" }).success, true);
    assert.equal(AnalyzeClauseInputSchema.safeParse({ clauseId: "c1" }).success, false);
    assert.equal(AnalyzeClauseInputSchema.safeParse({ text: "x" }).success, false);
  });

  it("every language the schema lists is accepted by our zod schema", () => {
    for (const language of schema.properties.language.enum) {
      assert.equal(AnalyzeClauseInputSchema.safeParse({ clauseId: "c1", text: "x", language }).success, true);
    }
  });
});

describe("analyze_clause: createTool wiring", () => {
  const { tool } = setup();

  it("has the agreed name and a description", () => {
    assert.equal(tool.name, "analyze_clause");
    assert.equal(ANALYZE_CLAUSE_TOOL_NAME, "analyze_clause");
    assert.ok(tool.description.length > 40);
    assert.match(tool.description, /not legal advice/i);
  });

  it("has retryable false, because analyze() already retries once", () => {
    assert.equal(tool.retryable, false);
  });

  it("has a timeout of two LLM timeouts plus 5 seconds, not the SDK default of 30 s", () => {
    assert.equal(ANALYZE_TOOL_TIMEOUT_MS, LLM_TIMEOUT_MS * 2 + 5_000);
    assert.equal(ANALYZE_TOOL_TIMEOUT_MS, 365_000);
    assert.equal(tool.timeoutMs, ANALYZE_TOOL_TIMEOUT_MS);
  });

  it("has an execute function and does not complete the run by itself", () => {
    assert.equal(typeof tool.execute, "function");
    assert.equal(tool.lifecycle?.completesRun, undefined);
  });
});


describe("analyze_clause: stub mode (ANALYZE_USE_STUB=1)", () => {
  // QUIRK: the stub ignores the input and returns the shared mock, so the flags below are for
  // the mock's clauses (c1, c2, c3), NOT for the clause that was passed in.
  it("returns the stub's flags whatever clause is passed in", async () => {
    const real = createAnalyze({ env: { ANALYZE_USE_STUB: "1" }, log: () => {} });
    const tool = createAnalyzeClauseTool({ analyze: real });
    const out = await tool.execute({ clauseId: "my-own-clause", text: "Unrelated text." }, ctx);
    assert.equal(out.flags.length, 3);
    assert.deepEqual(out.flags.map((f) => f.clauseId), ["c1", "c2", "c3"]);
    assert.ok(!out.flags.some((f) => f.clauseId === "my-own-clause"), "the stub does not flag the input clause");
    const here = dirname(fileURLToPath(import.meta.url));
    const mockPath = join(here, "..", "packages", "shared", "mocks", "analysis.json");
    const mock = JSON.parse(readFileSync(mockPath, "utf8")) as { flags: unknown[] };
    assert.deepEqual(out.flags, mock.flags.map((f) => FlagSchema.parse(f)));
  });

  it("is off by default: the real analyze() does not return the mock", async () => {
    assert.equal(process.env.ANALYZE_USE_STUB, undefined);
    const real = createAnalyze({
      env: {},
      log: () => {},
      callLlm: async () => JSON.stringify({ flags: [] }),
    });
    const tool = createAnalyzeClauseTool({ analyze: real });
    assert.deepEqual(await tool.execute({ clauseId: "c9", text: "Some text." }, ctx), { flags: [] });
  });
});

describe("analyze_clause: errors", () => {
  it("passes the safe fixed-message errors from analyze() through unchanged", async () => {
    const safe = [new AnalyzeError("llm_failed", "Analysis failed: x"), new LlmError("timeout", "LLM request timed out")];
    for (const error of safe) {
      const tool = createAnalyzeClauseTool({
        analyze: async () => {
          throw error;
        },
      });
      await assert.rejects(async () => tool.execute(validInput, ctx), (thrown: unknown) => thrown === error);
    }
  });

  it("replaces any other error with a fixed message that has no clause text", async () => {
    const tool = createAnalyzeClauseTool({
      analyze: async () => {
        throw new Error(`boom ${SECRET}`);
      },
    });
    await assert.rejects(async () => tool.execute({ clauseId: "c1", text: SECRET }, ctx), (thrown: unknown) => {
      assert.ok(thrown instanceof Error);
      assert.equal(thrown.message, "analyze_clause failed");
      assert.ok(!thrown.message.includes(SECRET));
      return true;
    });
  });
});

describe("analyze_clause: logging", () => {
  it("writes nothing to the console, on success or on failure", async () => {
    const written: string[] = [];
    const methods = ["log", "info", "warn", "error", "debug"] as const;
    const originals = methods.map((m) => console[m]);
    for (const m of methods) {
      console[m] = (...args: unknown[]) => {
        written.push(`${m}: ${args.map(String).join(" ")}`);
      };
    }
    try {
      const ok = setup([flag("c2")]).tool;
      await ok.execute(validInput, ctx);
      await assert.rejects(async () => ok.execute({ clauseId: "c1" }, ctx));
      const failing = createAnalyzeClauseTool({
        analyze: async () => {
          throw new Error(SECRET);
        },
      });
      await assert.rejects(async () => failing.execute({ clauseId: "c1", text: SECRET }, ctx));
    } finally {
      methods.forEach((m, i) => {
        console[m] = originals[i] as typeof console.log;
      });
    }
    assert.deepEqual(written, []);
  });

  it("the source file contains no console calls", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    assert.doesNotMatch(readFileSync(join(here, "tool.ts"), "utf8"), /console\./);
  });
});

