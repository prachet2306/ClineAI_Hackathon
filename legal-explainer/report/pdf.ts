// M4 /report: real RenderPdfFn. Draws a Report to an A4 PDF with pdfkit using only the bundled Noto Sans fonts (never a built-in font).
// Devanagari and other text are drawn as separate runs with the matching font. Nothing from the report is ever logged.
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import type { RenderPdfFn } from "../packages/shared/contracts";
import {
  ReportSchema,
  type Change,
  type ChangeType,
  type ClauseCategory,
  type Flag,
  type Language,
  type Report,
  type RiskLevel,
} from "../packages/shared/schemas";

type Doc = InstanceType<typeof PDFDocument>;

/* ------------------------------------------------------------------ */
/* Fonts                                                               */
/* ------------------------------------------------------------------ */

const FONT_FILES = {
  regular: "NotoSans-Regular.ttf",
  bold: "NotoSans-Bold.ttf",
  devaRegular: "NotoSansDevanagari-Regular.ttf",
  devaBold: "NotoSansDevanagari-Bold.ttf",
} as const;

// Names registered with pdfkit (our own aliases for the font files, not built-in fonts).
const FONT_NAMES = {
  regular: "NotoSans",
  bold: "NotoSans-Bold",
  devaRegular: "NotoSansDevanagari",
  devaBold: "NotoSansDevanagari-Bold",
} as const;

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Candidate font folders, in order. The first one that exists wins. */
const fontDirCandidates = (): string[] => {
  const candidates: string[] = [];
  try {
    candidates.push(join(dirname(fileURLToPath(import.meta.url)), "fonts"));
  } catch {
    // import.meta.url is not a file URL when bundled; the other candidates still apply
  }
  candidates.push(join(process.cwd(), "report", "fonts"));
  candidates.push(join(process.cwd(), "..", "..", "report", "fonts"));
  return candidates;
};

interface FontPaths {
  regular: string;
  bold: string;
  devaRegular: string;
  devaBold: string;
}

const resolveFontPaths = (): FontPaths => {
  const dir = fontDirCandidates().find(isDirectory);
  if (dir === undefined) {
    throw new Error("Report font folder not found: expected the folder report/fonts with the Noto Sans files");
  }
  const paths: FontPaths = {
    regular: join(dir, FONT_FILES.regular),
    bold: join(dir, FONT_FILES.bold),
    devaRegular: join(dir, FONT_FILES.devaRegular),
    devaBold: join(dir, FONT_FILES.devaBold),
  };
  for (const key of Object.keys(FONT_FILES) as (keyof typeof FONT_FILES)[]) {
    if (!existsSync(paths[key])) throw new Error(`Report font file missing: ${FONT_FILES[key]}`);
  }
  return paths;
};

/* ------------------------------------------------------------------ */
/* Mixed-script helper                                                 */
/* ------------------------------------------------------------------ */

export interface ScriptRun {
  text: string;
  devanagari: boolean;
}

const isDevanagariCodePoint = (cp: number): boolean =>
  (cp >= 0x0900 && cp <= 0x097f) || (cp >= 0xa8e0 && cp <= 0xa8ff);

/** Zero-width joiner / non-joiner: used inside Devanagari conjuncts, so they stay with a Devanagari run. */
const isJoiner = (cp: number): boolean => cp === 0x200c || cp === 0x200d;

/** Splits text into runs of Devanagari (U+0900-U+097F, U+A8E0-U+A8FF) versus everything else. */
export const splitScriptRuns = (text: string): ScriptRun[] => {
  const runs: ScriptRun[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const last = runs[runs.length - 1];
    const devanagari = isDevanagariCodePoint(cp) || (isJoiner(cp) && last?.devanagari === true);
    if (last !== undefined && last.devanagari === devanagari) last.text += ch;
    else runs.push({ text: ch, devanagari });
  }
  return runs;
};

