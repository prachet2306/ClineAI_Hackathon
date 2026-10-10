// M4 check for report/pdf.ts: renders English and Hindi reports, edge cases and an invalid input; prints PASS or FAIL per check.
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
import { renderPdf } from "./pdf";

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

// ---- Hindi sample content (real Hindi with conjuncts क्ष and त्र, a mixed sentence and an amount) ----
const HI_SUMMARY =
  "इस अनुबंध में 3 खंड समीक्षा योग्य हैं। सुरक्षा जमा राशि Rs. 60,000 है, इसलिए refund की शर्तें हस्ताक्षर से पहले पूछना उचित रहेगा।";

const hindiFlags = (): Flag[] =>
  structuredClone(mockFlags).map((flag, index) => ({
    ...flag,
    language: "hi" as const,
    explanation:
      index === 0
        ? "मकान मालिक जमा राशि Rs. 60,000 में से किन खर्चों की कटौती करेगा, यह स्पष्ट नहीं है। क्षति और स्वच्छता के लिए कोई तय सूची नहीं है।"
        : "यह खंड दोनों पक्षों के लिए समान नहीं दिखता, और इसकी स्पष्टता के बारे में पूछना उपयोगी हो सकता है।",
    whyItMatters:
      "त्रुटि या अस्पष्टता होने पर आपको बाद में परेशानी हो सकती है, इसलिए security deposit और notice period के बारे में पहले पूछना ठीक रहेगा।",
    questionsToAsk: ["क्या कटौती योग्य खर्चों की सूची लिखित में दी जा सकती है?", "Refund कितने दिनों में मिलेगा?"],
    suggestion: "कटौती की सीमा और वापसी की तारीख लिखित में माँगें।",
  }));

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

const hiRequest = (): ReportRequest => ({
  ingest: structuredClone(ingest),
  flags: hindiFlags(),
  comparison: {
    ...structuredClone(mockComparison),
    changes: structuredClone(mockComparison.changes).map((change) => ({ ...change, language: "hi" as const })),
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
    const pdf = await renderPdf(makeReport(hiRequest(), HI_SUMMARY));
    assertPdf(pdf);
    const path = join(tmpdir(), "report-hi.pdf");
    writeFileSync(path, pdf);
    console.log(`      ${path}`);
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
