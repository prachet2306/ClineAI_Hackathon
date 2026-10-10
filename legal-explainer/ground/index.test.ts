// Tests for the real GroundFn, using the shared ingest and analysis mocks and fake retrievers.
// Run with: npx tsx --test ground/index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { createGround, ground, retrieve } from "./index";
import type { RetrieveFn } from "../packages/shared/contracts";
import { AnalysisResultSchema, FlagSchema, IngestResultSchema, type Flag } from "../packages/shared/schemas";
import ingestMock from "../packages/shared/mocks/ingest.json" with { type: "json" };
import analysisMock from "../packages/shared/mocks/analysis.json" with { type: "json" };
import groundedMock from "../packages/shared/mocks/grounded.json" with { type: "json" };

const ingest = IngestResultSchema.parse(ingestMock);
const analysis = AnalysisResultSchema.parse(analysisMock);
const clauses = ingest.clauses;
const flags = analysis.flags;

/** A fake source with fields that are obviously not real legal content. */
const fakeSource = {
  sourceId: "fake-source",
  title: "FAKE: sample source",
  snippet: "FAKE snippet text.",
  url: "https://example.com/fake-source",
  asOf: "2000-01",
};

/** A retriever that records every call and always returns the given sources. */
function recordingRetriever(results: Awaited<ReturnType<RetrieveFn>>) {
  const calls: Parameters<RetrieveFn>[0][] = [];
  const fn: RetrieveFn = async (input) => {
    calls.push(input);
    return results;
  };
  return { fn, calls };
}

/** Runs `body` with GROUND_USE_MOCK set (or unset when undefined), then restores the old value. */
async function withMockEnv(value: string | undefined, body: () => Promise<void>): Promise<void> {
  const previous = process.env.GROUND_USE_MOCK;
  if (value === undefined) delete process.env.GROUND_USE_MOCK;
  else process.env.GROUND_USE_MOCK = value;
  try {
    await body();
  } finally {
    if (previous === undefined) delete process.env.GROUND_USE_MOCK;
    else process.env.GROUND_USE_MOCK = previous;
  }
}

test("the mock data lines up: every analysis flag has a clause in the ingest mock", () => {
  assert.ok(flags.length > 0);
  for (const flag of flags) {
    assert.ok(clauses.some((clause) => clause.id === flag.clauseId), `no clause ${flag.clauseId}`);
  }
});

test("sets quoteVerified true for every mock flag and keeps order and count", () =>
  withMockEnv(undefined, async () => {
    const { fn } = recordingRetriever([]);
    const result = await createGround({ retrieve: fn })({ clauses, flags });
    assert.equal(result.length, flags.length);
    assert.deepEqual(result.map((flag) => flag.clauseId), flags.map((flag) => flag.clauseId));
    assert.ok(result.every((flag) => flag.quoteVerified === true));
  }));

test("leaves every other flag field untouched", () =>
  withMockEnv(undefined, async () => {
    const { fn } = recordingRetriever([fakeSource]);
    const result = await createGround({ retrieve: fn })({ clauses, flags });
    result.forEach((flag, i) => {
      const { citations: _c, quoteVerified: _q, grounding: _g, ...rest } = flag;
      const { citations: _c0, quoteVerified: _q0, grounding: _g0, ...original } = flags[i];
      assert.deepEqual(rest, original);
    });
  }));

test("calls retrieve once per flag, asking for 10 candidates, with a query of category, clause heading and quote only", () =>
  withMockEnv(undefined, async () => {
    const { fn, calls } = recordingRetriever([]);
    await createGround({ retrieve: fn })({ clauses, flags });
    assert.equal(calls.length, flags.length);
    flags.forEach((flag, i) => {
      const clause = clauses.find((c) => c.id === flag.clauseId);
      assert.ok(clause?.heading, "the mock clauses are expected to have headings");
      // 10 candidates are fetched so the relevance gate has something to filter; at most 3 are then cited.
      assert.equal(calls[i].topK, 10);
      assert.equal(calls[i].query, `${flag.category.replace(/_/g, " ")} ${clause.heading} ${flag.quote}`);
    });
  }));

test("the query does not contain the explanation or whyItMatters, and has no underscores", () =>
  withMockEnv(undefined, async () => {
    const { fn, calls } = recordingRetriever([]);
    await createGround({ retrieve: fn })({ clauses, flags });
    flags.forEach((flag, i) => {
      assert.ok(!calls[i].query.includes(flag.explanation), "explanation leaked into the query");
      assert.ok(!calls[i].query.includes(flag.whyItMatters), "whyItMatters leaked into the query");
      assert.ok(!calls[i].query.includes("_"), "category underscores should be spaces");
    });
    // rent_escalation is the category of the third mock flag.
    assert.ok(calls[2].query.startsWith("rent escalation "));
  }));

