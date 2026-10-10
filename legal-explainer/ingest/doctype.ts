// Guesses the document type from keywords. Values come from DocumentTypeSchema; "other" is the fallback.
import type { DocumentType } from "../packages/shared/schemas";

const KEYWORDS: Record<Exclude<DocumentType, "other">, RegExp[]> = {
  rental: [
    /\blandlord\b/i, /\btenant\b/i, /\btenancy\b/i, /\blessor\b/i, /\blessee\b/i, /\bleave and licen[cs]e\b/i,
    /\brent(?:al)?\b/i, /\bsecurity deposit\b/i, /\bpremises\b/i, /\blicen[cs]or\b/i, /\blicen[cs]ee\b/i,
  ],
  employment: [
    /\bemployee\b/i, /\bemployer\b/i, /\bemployment\b/i, /\bsalary\b/i, /\bprobation\b/i, /\bctc\b/i,
    /\bappointment\b/i, /\bdesignation\b/i, /\bnon-?compete\b/i, /\bgratuity\b/i, /\bresign(?:s|ation)?\b/i,
  ],
  loan: [
    /\bborrower\b/i, /\blender\b/i, /\bloan\b/i, /\bprincipal\b/i, /\binterest rate\b/i, /\bemi\b/i,
    /\brepayment\b/i, /\bsanction(?:ed)?\b/i, /\bprocessing fee\b/i, /\bforeclosure\b/i, /\bnbfc\b/i,
  ],
};

// A legal notice (demand notice, notice from an advocate) is not a contract to review: use the fallback.
const LEGAL_NOTICE = [
  /\blegal notice\b/i,
  /\bunder instructions from my client\b/i,
  /\bwithout prejudice\b/i,
  /\bnotice under section\b/i,
  /\bunder instructions of my client\b/i,
];

const MIN_HITS = 3; // distinct keywords needed before we trust a guess

export function guessDocType(text: string): DocumentType {
  const head = text.slice(0, 2000);
  if (LEGAL_NOTICE.some((re) => re.test(head))) return "other";

  let best: DocumentType = "other";
  let bestHits = 0;
  for (const type of ["rental", "employment", "loan"] as const) {
    const hits = KEYWORDS[type].filter((re) => re.test(text)).length;
    if (hits > bestHits) {
      best = type;
      bestHits = hits;
    }
  }
  return bestHits >= MIN_HITS ? best : "other";
}