/* ------------------------------------------------------------------ */
/* Headings and labels                                                 */
/* ------------------------------------------------------------------ */

interface Labels {
  title: string;
  overallRisk: string;
  summary: string;
  flags: string;
  questions: string;
  tips: string;
  changes: string;
  unverified: string;
  risk: Record<RiskLevel, string>;
  file: string;
  generated: string;
  clauseText: string;
  explanation: string;
  whyItMatters: string;
  questionsForFlag: string;
  suggestion: string;
  sources: string;
  change: string;
  before: string;
  after: string;
  changeTypes: Record<ChangeType, string>;
  favorsLabel: string;
  favors: Record<Change["favors"], string>;
  categories: Record<ClauseCategory, string>;
  utc: string;
  page: (current: number, total: number) => string;
}

const EN: Labels = {
  title: "Contract review report",
  overallRisk: "Overall risk",
  summary: "Summary",
  flags: "Clauses worth reviewing",
  questions: "Questions to ask before signing",
  tips: "Negotiation tips",
  changes: "What changed between versions",
  unverified: "Not verified against a reference source",
  risk: { red: "High concern", amber: "Worth a closer look", green: "Lower concern" },
  file: "File",
  generated: "Generated",
  clauseText: "Clause text",
  explanation: "What it says",
  whyItMatters: "Why it may matter",
  questionsForFlag: "Questions to ask",
  suggestion: "Suggestion",
  sources: "Sources",
  change: "Change",
  before: "Before",
  after: "After",
  changeTypes: { added: "Added", removed: "Removed", softened: "Softened", hardened: "Hardened", reworded: "Reworded" },
  favorsLabel: "Favors",
  favors: { signer: "You (the signer)", other_party: "The other party", neutral: "Neither side" },
  utc: "UTC",
  categories: {
    deposit: "Deposit",
    rent: "Rent",
    rent_escalation: "Rent increase",
    lock_in: "Lock-in period",
    termination: "Termination",
    notice_period: "Notice period",
    maintenance: "Maintenance",
    penalties: "Penalties",
    fees: "Fees",
    entry_access: "Entry and access",
    renewal: "Renewal",
    dispute_resolution: "Dispute resolution",
    non_compete: "Non-compete",
    other: "Other",
  },
  page: (current, total) => `Page ${current} of ${total}`,
};

const HI: Labels = {
  title: "अनुबंध समीक्षा रिपोर्ट",
  overallRisk: "कुल जोखिम",
  summary: "सारांश",
  flags: "समीक्षा योग्य खंड",
  questions: "हस्ताक्षर से पहले पूछने योग्य प्रश्न",
  tips: "बातचीत के सुझाव",
  changes: "दोनों संस्करणों में क्या बदला",
  unverified: "संदर्भ स्रोत से सत्यापित नहीं",
  risk: { red: "उच्च चिंता", amber: "ध्यान देने योग्य", green: "कम चिंता" },
  file: "फ़ाइल",
  generated: "बनाया गया",
  clauseText: "खंड का पाठ",
  explanation: "इसमें क्या लिखा है",
  whyItMatters: "यह क्यों मायने रख सकता है",
  questionsForFlag: "पूछने योग्य प्रश्न",
  suggestion: "सुझाव",
  sources: "स्रोत",
  change: "बदलाव",
  before: "पहले",
  after: "बाद में",
  changeTypes: {
    added: "जोड़ा गया",
    removed: "हटाया गया",
    softened: "नरम किया गया",
    hardened: "कठोर किया गया",
    reworded: "शब्द बदले गए",
  },
  favorsLabel: "किसे फ़ायदा",
  favors: { signer: "आपको (हस्ताक्षरकर्ता को)", other_party: "दूसरे पक्ष को", neutral: "किसी एक पक्ष को नहीं" },
  utc: "यूटीसी",
  categories: {
    deposit: "जमा राशि",
    rent: "किराया",
    rent_escalation: "किराया वृद्धि",
    lock_in: "लॉक-इन अवधि",
    termination: "समाप्ति",
    notice_period: "नोटिस अवधि",
    maintenance: "रखरखाव",
    penalties: "जुर्माना",
    fees: "शुल्क",
    entry_access: "प्रवेश और पहुँच",
    renewal: "नवीनीकरण",
    dispute_resolution: "विवाद समाधान",
    non_compete: "प्रतिस्पर्धा पर रोक",
    other: "अन्य",
  },
  page: (current, total) => `पृष्ठ ${current} / ${total}`,
};

