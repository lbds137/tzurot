/**
 * Query-fold gate: should the LTM search query be augmented with the recent
 * conversation window (the "context fold"), or embedded bare?
 *
 * The fold-aware A/B on real conversation goldens showed the uniform fold is a
 * net-negative trade: it rescues content-POOR turns (a bare "poke" has nothing
 * to embed, so recent context is its only hope) but dilutes content-RICH turns
 * (song lyrics, a bug report — the message already retrieves the right memory,
 * and prepending recent-context chatter pushes it out of the top-K). The gate
 * makes the fold conditional: fold only when the UNFOLDED query is content-poor.
 *
 * The input is the query as it would be embedded WITHOUT the fold — message plus
 * any attachment descriptions / referenced-message text — because that is the
 * string whose semantic content decides whether folding helps or dilutes.
 *
 * The rule is deliberately dumb and was PRE-REGISTERED before the conditional
 * policy was scored (strip mentions/emoji/URLs, count content words, threshold)
 * — it must not be tuned against the judged goldens, or the offline simulation
 * that validated it becomes circular.
 */

/**
 * Fold when the unfolded query has fewer content words than this. Multi-word
 * mention display names ("@Charlie Morningstar") leave residual name tokens
 * after stripping, so the threshold leaves headroom above zero rather than
 * trying to strip names perfectly.
 */
export const FOLD_GATE_MAX_CONTENT_WORDS = 5;

/** Raw Discord mention syntax: user (<@123>, <@!123>), role (<@&123>), channel (<#123>). */
const RAW_MENTION_RE = /<[@#][!&]?\d+>/g;

/** Custom Discord emoji, static and animated: <:name:id> / <a:name:id>. */
const CUSTOM_EMOJI_RE = /<a?:\w+:\d+>/g;

/** Plain-text persona/user tags as stored in history content: "@Name", "&BotName". */
const TEXT_TAG_RE = /(?:^|\s)[@&]\S+/g;

const URL_RE = /https?:\/\/\S+/g;

/**
 * Count the content words of a query: whitespace tokens carrying at least two
 * alphanumeric characters, after mentions, custom emoji, text tags, and URLs
 * are stripped. Unicode emoji and punctuation-only tokens fall out naturally
 * (no alphanumerics). "Content" is deliberately generous — stopwords count,
 * because the signal is "is there ANY substance to embed", not keyword quality.
 */
export function countContentWords(query: string): number {
  const stripped = query
    .replace(RAW_MENTION_RE, ' ')
    .replace(CUSTOM_EMOJI_RE, ' ')
    .replace(TEXT_TAG_RE, ' ')
    .replace(URL_RE, ' ');
  return stripped.split(/\s+/).filter(token => token.replace(/[^a-zA-Z0-9]/g, '').length >= 2)
    .length;
}

/**
 * True when the unfolded search query is content-poor enough that folding the
 * recent conversation window into it is likely to help rather than dilute.
 *
 * @param unfoldedQuery the search query WITHOUT the recent-history window
 *   (message + attachment text + referenced-message text)
 * @param maxContentWords fold below this many content words; defaults to the
 *   pre-registered production threshold
 */
export function shouldFoldSearchQuery(
  unfoldedQuery: string,
  maxContentWords: number = FOLD_GATE_MAX_CONTENT_WORDS
): boolean {
  return countContentWords(unfoldedQuery) < maxContentWords;
}
