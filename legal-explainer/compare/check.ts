// M4 check: calls compare, report and renderPdf, runs .parse() on the results and prints PASS or FAIL per check.
// Failure output lists only schema issue paths/codes or fixed messages, never document text or values.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  AnalysisResultSchema,
  CompareResultSchema,
  DISCLAIMER,
  IngestResultSchema,
  ReportSchema,
  type ReportRequest,
} from "../packages/shared/schemas";
import { compare, compareWith } from "./index";
import type { LlmJsonFn } from "./llm";
import { renderPdf, report } from "../report/index";

const here = dirname(fileURLToPath(import.meta.url));
const mocksDir = join(here, "..", "packages", "shared", "mocks");
const loadMock = (name: string): unknown => JSON.parse(readFileSync(join(mocksDir, name), "utf8"));

const ingest = IngestResultSchema.parse(loadMock("ingest.json"));
const versionB = IngestResultSchema.parse(JSON.parse(readFileSync(join(here, "fixtures", "versionB.json"), "utf8")));
const mockFlags = AnalysisResultSchema.parse(loadMock("analysis.json")).flags;
const mockComparison = CompareResultSchema.parse(loadMock("compare.json"));

let failed = false;

/** Error whose message is a fixed, value-free description, so it is safe to print. */
class CheckError extends Error {}

const expect = (condition: boolean, message: string): void => {
  if (!condition) throw new CheckError(message);
};

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item, i) => item === b[i]);

const baseRequest = (): ReportRequest => ({
  ingest: structuredClone(ingest),
  flags: structuredClone(mockFlags),
  language: "en",
});