test("the query is only the category and the quote when the clause has no heading", () =>
  withMockEnv(undefined, async () => {
    const { heading: _heading, ...noHeading } = clauses[0];
    const { fn, calls } = recordingRetriever([]);
    await createGround({ retrieve: fn })({ clauses: [noHeading, ...clauses.slice(1)], flags: [flags[0]] });
    assert.equal(calls[0].query, `${flags[0].category} ${flags[0].quote}`);
  }));

test("attaches retrieved sources as citations and sets grounding to supported", () =>
  withMockEnv(undefined, async () => {
    const { fn } = recordingRetriever([fakeSource]);
    const result = await createGround({ retrieve: fn })({ clauses, flags });
    for (const flag of result) {
      assert.deepEqual(flag.citations, [fakeSource]);
      assert.equal(flag.grounding, "supported");
    }
  }));

test("maps citations to CitationSchema fields only and omits missing optional fields", () =>
  withMockEnv(undefined, async () => {
    const withExtras = { ...fakeSource, score: 9.5, topics: ["deposit"] };
    const bare = { sourceId: "fake-bare", title: "FAKE: bare", snippet: "FAKE bare snippet." };
    const { fn } = recordingRetriever([withExtras, bare]);
    const [first] = await createGround({ retrieve: fn })({ clauses, flags: [flags[0]] });
    assert.deepEqual(first.citations, [fakeSource, bare]);
    assert.deepEqual(Object.keys(first.citations[1]).sort(), ["sourceId", "snippet", "title"].sort());
  }));

test("with no retrieval results, citations are empty and grounding is unverified", () =>
  withMockEnv(undefined, async () => {
    // Start from flags that already claim to be supported, to prove the old values are replaced.
    const preset: Flag[] = flags.map((flag) => ({
      ...flag,
      citations: [{ sourceId: "stale", title: "stale", snippet: "stale" }],
      grounding: "supported",
    }));
    const { fn } = recordingRetriever([]);
    const result = await createGround({ retrieve: fn })({ clauses, flags: preset });
    for (const flag of result) {
      assert.deepEqual(flag.citations, []);
      assert.equal(flag.grounding, "unverified");
    }
  }));

test("a flag whose clause is missing is kept, unverified with no citations, and is not searched", () =>
  withMockEnv(undefined, async () => {
    const stale = [{ sourceId: "stale", title: "stale", snippet: "stale" }];
    const orphan: Flag = {
      ...flags[0],
      clauseId: "does-not-exist",
      quoteVerified: true,
      citations: stale,
      grounding: "supported",
    };
    const { fn, calls } = recordingRetriever([fakeSource]);
    const result = await createGround({ retrieve: fn })({ clauses, flags: [orphan, flags[1]] });
    assert.equal(result.length, 2);
    assert.deepEqual(result[0], { ...orphan, quoteVerified: false, citations: [], grounding: "unverified" });
    assert.equal(result[1].clauseId, flags[1].clauseId);
    assert.equal(calls.length, 1, "retrieve should only run for the flag whose clause exists");
  }));

test("an altered quote is unverified with no citations, and retrieve is not called for it", () =>
  withMockEnv(undefined, async () => {
    const altered: Flag = { ...flags[0], quote: flags[0].quote.replace("deems", "zzzzzz") };
    assert.notEqual(altered.quote, flags[0].quote);
    // The retriever would return a source, so any citation on the result would show retrieval ran.
    const { fn, calls } = recordingRetriever([fakeSource]);
    const [result] = await createGround({ retrieve: fn })({ clauses, flags: [altered] });
    assert.equal(result.quoteVerified, false);
    assert.deepEqual(result.citations, []);
    assert.equal(result.grounding, "unverified");
    assert.equal(calls.length, 0, "retrieve must not be called for an unverified quote");
  }));

test("an altered quote does not affect the other flags in the same call", () =>
  withMockEnv(undefined, async () => {
    const altered: Flag = { ...flags[1], quote: flags[1].quote.replace("Landlord", "Zzzzzz") };
    const { fn, calls } = recordingRetriever([fakeSource]);
    const result = await createGround({ retrieve: fn })({ clauses, flags: [flags[0], altered, flags[2]] });
    assert.equal(result.length, 3);
    assert.equal(result[1].grounding, "unverified");
    assert.equal(result[1].quoteVerified, false);
    for (const i of [0, 2]) {
      assert.equal(result[i].quoteVerified, true);
      assert.equal(result[i].grounding, "supported");
      assert.deepEqual(result[i].citations, [fakeSource]);
    }
    assert.equal(calls.length, 2);
  }));

test("grounding is supported only when the quote is verified and there is at least one citation", () =>
  withMockEnv(undefined, async () => {
    const altered: Flag = { ...flags[0], quote: flags[0].quote.replace("deems", "zzzzzz") };
    const cases: { name: string; flag: Flag; sources: Awaited<ReturnType<RetrieveFn>>; expected: string }[] = [
      { name: "verified + citations", flag: flags[0], sources: [fakeSource], expected: "supported" },
      { name: "verified + no citations", flag: flags[0], sources: [], expected: "unverified" },
      { name: "unverified + citations available", flag: altered, sources: [fakeSource], expected: "unverified" },
      { name: "unverified + no citations", flag: altered, sources: [], expected: "unverified" },
    ];
    for (const { name, flag, sources, expected } of cases) {
      const { fn } = recordingRetriever(sources);
      const [result] = await createGround({ retrieve: fn })({ clauses, flags: [flag] });
      assert.equal(result.grounding, expected, name);
    }
  }));

