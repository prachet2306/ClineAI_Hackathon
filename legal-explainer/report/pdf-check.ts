// M4 check for report/pdf.ts: renders English and Hindi reports (Hindi built via reportWith with a fake LLM), edge cases and an invalid input; prints PASS or FAIL per check.
// Output lists only fixed messages and the two temp file paths, never report text.
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AnalysisResultSchema,
  CompareResultSchema,
  IngestResultSchema,
  type Flag,
  type Report,
  type ReportRequest,
} from "../packages/shared/schemas";
import { buildReport } from "./build";
import { hindiFakeLlm } from "./hi-fixtures";
import { reportWith } from "./index";
import { citationLabel, renderPdf } from "./pdf";

const here = dirname(fileURLToPath(import.meta.url));
const mocksDir = join(here, "..", "packages", "shared", "mocks");
const loadMock = (name: string): unknown => JSON.parse(readFileSync(join(mocksDir, name), "utf8"));

const ingest = IngestResultSchema.parse(loadMock("ingest.json"));
const mockFlags = AnalysisResultSchema.parse(loadMock("analysis.json")).flags;
const mockComparison = CompareResultSchema.parse(loadMock("compare.json"));

let failed = false;

/** Error with a fixed message, safe to print. */
class CheckError extends Error {}

const expect = (condition: boolean, message: string): void => {
  if (!condition) throw new CheckError(message);
};