const run = async (name: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL  ${name}`);
    if (err instanceof z.ZodError) {
      for (const issue of err.issues) console.error(`      ${issue.path.join(".")}: ${issue.code}`);
    } else if (err instanceof CheckError) {
      console.error(`      ${err.message}`);
    } else {
      console.error(`      ${err instanceof Error ? err.name : "UnknownError"}`);
    }
  }
};

const main = async () => {
  await run("compare", async () => CompareResultSchema.parse(await compare({ versionA: ingest, versionB: ingest, language: "en" })));

  let sampleReport: z.infer<typeof ReportSchema> | undefined;
  await run("report", async () => {
    sampleReport = ReportSchema.parse(await report({ ingest, flags: [], language: "en" }));
  });

  await run("renderPdf", async () => {
    if (!sampleReport) throw new Error("report unavailable");
    const pdf = z.instanceof(Buffer).parse(await renderPdf(sampleReport));
    z.string().startsWith("%PDF-").parse(pdf.subarray(0, 5).toString("latin1"));
  });

  // ---- report(): behaviour tests ----
  let built: z.infer<typeof ReportSchema> | undefined;
  await run("report: builds from mock flags", async () => {
    built = await report(baseRequest());
  });
  const get = (): z.infer<typeof ReportSchema> => {
    if (!built) throw new CheckError("report was not built");
    return built;
  };

  await run("report: passes ReportSchema", async () => {
    ReportSchema.parse(get());
  });

  await run("report: documentId and filename", async () => {
    expect(get().documentId === "doc-mock-001", "documentId mismatch");
    expect(get().filename === "sample-rental-agreement-v1.pdf", "filename mismatch");
  });

  await run("report: overallRisk is red", async () => {
    expect(get().overallRisk === "red", "overallRisk is not red");
  });

  await run("report: flag order c1,c2,c3", async () => {
    expect(sameList(get().flags.map((f) => f.clauseId), ["c1", "c2", "c3"]), "clause order mismatch");
    expect(sameList(get().flags.map((f) => f.riskLevel), ["red", "red", "amber"]), "risk order mismatch");
  });

  await run("report: 6 questions in clause order", async () => {
    const byClause = (id: string): string[] => mockFlags.find((f) => f.clauseId === id)?.questionsToAsk ?? [];
    const q = get().questionsToAsk;
    expect(q.length === 6, "question count is not 6");
    expect(byClause("c1").length === 3 && byClause("c2").length === 2 && byClause("c3").length === 1, "mock question counts changed");
    expect(sameList(q.slice(0, 3), byClause("c1")), "first 3 are not the c1 questions");
    expect(sameList(q.slice(3, 5), byClause("c2")), "next 2 are not the c2 questions");
    expect(sameList(q.slice(5, 6), byClause("c3")), "last is not the c3 question");
  });

  await run("report: 2 negotiation tips", async () => {
    expect(get().negotiationTips.length === 2, "tip count is not 2");
    const expected = ["c1", "c2"].map((id) => mockFlags.find((f) => f.clauseId === id)?.suggestion ?? "");
    expect(sameList(get().negotiationTips, expected), "tips are not the c1 and c2 suggestions");
  });

  await run("report: disclaimer", async () => {
    expect(get().disclaimer === DISCLAIMER, "disclaimer differs from DISCLAIMER");
  });

  await run("report: generatedAt is ISO datetime", async () => {
    z.string().datetime().parse(get().generatedAt);
    expect(new Date(get().generatedAt).toISOString() === get().generatedAt, "generatedAt is not toISOString format");
  });

  await run("report: comparison copied unchanged", async () => {
    const withComparison = await report({ ...baseRequest(), comparison: structuredClone(mockComparison) });
    expect(JSON.stringify(withComparison.comparison) === JSON.stringify(mockComparison), "comparison differs from input");
    expect(!("comparison" in get()), "comparison present when none was given");
  });

  await run("report: near-duplicate question dropped", async () => {
    const [first, second] = structuredClone(mockFlags);
    if (!first || !second) throw new CheckError("mock flags missing");
    first.questionsToAsk = ["Can both parties have the same notice period?"];
    second.questionsToAsk = ["can BOTH parties have the same notice period"];
    const result = await report({ ...baseRequest(), flags: [first, second] });
    expect(result.questionsToAsk.length === 1, "duplicate question was kept");
    expect(result.questionsToAsk[0] === first.questionsToAsk[0], "earlier question was not kept");
  });

  await run("report: empty flags", async () => {
    const empty = await report({ ...baseRequest(), flags: [] });
    expect(empty.overallRisk === "green", "overallRisk is not green");
    expect(empty.questionsToAsk.length === 0, "questions not empty");
    expect(empty.negotiationTips.length === 0, "tips not empty");
    expect(empty.summary.startsWith("No clauses were flagged"), "summary is not the no-flags text");
  });

  await run("report: input not mutated", async () => {
    const req = baseRequest();
    req.flags.reverse(); // reversed so an in-place sort would visibly change the input
    const before = JSON.stringify(req);
    await report(req);
    expect(JSON.stringify(req) === before, "request changed after call");
  });

  // ---- compare(): behaviour tests with a fake LLM (no network) ----
  /** Fake LLM: counts calls, runs `produce`, and validates its output with the schema the caller passed (like the real one). */
  const fakeLlm = (produce: () => unknown): { llm: LlmJsonFn; calls: () => number } => {
    let count = 0;
    const llm: LlmJsonFn = async (_system, _user, schema) => {
      count += 1;
      return schema.parse(produce());
    };
    return { llm, calls: () => count };
  };

  const classification = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id,
    changeType: "hardened",
    severity: "red",
    favors: "other_party",
    explanation: "The landlord can now end the agreement with less notice. Worth asking about.",
    whyItMatters: "Your own notice period is unchanged. Worth asking about whether this was meant.",
    ...extra,
  });

  const request = (b: typeof ingest) => ({ versionA: structuredClone(ingest), versionB: structuredClone(b), language: "en" as const });

  await run("compare: identical versions, 0 changes, LLM never called", async () => {
    const fake = fakeLlm(() => []);
    const result = await compareWith(request(ingest), fake.llm);
    expect(result.changes.length === 0, "changes found for identical versions");
    expect(fake.calls() === 0, "LLM was called");
    expect(result.summary === "No changes were detected in the clause text of the two versions.", "summary mismatch");
  });

  await run("compare: v1 vs v2 notice change is hardened", async () => {
    const fake = fakeLlm(() => [classification("chg1")]);
    const result = CompareResultSchema.parse(await compareWith(request(versionB), fake.llm));
    expect(result.changes.length === 1, "change count is not 1");
    const change = result.changes[0];
    if (!change) throw new CheckError("change missing");
    expect(change.id === "chg1", "id is not chg1");
    expect(change.clauseIdA === "c2" && change.clauseIdB === "c2", "clause ids are not c2/c2");
    expect(change.changeType === "hardened", "changeType is not hardened");
    expect(change.severity === "red" && change.favors === "other_party", "severity/favors mismatch");
    expect(change.beforeText?.includes("fifteen (15) days") === true, "beforeText lacks old notice");
    expect(change.afterText?.includes("seven (7) days") === true, "afterText lacks new notice");
    expect(result.documentIdA === "doc-mock-001" && result.documentIdB === "doc-mock-002", "document ids mismatch");
    expect(fake.calls() === 1, "LLM was not called exactly once");
  });

  await run("compare: clause missing in version B is removed", async () => {
    const b = structuredClone(ingest);
    b.clauses = b.clauses.filter((c) => c.id !== "c3");
    const fake = fakeLlm(() => [classification("chg1", { changeType: "removed" })]);
    const result = await compareWith({ versionA: structuredClone(ingest), versionB: b, language: "en" }, fake.llm);
    expect(result.changes.length === 1, "change count is not 1");
    const change = result.changes[0];
    expect(change?.changeType === "removed", "changeType is not removed");
    expect(change?.clauseIdA === "c3", "clauseIdA is not c3");
    expect(change?.clauseIdB === undefined && change?.afterText === undefined, "removed change has B side");
    expect(change?.beforeText !== undefined, "removed change has no beforeText");
  });

  await run("compare: extra clause in version B is added", async () => {
    const b = structuredClone(ingest);
    b.clauses.push({ id: "c4", index: 3, heading: "Pets", text: "Pets. The Tenant may not keep any animal on the premises without written consent.", page: 3 });
    const fake = fakeLlm(() => [classification("chg1", { changeType: "added" })]);
    const result = await compareWith({ versionA: structuredClone(ingest), versionB: b, language: "en" }, fake.llm);
    expect(result.changes.length === 1, "change count is not 1");
    const change = result.changes[0];
    expect(change?.changeType === "added", "changeType is not added");
    expect(change?.clauseIdA === undefined && change?.beforeText === undefined, "added change has A side");
    expect(change?.clauseIdB === "c4" && change?.afterText !== undefined, "added change lacks B side");
  });

  await run("compare: heading differing only in letter case still aligns", async () => {
    const b = structuredClone(versionB);
    const c2 = b.clauses.find((c) => c.id === "c2");
    if (!c2) throw new CheckError("c2 missing");
    c2.heading = "  TERMINATION ";
    const fake = fakeLlm(() => [classification("chg1")]);
    const result = await compareWith({ versionA: structuredClone(ingest), versionB: b, language: "en" }, fake.llm);
    expect(result.changes.length === 1, "change count is not 1");
    expect(result.changes[0]?.changeType === "hardened", "changeType is not hardened");
    expect(result.changes[0]?.clauseIdA === "c2" && result.changes[0]?.clauseIdB === "c2", "c2 did not align with c2");
  });

  await run("compare: LLM that always throws falls back to reworded/amber/neutral", async () => {
    const fake = fakeLlm(() => {
      throw new Error("fake failure");
    });
    const result = CompareResultSchema.parse(await compareWith(request(versionB), fake.llm));
    expect(result.changes.length === 1, "change count is not 1");
    const change = result.changes[0];
    expect(change?.changeType === "reworded", "changeType is not reworded");
    expect(change?.severity === "amber" && change?.favors === "neutral", "severity/favors are not amber/neutral");
    expect(
      change?.explanation === "This clause changed between the two versions. Compare the old and new text." &&
        change?.whyItMatters === "Worth asking about before signing.",
      "fallback wording mismatch",
    );
  });

  await run("compare: excerpt not in the clause falls back to full clause text", async () => {
    const fake = fakeLlm(() => [
      classification("chg1", { excerptBefore: "this text is not in the clause", excerptAfter: "neither is this text" }),
    ]);
    const result = await compareWith(request(versionB), fake.llm);
    const clauseA = ingest.clauses.find((c) => c.id === "c2")?.text;
    const clauseB = versionB.clauses.find((c) => c.id === "c2")?.text;
    expect(result.changes[0]?.beforeText === clauseA, "beforeText is not the full clause text");
    expect(result.changes[0]?.afterText === clauseB, "afterText is not the full clause text");
  });

  await run("compare: exact excerpt is used", async () => {
    const fake = fakeLlm(() => [classification("chg1", { excerptBefore: "fifteen (15) days'", excerptAfter: "seven (7) days'" })]);
    const result = await compareWith(request(versionB), fake.llm);
    expect(result.changes[0]?.beforeText === "fifteen (15) days'", "beforeText is not the excerpt");
    expect(result.changes[0]?.afterText === "seven (7) days'", "afterText is not the excerpt");
  });

  await run("compare: request not mutated", async () => {
    const req = request(versionB);
    const before = JSON.stringify(req);
    await compareWith(req, fakeLlm(() => [classification("chg1")]).llm);
    expect(JSON.stringify(req) === before, "request changed after call");
  });

  if (failed) process.exit(1);
};

void main();
