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
import { compare } from "./index";
import { renderPdf, report } from "../report/index";

const mocksDir = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "shared", "mocks");
const loadMock = (name: string): unknown => JSON.parse(readFileSync(join(mocksDir, name), "utf8"));

const ingest = IngestResultSchema.parse(loadMock("ingest.json"));
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

  if (failed) process.exit(1);
};

void main();
