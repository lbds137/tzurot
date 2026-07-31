/**
 * Code-span detection for control-syntax parsers.
 *
 * Any parser that scans model output for control syntax (reasoning tags,
 * wrapper tags, delimiters) has a blind spot: content that *quotes* the syntax
 * is indistinguishable from content that *uses* it. That matters here because
 * the product hosts AI characters, so replies routinely discuss model
 * internals — a character explaining what `<thinking>` means emits the same
 * bytes as a model actually opening a reasoning block.
 *
 * Markdown gives one reliable signal for "this is a mention, not a delimiter":
 * the author wrapped it in code markup. This predicate answers whether a given
 * offset sits inside inline code (`` `like this` ``) or a fenced block
 * (```` ``` ````), so a parser can skip quoted occurrences.
 *
 * It is deliberately a *positive* signal only. An unfenced, unbackticked
 * mention is genuinely ambiguous and this predicate will report `false` for it;
 * callers that need to handle that case need a second discriminator (position,
 * for instance).
 *
 * Known simplification: fence detection is position-agnostic. Real Markdown
 * fences are line-anchored, but any literal triple backtick toggles state here,
 * so a reply using ``` inline ("she typed ``` by mistake") flips the scan into
 * fence mode for the rest of the string. That is tolerable because it fails
 * toward preserving content: an over-eager fence makes callers decline to
 * extract, and the worst outcome is reasoning that stays visible rather than a
 * reply that loses text. Line-anchoring it would be stricter and is fine to add
 * — but only with a caller that needs the precision, since the loose form has
 * the safer failure direction.
 */

/**
 * Whether `index` falls inside inline code or a fenced code block.
 *
 * Single left-to-right scan; the two states interact, so they cannot be
 * counted independently:
 * - A triple backtick toggles fence state and clears inline state — a stray
 *   inline backtick must not leak across a fence boundary.
 * - Inside a fence, single backticks are literal content and are ignored.
 * - Outside a fence, a single backtick toggles inline state, and a newline
 *   clears it: inline code does not span lines in Markdown, so without the
 *   reset one unmatched backtick would mark the whole rest of the document
 *   as code.
 *
 * @param text - The full text being scanned
 * @param index - Offset within `text` to classify
 * @returns true when the offset is inside code markup
 */
export function isInsideCodeSpan(text: string, index: number): boolean {
  if (index <= 0) {
    return false;
  }

  let inFence = false;
  let inInline = false;
  let cursor = 0;

  while (cursor < index) {
    if (text.startsWith('```', cursor)) {
      inFence = !inFence;
      inInline = false;
      cursor += 3;
      continue;
    }

    if (inFence) {
      cursor += 1;
      continue;
    }

    const char = text[cursor];
    if (char === '`') {
      inInline = !inInline;
    } else if (char === '\n') {
      inInline = false;
    }
    cursor += 1;
  }

  return inFence || inInline;
}