/** Hindi has its own headings; every other language uses the English headings. */
const labelsFor = (language: Language): Labels => (language === "hi" ? HI : EN);

/** Fixed label printed before each citation title: citations stay in English, so non-English reports say so. */
export const citationLabel = (language: Language): string => {
  if (language === "en") return "";
  return language === "hi" ? "स्रोत (अंग्रेज़ी में)" : "Source (in English)";
};

/* ------------------------------------------------------------------ */
/* Colours and layout constants                                        */
/* ------------------------------------------------------------------ */

// Dark red, dark amber and dark green are used ONLY for risk labels.
const RISK_COLORS: Record<RiskLevel, string> = { red: "#8B1A1A", amber: "#8A5300", green: "#1B5E20" };
const INK = "#1F1F1F";
const GREY = "#4A4A4A";
const RULE = "#9A9A9A";

const MARGIN = 50;
const BODY_SIZE = 10.5;
const SMALL_SIZE = 10;
const LINE_GAP = 2;
/** A flag (or change) block starts on a new page when less than this much room is left. */
const BLOCK_MIN_SPACE = 120;

/* ------------------------------------------------------------------ */
/* Drawing helpers                                                     */
/* ------------------------------------------------------------------ */

interface Ctx {
  doc: Doc;
  labels: Labels;
  language: Language;
  left: number;
  width: number;
}

interface Segment {
  text: string;
  bold?: boolean;
  color?: string;
  /** Draw the whole text with the Noto Sans (Latin) font, without splitting into script runs. */
  latinFont?: boolean;
}

interface Part {
  text: string;
  font: string;
  color: string;
}

/** Expands segments into script runs, each with the right font name and colour. */
const toParts = (segments: readonly Segment[], defaultColor: string): Part[] => {
  const parts: Part[] = [];
  for (const segment of segments) {
    const bold = segment.bold === true;
    if (segment.latinFont === true) {
      parts.push({ text: segment.text, font: bold ? FONT_NAMES.bold : FONT_NAMES.regular, color: segment.color ?? defaultColor });
      continue;
    }
    for (const run of splitScriptRuns(segment.text)) {
      let font: string;
      if (run.devanagari) font = bold ? FONT_NAMES.devaBold : FONT_NAMES.devaRegular;
      else font = bold ? FONT_NAMES.bold : FONT_NAMES.regular;
      parts.push({ text: run.text, font, color: segment.color ?? defaultColor });
    }
  }
  return parts;
};

interface DrawOptions {
  x: number;
  y: number;
  width: number;
  size: number;
  color: string;
}

/**
 * Draws one paragraph made of segments. Every run except the last uses `continued: true` so the line wraps
 * correctly across runs; the last call is not continued, which ends the paragraph.
 */
const drawSegments = (ctx: Ctx, segments: readonly Segment[], options: DrawOptions): void => {
  const parts = toParts(segments, options.color);
  if (parts.length === 0) return;
  const { doc } = ctx;
  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;
    doc.font(part.font).fontSize(options.size).fillColor(part.color);
    const textOptions = { width: options.width, lineGap: LINE_GAP, continued: !isLast };
    if (index === 0) doc.text(part.text, options.x, options.y, textOptions);
    else doc.text(part.text, textOptions);
  });
  doc.x = ctx.left;
};

const remainingSpace = (doc: Doc): number => doc.page.height - doc.page.margins.bottom - doc.y;

