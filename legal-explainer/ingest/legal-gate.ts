// Legal-document gate: runs after text extraction and before clause splitting.
// 3+ distinct legal terms pass; 0 reject; 1-2 (or mostly non-Latin text, where English keywords do not apply)
// get ONE small yes/no model call on the first ~1500 characters, and the document passes if that call fails.
// INGEST_SKIP_LEGAL_CHECK=true bypasses the gate (for testing). Rejections never contain document text.
import { IngestError } from "./errors";
import { askModel } from "./llm";

export const NOT_LEGAL_MESSAGE =
  "This doesn't look like a legal document. Please upload a rental agreement, loan document, job offer or legal notice.";

const LEGAL_TERMS: RegExp[] = [
  /\bagreements?\b/i,
  /\bpart(?:y|ies)\b/i,
  /\btenants?\b/i,
  /\blandlords?\b/i,
  /\blessors?\b/i,
  /\blessees?\b/i,
  /\bemployers?\b/i,
  /\bemployees?\b/i,
  /\bborrowers?\b/i,
  /\blenders?\b/i,
  /\bhereby\b/i,
  /\bshall\b/i,
  /\bterms\s+and\s+conditions\b/i,
  /\bnotices?\b/i,
  /\bdeposits?\b/i,
  /\btermination\b/i,
  /\bgoverning\s+law\b/i,
  /\bwitness(?:es|eth)?\b/i,
  /\bclauses?\b/i,
  /\bobligations?\b/i,
  /\bliable\b/i,
  /\binterest\b/i,
  /\btenure\b/i,
];

const MIN_HITS = 3;
const MODEL_EXCERPT_CHARS = 1500;
const MODEL_TIMEOUT_MS = 10_000;

const SYSTEM = "You classify documents. You answer with exactly one word: YES or NO.";
const QUESTION =
  "Is the following text a legal document, such as a rental or lease agreement, a loan or credit document, " +
  "an employment contract or job offer, or a legal notice? Answer YES or NO only.";

/** How many distinct legal terms appear in the text. */
export function countLegalTerms(text: string): number {
  return LEGAL_TERMS.filter((re) => re.test(text)).length;
}

/** True when most letters are outside the Latin script (Hindi, Tamil, Bengali and so on). */
function mostlyNonLatin(text: string): boolean {
  const sample = text.slice(0, 4000);
  const nonLatin = (sample.match(/[\u0370-\u1FFF\u2C00-\uFDFF]/g) ?? []).length;
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length;
  return nonLatin > latin;
}

/** Asks the model; any failure or unclear answer lets the document through. Only an explicit NO rejects. */
async function modelSaysLegal(excerpt: string): Promise<boolean> {
  try {
    const answer = await askModel(SYSTEM, `${QUESTION}\n\n---\n${excerpt}\n---`, MODEL_TIMEOUT_MS);
    return !/^\W*no\b/i.test(answer);
  } catch {
    return true;
  }
}

const reject = () => new IngestError("BAD_INPUT", NOT_LEGAL_MESSAGE);

/** Throws IngestError(BAD_INPUT, NOT_LEGAL_MESSAGE) when the text does not look like a legal document. */
export async function assertLegalDocument(text: string): Promise<void> {
  if (process.env.INGEST_SKIP_LEGAL_CHECK?.trim().toLowerCase() === "true") return;

  if (!mostlyNonLatin(text)) {
    const hits = countLegalTerms(text);
    if (hits >= MIN_HITS) return;
    if (hits === 0) throw reject();
  }
  if (!(await modelSaysLegal(text.trim().slice(0, MODEL_EXCERPT_CHARS)))) throw reject();
}
