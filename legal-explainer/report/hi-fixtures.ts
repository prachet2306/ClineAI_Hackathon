// M4 test fixture (used by compare/check.ts and report/pdf-check.ts only): Hindi translations of the mock flags (clauses c1, c2, c3)
// and a fake LLM that answers the flag-localization call and the summary call with them. No network, no real document text.
import type { LlmJsonFn } from "../compare/llm";

export interface HindiFlagText {
  clauseId: string;
  explanation: string;
  whyItMatters: string;
  questionsToAsk: string[];
  suggestion?: string;
}

/** Hindi text for the three mock flags, with every number kept exactly as in the English mock (60,000 and 15%). */
export const HINDI_FLAG_TEXTS: readonly HindiFlagText[] = [
  {
    clauseId: "c1",
    explanation:
      "मकान मालिक आपकी जमा राशि में से लगभग किसी भी बात के लिए पैसे काट सकता है और रकम अकेले तय करता है। कटौती की कोई तय सूची नहीं है और बाकी पैसे लौटाने की कोई पक्की तारीख भी नहीं है।",
    whyItMatters:
      "कटौती की कोई सीमा न होने और वापसी का समय साफ़ न होने से यह अंदाज़ा लगाना मुश्किल है कि 60,000 रुपये में से आपको कितने वापस मिलेंगे। हस्ताक्षर से पहले इस बारे में पूछना ठीक रहेगा।",
    questionsToAsk: [
      "क्या कटौती की जा सकने वाली चीज़ों की साफ़ सूची और अधिकतम सीमा लिखी जा सकती है?",
      "क्या कमरा खाली करने के बाद पैसे लौटाने के लिए दिनों की तय संख्या लिखी जा सकती है?",
      "क्या कमरे में आने के समय उसकी हालत की फ़ोटो खींचकर दर्ज की जाएगी?",
    ],
    suggestion: "कटौती वाली चीज़ों की लिखित सूची माँगें और तय दिनों के भीतर पैसे लौटाने की बात लिखवाएँ।",
  },
  {
    clauseId: "c2",
    explanation:
      "आपको तीन महीने का नोटिस देना होगा, लेकिन मकान मालिक केवल पंद्रह दिन के नोटिस पर समझौता खत्म कर सकता है।",
    whyItMatters:
      "दोनों पक्षों की नोटिस अवधि बहुत अलग है, इसलिए आपको जल्दी घर छोड़ने को कहा जा सकता है जबकि आप लंबे समय तक बँधे रहते हैं। यह पूछना ठीक रहेगा कि क्या दोनों के लिए नोटिस अवधि बराबर हो सकती है।",
    questionsToAsk: [
      "क्या दोनों पक्षों की नोटिस अवधि एक जैसी हो सकती है?",
      "क्या मकान मालिक को समझौता खत्म करने के लिए कोई कारण बताना ज़रूरी होगा?",
    ],
    suggestion: "दोनों पक्षों के लिए बराबर नोटिस अवधि माँगें।",
  },
  {
    clauseId: "c3",
    explanation: "आपका किराया हर साल अपने आप 15% बढ़ जाता है।",
    whyItMatters:
      "हर साल तय दर से बढ़ोतरी जल्दी बहुत बढ़ जाती है और आम दर से ज़्यादा हो सकती है। यह पूछना ठीक रहेगा कि क्या कम या सीमित बढ़ोतरी हो सकती है।",
    questionsToAsk: ["क्या हर साल की बढ़ोतरी कम की जा सकती है या एक तय रकम तक सीमित की जा सकती है?"],
  },
];

/** Hindi overall summary, as the fake LLM returns it. */
export const HINDI_SUMMARY = "3 खंड हस्ताक्षर से पहले देखने योग्य हैं, जिनमें 2 पर ज़्यादा ध्यान देना ज़रूरी हो सकता है।";

const ITEMS_MARKER = "Items, as JSON:\n";

/** Reads the clauseIds out of a flag-localization user prompt (undefined if the prompt is not one). */
const clauseIdsInPrompt = (user: string): string[] | undefined => {
  const at = user.indexOf(ITEMS_MARKER);
  if (at < 0) return undefined;
  const parsed: unknown = JSON.parse(user.slice(at + ITEMS_MARKER.length));
  if (!Array.isArray(parsed)) return undefined;
  return parsed.map((item: { clauseId?: unknown }) => String(item.clauseId));
};

export interface HindiFakeLlm {
  llm: LlmJsonFn;
  /** Number of calls made. */
  calls: () => number;
  /** Number of calls that were flag-localization calls. */
  localizeCalls: () => number;
}

/**
 * Fake LLM for the Hindi report: a flag-localization prompt gets the Hindi text of the flags it lists (same order), run through
 * `tweak` first so tests can break it; any other prompt (the summary) gets HINDI_SUMMARY. The output is validated by the caller's schema.
 */
export const hindiFakeLlm = (tweak: (items: HindiFlagText[]) => HindiFlagText[] = (items) => items): HindiFakeLlm => {
  let total = 0;
  let localize = 0;
  const llm: LlmJsonFn = async (_system, user, schema) => {
    total += 1;
    const ids = clauseIdsInPrompt(user);
    if (ids === undefined) return schema.parse({ summary: HINDI_SUMMARY });
    localize += 1;
    const items = ids.map((id) => {
      const found = HINDI_FLAG_TEXTS.find((text) => text.clauseId === id);
      return structuredClone(found ?? { clauseId: id, explanation: "-", whyItMatters: "-", questionsToAsk: [] });
    });
    return schema.parse(tweak(items));
  };
  return { llm, calls: () => total, localizeCalls: () => localize };
};