const ensureSpace = (ctx: Ctx, needed: number): void => {
  if (remainingSpace(ctx.doc) < needed) ctx.doc.addPage();
};

const gap = (ctx: Ctx, amount: number): void => {
  ctx.doc.y += amount;
  ctx.doc.x = ctx.left;
};

interface ParagraphOptions {
  indent?: number;
  size?: number;
  color?: string;
  after?: number;
}

const paragraph = (ctx: Ctx, segments: readonly Segment[], options: ParagraphOptions = {}): void => {
  const indent = options.indent ?? 0;
  drawSegments(ctx, segments, {
    x: ctx.left + indent,
    y: ctx.doc.y,
    width: ctx.width - indent,
    size: options.size ?? BODY_SIZE,
    color: options.color ?? INK,
  });
  gap(ctx, options.after ?? 4);
};

const sectionHeading = (ctx: Ctx, text: string): void => {
  ensureSpace(ctx, 80);
  gap(ctx, 8);
  paragraph(ctx, [{ text, bold: true }], { size: 14, after: 6 });
};

/** A marker (bullet or number) followed by wrapped text that lines up beside it. */
const listItem = (ctx: Ctx, marker: string, text: string | readonly Segment[], markerWidth: number): void => {
  ensureSpace(ctx, 30);
  const { doc } = ctx;
  const indent = 8;
  const startY = doc.y;
  drawSegments(ctx, [{ text: marker }], {
    x: ctx.left + indent,
    y: startY,
    width: markerWidth,
    size: BODY_SIZE,
    color: INK,
  });
  doc.y = startY;
  const segments: readonly Segment[] = typeof text === "string" ? [{ text }] : text;
  paragraph(ctx, segments, { indent: indent + markerWidth, after: 3 });
};

const bulletItem = (ctx: Ctx, text: string | readonly Segment[]): void => listItem(ctx, "•", text, 14);
const numberedItem = (ctx: Ctx, position: number, text: string): void => listItem(ctx, `${position}.`, text, 24);

/** Quoted text with a thin grey bar on its left. The bar is skipped if the text crossed a page. */
const quoteBlock = (ctx: Ctx, label: string, text: string): void => {
  const { doc } = ctx;
  paragraph(ctx, [{ text: `${label}:`, bold: true }], { size: SMALL_SIZE, color: GREY, after: 1 });
  ensureSpace(ctx, 30);
  const pagesBefore = doc.bufferedPageRange().count;
  const startY = doc.y;
  drawSegments(ctx, [{ text: `“${text}”` }], {
    x: ctx.left + 10,
    y: startY,
    width: ctx.width - 10,
    size: SMALL_SIZE,
    color: GREY,
  });
  const endY = doc.y;
  if (doc.bufferedPageRange().count === pagesBefore && endY > startY) {
    doc.save().lineWidth(1.5).strokeColor(RULE).moveTo(ctx.left + 3, startY).lineTo(ctx.left + 3, endY).stroke().restore();
  }
  gap(ctx, 5);
};

const horizontalRule = (ctx: Ctx): void => {
  const { doc } = ctx;
  gap(ctx, 4);
  doc.save().lineWidth(0.5).strokeColor(RULE).moveTo(ctx.left, doc.y).lineTo(ctx.left + ctx.width, doc.y).stroke().restore();
  gap(ctx, 8);
};

