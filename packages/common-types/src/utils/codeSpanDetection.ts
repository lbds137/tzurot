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
 * This is load-bearing on a live path, not defensive scaffolding: prod logs
 * show `glm-4.5-air` emitting reasoning terminated by a bare `</think>` with no
 * opening tag, which `extractOrphanClosingTag` must keep handling. A backtick
 * run is the only thing separating that real delimiter from a reply that merely
 * mentions one, so a gap here costs a user their text.
 *
 * Known simplification: fence detection is position-agnostic. Real Markdown
 * fences are line-anchored, but any run of three or more backticks toggles
 * fence state here, so a reply using ``` inline ("she typed ``` by mistake")
 * flips the scan into fence mode for the rest of the string. That is tolerable
 * because it fails toward preserving content: an over-eager fence makes callers
 * decline to extract, and the worst outcome is reasoning that stays visible
 * rather than a reply that loses text. Line-anchoring it would be stricter and
 * is fine to add — but only with a caller that needs the precision, since the
 * loose form has the safer failure direction.
 */

/**
 * Backtick-run length at which a delimiter is treated as a fence rather than an
 * inline span. The two differ in more than length: a fence spans newlines and
 * closes on a run of *at least* its own length, while an inline span dies at a
 * newline and closes only on an exactly-equal run.
 */
const FENCE_MIN_RUN = 3;

/**
 * Whether a backtick run of `run` closes a span opened by a run of `openRun`.
 *
 * Fences follow CommonMark's "closing fence may be longer" rule; inline spans
 * require an exact match, which is what makes ``` ``code with a ` inside`` ```
 * work — the lone backtick is a shorter run, so it is content rather than a
 * terminator.
 */
function closesSpan(openRun: number, run: number): boolean {
  return openRun >= FENCE_MIN_RUN ? run >= openRun : run === openRun;
}

/**
 * Whether `index` falls inside inline code or a fenced code block.
 *
 * Single left-to-right scan over backtick *runs* rather than individual
 * backticks. Treating each backtick as an independent toggle looks equivalent
 * and is not: a double-backtick span — Markdown's form for code containing a
 * literal backtick — toggles twice and nets out to "not code", so a control
 * delimiter quoted inside one reads as unquoted. That failure direction is the
 * dangerous one, because an unrecognised span makes callers *extract*, which is
 * the data loss this utility exists to prevent.
 *
 * The rules, all falling out of the run length:
 * - A run of N backticks opens a span when none is open.
 * - Inside an open span, a run closes it per {@link closesSpan}; any other run
 *   is literal content.
 * - A newline clears a pending *inline* span (N < {@link FENCE_MIN_RUN}), since
 *   inline code does not span lines in Markdown. Without the reset one unmatched
 *   backtick would mark the whole rest of the document as code. Fences are
 *   unaffected — spanning lines is the entire point of a fence.
 *
 * @param text - The full text being scanned
 * @param index - Offset within `text` to classify
 * @returns true when the offset is inside code markup
 */
export function isInsideCodeSpan(text: string, index: number): boolean {
  if (index <= 0) {
    return false;
  }

  // Length of the run that opened the current span, or 0 when none is open.
  let openRun = 0;
  let cursor = 0;

  while (cursor < index) {
    const char = text[cursor];

    if (char === '`') {
      let runEnd = cursor;
      while (runEnd < text.length && text[runEnd] === '`') {
        runEnd += 1;
      }
      const run = runEnd - cursor;

      if (openRun === 0) {
        openRun = run;
      } else if (closesSpan(openRun, run)) {
        openRun = 0;
      }

      // `runEnd` can land past `index`, so an offset INSIDE a delimiter run is
      // classified by whether that run started before `index` and was therefore
      // processed: inside an opening run reports true, inside a closing run that
      // began earlier reports false. That asymmetry is undefined behaviour rather
      // than a decision — no caller passes a backtick offset (every one passes
      // the offset of a `<tag>` match), so there is no real case to settle it
      // against. Pick a rule here only alongside a caller that needs one.
      cursor = runEnd;
      continue;
    }

    if (char === '\n' && openRun > 0 && openRun < FENCE_MIN_RUN) {
      openRun = 0;
    }
    cursor += 1;
  }

  return openRun > 0;
}

/**
 * Strip every match of `pattern` EXCEPT the ones inside code markup.
 *
 * The companion to {@link isInsideCodeSpan} for the common case: a cleanup pass
 * that deletes matches. Every such pattern is also a way to destroy a
 * character's legitimate reply, because a reply *demonstrating* the syntax
 * contains the same bytes as a model that leaked it — and the demonstration is
 * what gets eaten. A real leaked artifact is never backticked, because the model
 * emits it as structure rather than as an example, so code markup separates the
 * two where position cannot.
 *
 * The offset is found BY TYPE rather than by position. `String.replace` passes a
 * replacer the match, then one argument per capture group, then the offset, then
 * the whole input — plus a `groups` object when the pattern has named groups.
 * Every one of those is a string or undefined except the offset, so the number
 * IS the offset, and stays so no matter how many groups a pattern grows or
 * whether any of them are named. Positional indexing cannot say that: indexing
 * from the front breaks when a pattern gains a capture group (every later
 * argument shifts right), and indexing from the back breaks when it gains a
 * NAMED group (`groups` is appended last). Both are correct only for the
 * patterns that exist today. The invariant is executable rather than a comment
 * asking the next author to remember.
 *
 * @param text - The text to strip matches from
 * @param pattern - The pattern to strip; global flag honoured as `String.replace` does
 * @param offsetWithinMatch - Which position *inside* the match decides quotedness,
 *   as an offset relative to the match start. Defaults to the match start. Needed
 *   when a pattern deliberately matches more than the delimiter it is hunting —
 *   e.g. one that starts at the preceding newline, which sits outside the backtick
 *   span the quoted delimiter lives in, so gating on the match start never fires.
 * @returns `text` with unquoted matches removed
 */
export function replaceOutsideCodeMarkup(
  text: string,
  pattern: RegExp,
  offsetWithinMatch?: (match: string) => number
): string {
  return text.replace(pattern, (...args: unknown[]) => {
    const match = args[0] as string;
    const offset = args.find((arg): arg is number => typeof arg === 'number');
    // Unreachable per the contract above; degrading to 0 keeps the pre-gate
    // behaviour (offset 0 is never inside code markup, so the match strips).
    const probeAt = (offset ?? 0) + (offsetWithinMatch?.(match) ?? 0);
    return isInsideCodeSpan(text, probeAt) ? match : '';
  });
}