test("empty flags returns an empty array", () =>
  withMockEnv(undefined, async () => {
    const { fn, calls } = recordingRetriever([fakeSource]);
    assert.deepEqual(await createGround({ retrieve: fn })({ clauses, flags: [] }), []);
    assert.equal(calls.length, 0);
  }));

test("does not modify its input", () =>
  withMockEnv(undefined, async () => {
    const snapshot = structuredClone({ clauses, flags });
    const { fn } = recordingRetriever([fakeSource]);
    await createGround({ retrieve: fn })({ clauses, flags });
    assert.deepEqual({ clauses, flags }, snapshot);
  }));

test("output passes z.array(FlagSchema)", () =>
  withMockEnv(undefined, async () => {
    const { fn } = recordingRetriever([fakeSource]);
    const result = await createGround({ retrieve: fn })({ clauses, flags });
    assert.equal(z.array(FlagSchema).safeParse(result).success, true);
  }));

test("an invalid citation from retrieval is rejected by validation, not returned", () =>
  withMockEnv(undefined, async () => {
    const { fn } = recordingRetriever([{ ...fakeSource, url: "not a url" }]);
    await assert.rejects(createGround({ retrieve: fn })({ clauses, flags }));
  }));

test("a retriever failure leaves that flag unverified and the other flags unaffected", () =>
  withMockEnv(undefined, async () => {
    // Throws only for the second flag, identified by its quote, which is part of its query.
    const failsForSecond: RetrieveFn = async ({ query }) => {
      if (query.includes(flags[1].quote)) throw new Error("retrieval failed");
      return [fakeSource];
    };
    const { fn: healthy } = recordingRetriever([fakeSource]);
    const baseline = await createGround({ retrieve: healthy })({ clauses, flags });

    const result = await createGround({ retrieve: failsForSecond })({ clauses, flags });

    assert.equal(result.length, flags.length);
    assert.deepEqual(result.map((flag) => flag.clauseId), flags.map((flag) => flag.clauseId));
    // The failed flag: quote was verified, but nothing could be cited.
    assert.deepEqual(result[1], { ...baseline[1], citations: [], grounding: "unverified" });
    assert.equal(result[1].quoteVerified, true);
    // The others are exactly what they are when nothing fails.
    assert.deepEqual(result[0], baseline[0]);
    assert.deepEqual(result[2], baseline[2]);
    assert.equal(result[0].grounding, "supported");
    assert.equal(result[2].grounding, "supported");
  }));

test("when the retriever fails for every flag, the call still resolves with all flags unverified", () =>
  withMockEnv(undefined, async () => {
    const alwaysFails: RetrieveFn = async () => {
      throw new Error("retrieval failed");
    };
    const result = await createGround({ retrieve: alwaysFails })({ clauses, flags });
    assert.equal(result.length, flags.length);
    for (const flag of result) {
      assert.deepEqual(flag.citations, []);
      assert.equal(flag.grounding, "unverified");
    }
    assert.equal(z.array(FlagSchema).safeParse(result).success, true);
  }));

test("a retriever error message is not copied into the returned flags", () =>
  withMockEnv(undefined, async () => {
    const leaky: RetrieveFn = async () => {
      throw new Error("SECRET-ERROR-TEXT");
    };
    const result = await createGround({ retrieve: leaky })({ clauses, flags });
    assert.ok(!JSON.stringify(result).includes("SECRET-ERROR-TEXT"));
  }));

test("GROUND_USE_MOCK=1 returns the grounded mock without retrieving", () =>
  withMockEnv("1", async () => {
    const { fn, calls } = recordingRetriever([fakeSource]);
    const result = await createGround({ retrieve: fn })({ clauses, flags });
    assert.deepEqual(result, z.array(FlagSchema).parse(groundedMock));
    assert.equal(calls.length, 0);
  }));

test("other GROUND_USE_MOCK values do not enable the mock", () =>
  withMockEnv("0", async () => {
    const { fn, calls } = recordingRetriever([]);
    await createGround({ retrieve: fn })({ clauses, flags });
    assert.equal(calls.length, flags.length);
  }));

test("the exported ground runs against the shipped corpus and stays consistent", () =>
  withMockEnv(undefined, async () => {
    const result = await ground({ clauses, flags });
    assert.equal(result.length, flags.length);
    for (const flag of result) {
      assert.equal(flag.quoteVerified, true);
      // Citation-or-silence: supported if and only if there is at least one citation.
      assert.equal(flag.grounding === "supported", flag.citations.length > 0);
    }
  }));

test("the exported retrieve is a function", () => {
  assert.equal(typeof retrieve, "function");
});