const run = async (name: string, fn: () => Promise<void>): Promise<void> => {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL  ${name}`);
    console.error(`      ${err instanceof CheckError ? err.message : err instanceof Error ? err.name : "UnknownError"}`);
  }
};

/** Counts page objects: "/Type /Page" that is not followed by "s" (which would be "/Type /Pages"). */
const countPages = (pdf: Buffer): number => (pdf.toString("latin1").match(/\/Type \/Page(?!s)/g) ?? []).length;

const makeReport = (request: ReportRequest, summary?: string): Report => buildReport(request, summary);

// ---- Hindi sample content: the Hindi report is built through reportWith with a fake LLM that returns full Hindi translations of the mock flags (see ./hi-fixtures) ----
const HI_CHANGE_EXPLANATION =
  "मकान मालिक के समझौता खत्म करने का नोटिस 15 दिन से घटकर 7 दिन रह गया है, जबकि आपकी अपनी नोटिस अवधि तीन महीने ही है।";
const HI_CHANGE_WHY =
  "अगर मकान मालिक समझौता खत्म करे तो नया घर ढूँढने के लिए आपके पास और कम समय होगा। इस बारे में सीधे पूछना ठीक रहेगा।";

const supportedFlag = (): Flag => {
  const base = structuredClone(mockFlags[0]);
  if (base === undefined) throw new CheckError("mock flags are empty");
  return {
    ...base,
    grounding: "supported",
    quoteVerified: true,
    citations: [{ sourceId: "src-1", title: "Sample reference title", snippet: "Sample snippet", asOf: "2021-06" }],
  };
};

const enRequest = (): ReportRequest => ({
  ingest: structuredClone(ingest),
  flags: [...structuredClone(mockFlags), supportedFlag()],
  comparison: structuredClone(mockComparison),
  language: "en",
});

/** Hindi request: English mock flags (the fake LLM translates them) and a comparison whose change text is already Hindi. */
const hiRequest = (): ReportRequest => ({
  ingest: structuredClone(ingest),
  flags: structuredClone(mockFlags),
  comparison: {
    ...structuredClone(mockComparison),
    summary: "संस्करण 2 में मकान मालिक का नोटिस 15 दिन से घटाकर 7 दिन कर दिया गया है। और कुछ नहीं बदला।",
    changes: structuredClone(mockComparison.changes).map((change) => ({
      ...change,
      explanation: HI_CHANGE_EXPLANATION,
      whyItMatters: HI_CHANGE_WHY,
      language: "hi" as const,
    })),
  },
  language: "hi",
});

const assertPdf = (pdf: Buffer): void => {
  expect(Buffer.isBuffer(pdf), "result is not a Buffer");
  expect(pdf.subarray(0, 5).toString("latin1") === "%PDF-", "missing %PDF- header");
  expect(pdf.length > 5000, "PDF is 5000 bytes or smaller");
};

const main = async (): Promise<void> => {
  await run("english report: valid PDF, written to the temp folder", async () => {
    const pdf = await renderPdf(makeReport(enRequest()));
    assertPdf(pdf);
    const path = join(tmpdir(), "report-en.pdf");
    writeFileSync(path, pdf);
    console.log(`      ${path}`);
  });

  await run("hindi report: valid PDF, written to the temp folder", async () => {
    const hindiReport = await reportWith(hiRequest(), hindiFakeLlm().llm);
    expect(hindiReport.language === "hi" && hindiReport.flags.every((f) => f.language === "hi"), "Hindi report flags are not Hindi");
    expect(hindiReport.disclaimer.startsWith("इस रिपोर्ट में केवल"), "Hindi report disclaimer is not Hindi first");
    const pdf = await renderPdf(hindiReport);
    assertPdf(pdf);
    const path = join(tmpdir(), "report-hi.pdf");
    writeFileSync(path, pdf);
    console.log(`      ${path}`);
  });

  await run("hindi report with a cited flag renders without an exception", async () => {
    const request = hiRequest();
    const first = request.flags[0];
    if (first === undefined) throw new CheckError("mock flags are empty");
    first.citations = [{ sourceId: "src-1", title: "Sample reference title", snippet: "Sample snippet", asOf: "2021-06" }];
    first.grounding = "supported";
    first.quoteVerified = true;
    const hindiReport = await reportWith(request, hindiFakeLlm().llm);
    expect(hindiReport.flags.some((f) => f.citations.length === 1), "Hindi report lost the citation");
    assertPdf(await renderPdf(hindiReport));
  });

  await run("citationLabel: hi, ta and en", async () => {
    expect(citationLabel("hi") === "स्रोत (अंग्रेज़ी में)", "hi label is wrong");
    expect(citationLabel("ta") === "Source (in English)", "ta label is wrong");
    expect(citationLabel("en") === "", "en label is not empty");
  });

  await run("no built-in Helvetica font is referenced", async () => {
    const text = (await renderPdf(makeReport(enRequest()))).toString("latin1");
    expect(!/\/BaseFont\s*\/Helvetica/.test(text), "Helvetica font found in the PDF");
  });

  await run("empty flags render without an exception", async () => {
    assertPdf(await renderPdf(makeReport({ ingest: structuredClone(ingest), flags: [], language: "en" })));
  });

  await run("report with comparison renders without an exception", async () => {
    const request: ReportRequest = {
      ingest: structuredClone(ingest),
      flags: structuredClone(mockFlags),
      comparison: structuredClone(mockComparison),
      language: "en",
    };
    assertPdf(await renderPdf(makeReport(request)));
  });

  await run("other language (ta) uses English headings and renders", async () => {
    assertPdf(await renderPdf(makeReport({ ...enRequest(), language: "ta" })));
  });

  await run("40 flags produce more than one page", async () => {
    const flags: Flag[] = [];
    for (let i = 0; i < 40; i += 1) {
      const flag = structuredClone(mockFlags[i % mockFlags.length]);
      if (flag === undefined) throw new CheckError("mock flags are empty");
      flags.push(flag);
    }
    const pdf = await renderPdf(makeReport({ ingest: structuredClone(ingest), flags, language: "en" }));
    expect(countPages(pdf) > 1, "PDF has only one page");
  });

  await run("invalid report object makes renderPdf throw", async () => {
    let threw = false;
    try {
      await renderPdf({ documentId: "" } as unknown as Report);
    } catch {
      threw = true;
    }
    expect(threw, "renderPdf did not throw");
  });

  if (failed) process.exit(1);
};

void main();