const formatGeneratedAt = (iso: string, utc: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${date.toISOString().slice(0, 16).replace("T", " ")} ${utc}`;
};

const riskLabelSegment = (labels: Labels, level: RiskLevel): Segment => ({
  text: labels.risk[level],
  bold: true,
  color: RISK_COLORS[level],
});

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

/** Disclaimer text unchanged, inside a bordered box. The border is drawn after the text so its height always fits. */
const disclaimerBox = (ctx: Ctx, text: string): void => {
  const { doc } = ctx;
  const pad = 8;
  const innerWidth = ctx.width - 2 * pad;
  const hasDevanagari = splitScriptRuns(text).some((run) => run.devanagari);
  doc.font(hasDevanagari ? FONT_NAMES.devaRegular : FONT_NAMES.regular).fontSize(SMALL_SIZE);
  const estimate = doc.heightOfString(text, { width: innerWidth, lineGap: LINE_GAP });
  ensureSpace(ctx, estimate + 2 * pad + 4);

  const pagesBefore = doc.bufferedPageRange().count;
  const top = doc.y;
  drawSegments(ctx, [{ text }], { x: ctx.left + pad, y: top + pad, width: innerWidth, size: SMALL_SIZE, color: INK });
  const bottom = doc.y + pad;
  if (doc.bufferedPageRange().count === pagesBefore) {
    doc.save().lineWidth(1).strokeColor(INK).rect(ctx.left, top, ctx.width, bottom - top).stroke().restore();
  }
  doc.y = bottom;
  gap(ctx, 10);
};

const flagBlock = (ctx: Ctx, flag: Flag, position: number): void => {
  const { labels } = ctx;
  const label = citationLabel(ctx.language);
  if (remainingSpace(ctx.doc) < BLOCK_MIN_SPACE) ctx.doc.addPage();

  paragraph(
    ctx,
    [{ text: `${position}. ${labels.categories[flag.category]} — `, bold: true }, riskLabelSegment(labels, flag.riskLevel)],
    { size: 12, after: 5 },
  );
  quoteBlock(ctx, labels.clauseText, flag.quote);
  paragraph(ctx, [{ text: `${labels.explanation}: `, bold: true }, { text: flag.explanation }]);
  paragraph(ctx, [{ text: `${labels.whyItMatters}: `, bold: true }, { text: flag.whyItMatters }]);

  if (flag.questionsToAsk.length > 0) {
    paragraph(ctx, [{ text: `${labels.questionsForFlag}:`, bold: true }], { after: 2 });
    for (const question of flag.questionsToAsk) bulletItem(ctx, question);
  }
  if (flag.suggestion !== undefined && flag.suggestion.length > 0) {
    paragraph(ctx, [{ text: `${labels.suggestion}: `, bold: true }, { text: flag.suggestion }]);
  }

  if (flag.grounding === "unverified") {
    paragraph(ctx, [{ text: labels.unverified }], { size: SMALL_SIZE, color: GREY });
  } else if (flag.citations.length > 0) {
    paragraph(ctx, [{ text: `${labels.sources}:`, bold: true }], { size: SMALL_SIZE, after: 2 });
    for (const citation of flag.citations) {
      const asOf = citation.asOf !== undefined && citation.asOf.length > 0 ? ` (${citation.asOf})` : "";
      const segments: Segment[] = [];
      if (label.length > 0) segments.push({ text: `${label}: ` });
      segments.push({ text: `${citation.title}${asOf}`, latinFont: true });
      bulletItem(ctx, segments);
    }
  }
  horizontalRule(ctx);
};

const changeBlock = (ctx: Ctx, change: Change, position: number): void => {
  const { labels } = ctx;
  if (remainingSpace(ctx.doc) < BLOCK_MIN_SPACE) ctx.doc.addPage();

  paragraph(
    ctx,
    [
      { text: `${labels.change} ${position}: ${labels.changeTypes[change.changeType]} — `, bold: true },
      riskLabelSegment(labels, change.severity),
    ],
    { size: 12, after: 3 },
  );
  paragraph(ctx, [{ text: `${labels.favorsLabel}: `, bold: true }, { text: labels.favors[change.favors] }], {
    size: SMALL_SIZE,
    color: GREY,
    after: 4,
  });
  if (change.beforeText !== undefined && change.beforeText.length > 0) quoteBlock(ctx, labels.before, change.beforeText);
  if (change.afterText !== undefined && change.afterText.length > 0) quoteBlock(ctx, labels.after, change.afterText);
  paragraph(ctx, [{ text: `${labels.explanation}: `, bold: true }, { text: change.explanation }]);
  paragraph(ctx, [{ text: `${labels.whyItMatters}: `, bold: true }, { text: change.whyItMatters }]);
  horizontalRule(ctx);
};

/** Adds "Page X of Y" to every buffered page. */
const drawFooters = (ctx: Ctx): void => {
  const { doc, labels } = ctx;
  const range = doc.bufferedPageRange();
  const size = 9;
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const parts = toParts([{ text: labels.page(i + 1, range.count) }], GREY);
    const widths = parts.map((part) => doc.font(part.font).fontSize(size).widthOfString(part.text));
    const total = widths.reduce((sum, w) => sum + w, 0);
    let x = ctx.left + (ctx.width - total) / 2;
    const y = doc.page.height - 36;
    // Text below the bottom margin would make pdfkit add a page, so the margin is lifted while the footer is drawn.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    parts.forEach((part, index) => {
      doc.font(part.font).fontSize(size).fillColor(part.color).text(part.text, x, y, { lineBreak: false });
      x += widths[index] ?? 0;
    });
    doc.page.margins.bottom = savedBottom;
  }
};

const drawReport = (ctx: Ctx, report: Report): void => {
  const { labels } = ctx;

  paragraph(ctx, [{ text: labels.title, bold: true }], { size: 20, after: 10 });
  disclaimerBox(ctx, report.disclaimer);

  paragraph(ctx, [{ text: `${labels.file}: `, bold: true }, { text: report.filename }], {
    size: SMALL_SIZE,
    color: GREY,
    after: 2,
  });
  paragraph(ctx, [{ text: `${labels.generated}: `, bold: true }, { text: formatGeneratedAt(report.generatedAt, labels.utc) }], {
    size: SMALL_SIZE,
    color: GREY,
    after: 10,
  });

  paragraph(ctx, [{ text: `${labels.overallRisk}: `, bold: true }, riskLabelSegment(labels, report.overallRisk)], {
    size: 13,
    after: 6,
  });

  sectionHeading(ctx, labels.summary);
  paragraph(ctx, [{ text: report.summary }]);

  if (report.flags.length > 0) {
    sectionHeading(ctx, labels.flags);
    report.flags.forEach((flag, index) => flagBlock(ctx, flag, index + 1));
  }

  if (report.questionsToAsk.length > 0) {
    sectionHeading(ctx, labels.questions);
    report.questionsToAsk.forEach((question, index) => numberedItem(ctx, index + 1, question));
  }

  if (report.negotiationTips.length > 0) {
    sectionHeading(ctx, labels.tips);
    for (const tip of report.negotiationTips) bulletItem(ctx, tip);
  }

  if (report.comparison !== undefined) {
    sectionHeading(ctx, labels.changes);
    if (report.comparison.summary.length > 0) paragraph(ctx, [{ text: report.comparison.summary }], { after: 8 });
    report.comparison.changes.forEach((change, index) => changeBlock(ctx, change, index + 1));
  }
};

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export const renderPdf: RenderPdfFn = async (input) => {
  const report = ReportSchema.parse(input);
  const fonts = resolveFontPaths();

  // The Noto Sans Regular file path is the default font, so pdfkit never loads its built-in Helvetica files.
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true, font: fonts.regular });
  doc.registerFont(FONT_NAMES.regular, fonts.regular);
  doc.registerFont(FONT_NAMES.bold, fonts.bold);
  doc.registerFont(FONT_NAMES.devaRegular, fonts.devaRegular);
  doc.registerFont(FONT_NAMES.devaBold, fonts.devaBold);

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const labels = labelsFor(report.language);
  doc.info.Title = labels.title;
  const ctx: Ctx = { doc, labels, language: report.language, left: MARGIN, width: doc.page.width - 2 * MARGIN };

  drawReport(ctx, report);
  drawFooters(ctx);
  doc.end();
  return finished;
};
