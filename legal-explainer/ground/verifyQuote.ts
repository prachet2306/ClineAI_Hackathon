// M3 quote-back check: confirms a flag's quote really appears in its clause text.

/** Straight-quote form of curly single and double quotes, so typography does not break a match. */
function normalizeQuotes(text: string): string {
  return text.replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E\u201F]/g, '"');
}

/** Collapses every run of whitespace into one space and trims the ends. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Normalised form used only for the fallback comparison. */
function normalize(text: string): string {
  return collapseWhitespace(normalizeQuotes(text));
}

/**
 * Returns true only if `quote` is an exact substring of `clauseText`, or, as a fallback,
 * matches after collapsing whitespace runs and treating curly and straight quotes as equal.
 * Empty (or whitespace-only) quotes always return false.
 */
export function verifyQuote(clauseText: string, quote: string): boolean {
  if (quote.trim().length === 0) return false;
  if (clauseText.includes(quote)) return true;

  const normalizedQuote = normalize(quote);
  if (normalizedQuote.length === 0) return false;
  return normalize(clauseText).includes(normalizedQuote);
}
