/**
 * Markdown link parsing for the backlog link gate.
 *
 * Split out of `backlogLint.ts` when that file crossed `max-lines`: the seam is
 * a natural one, since nothing here knows about the backlog surfaces — it turns
 * markdown text into destinations, and the gate decides what to do with them.
 */

/**
 * Blank out fenced code blocks and inline code spans before link extraction.
 *
 * These files are documentation ABOUT documentation, so a doc explaining link
 * conventions writes markdown-link syntax as an EXAMPLE. Extracting from those
 * would report a dangling link against text that was never a link — a failure
 * that looks like real rot and blocks everyone's `pnpm quality`, which is worse
 * than any of the shapes this extractor merely fails to see.
 *
 * Assumes BALANCED delimiters, and fails SILENTLY when they are not. An odd
 * number of inline backticks makes the span regex pair the wrong two, so a run
 * of real prose is blanked along with any links inside it — measured: in
 * ``a `span here and [t](../real.md) then `another` tail``, the real
 * `../real.md` link is swallowed and never checked. Pinned in markdownLinks.test.ts § `documented parse limitations`.
 */
function stripCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

/**
 * True when `target` addresses a file relative to the document containing it.
 *
 * A dot prefix is NOT required — CommonMark treats `[t](foo.md)` as relative
 * exactly like `[t](./foo.md)`, and the bare form is the dominant style for
 * sibling cross-references in `tracker/docs/`. Scoping to the dotted forms
 * alone made this check blind to that whole class.
 *
 * A bare target additionally has to look like a FILE — a `.ext` suffix
 * carrying at least one LETTER. That is what keeps ordinary bracketed prose
 * from being resolved as a path, and the letter requirement specifically keeps
 * a version string out: `[v3](v3.0.0-beta.199)` ends in `.199`, which is
 * extension-SHAPED but is not a file, and this corpus is release-note-heavy
 * enough for that to be a plausible link. Ruled out entirely: bare fragments,
 * root-relative paths, and anything carrying a URI scheme (`https:`, `mailto:`).
 */
function isRelativeFileTarget(target: string): boolean {
  if (target === '' || target.startsWith('/')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false;
  if (target.startsWith('./') || target.startsWith('../')) return true;
  const extension = /\.([a-z0-9]+)$/i.exec(target)?.[1];
  return extension !== undefined && /[a-z]/i.test(extension);
}

/**
 * Extract every markdown link target (`[text](target)`) that resolves relative
 * to the containing document — dot-prefixed or bare — with any
 * trailing `#fragment` stripped — the caller resolves the file, not the
 * anchor. Absolute URLs, `mailto:`, and bare `#anchor` targets are skipped.
 *
 * Image links (`![alt](target)`) match the same `[…](…)` shape and are
 * intentionally included — a dead image path rots the same way a dead doc
 * link does, and tracker markdown carries no images today to special-case.
 *
 * Known shapes this deliberately does not parse, none of which occurs in the
 * scanned content today. Deliberately NOT numbered: a running count in this
 * docstring drifted the moment a shape was added and again when one was fixed,
 * and a stale count reads as authoritative.
 *
 * These fail LOUD, the tolerable direction — whoever writes one sees a
 * confusing-but-visible report and can look here:
 *
 * - a target containing a literal `)` (`[t](../notes(draft).md)`) truncates at
 *   that paren, so it is reported dangling against a mangled path. The example
 *   is deliberately UNSPACED: add whitespace before the paren and the
 *   destination routes to the non-rendering bucket instead, because whitespace
 *   is what decides that branch. Both halves are pinned in the limitations test.
 *
 * These fail SILENT, which is worse, because a genuinely dead link in one of
 * these shapes is simply never seen:
 *
 * - link text containing nested brackets (`[a [b]](../x.md)`) matches nothing;
 * - reference-style links (`[t][ref]` with `[ref]: ../foo.md` elsewhere) are
 *   not the inline shape this regex looks for at all;
 * - an angle-wrapped target carrying BOTH a space and a literal `)`
 *   (`[t](<foo (bar).md>)`) truncates before its closing `>`, so it reads as
 *   unwrapped, and the truncation leaves no file-shaped segment for
 *   `looksLikeIntendedPath` — it lands in neither bucket. A compound of three
 *   limitations that are individually documented above; measured, not traced.
 *
 * Closing the silent set needs a real markdown-link parser rather than a wider
 * regex, which is why the disclosure is here instead.
 *
 * One shape fails loud in the OTHER direction — an over-match, not a miss.
 * `isRelativeFileTarget` accepts any bare target ending in `.letters`, so a
 * bracket-paren pair wrapped around a bare domain or a dotted product name is
 * resolved as a sibling path and reported dangling: measured, `[docs](example.com)`
 * yields `example.com` and `[runtime](Node.js)` yields `Node.js`. Narrowing is
 * not available, because the accepting rule is the same one that admits
 * `[t](foo.md)` — the dominant sibling-link style in this corpus — and `js`,
 * `io`, and `sh` are real file extensions as much as they are real TLDs.
 * Backticking the text is the workaround (`stripCode` blanks it), and it works
 * whether the backticks wrap the whole link or just the target; both measured.
 * Demonstrated rather than hypothetical: the first draft of the task that filed
 * this limitation wrote those two examples in link form, and the gate reported
 * both as dangling within minutes. Pinned in markdownLinks.test.ts § `documented parse limitations`.
 * @internal Exported for testing
 */
export function extractRelativeLinks(markdown: string): string[] {
  return parseLinkDestinations(markdown).resolvable;
}

/**
 * Raw destinations that CommonMark will not render as links at all.
 *
 * Verified against GitHub's own renderer via the `/markdown` API — the system
 * that actually renders these files, rather than a second CommonMark
 * implementation that merely ought to agree: `[t](doc - x.md)` comes back as
 * the literal text `[t](doc - x.md)`, while both `[t](<doc - x.md>)` and
 * `[t](doc%20-%20x.md)` come back as anchors. Every filename under `tracker/`
 * carries spaces, so the unwrapped form is the one an author reaches for first
 * and the one that silently produces no link.
 *
 * The same probe settles `+`: GitHub returns `href="my+notes.md"` unchanged, so
 * `+` is a literal character in a path segment, not an encoded space. Decoding
 * it would break a file genuinely named that way.
 * @internal Exported for testing
 */
export function extractNonRenderingLinks(markdown: string): string[] {
  return parseLinkDestinations(markdown).nonRendering;
}

/**
 * Drop an optional link title trailing the destination — `[t](foo.md "Title")`.
 * `marked` parses the title as a separate field, so it is not part of the path
 * and must come off before the destination is judged. Only the quoted forms are
 * handled: the parenthesized form (`(Title)`) cannot survive the destination
 * regex above, which stops at the first `)`.
 *
 * Scanning rather than matching, deliberately. The natural regex for this
 * (`/\s+(?:"[^"]*"|'[^']*')$/`) is super-linear — `regexp/no-super-linear-move`
 * rejects it, because a long whitespace run followed by a non-matching suffix
 * makes the engine retry from every start position.
 *
 * The whitespace separator is required: without it the quotes are part of the
 * filename, not a title (`foo'.md'` keeps its quotes).
 */
function stripLinkTitle(raw: string): string {
  const quote = raw.at(-1);
  if (quote !== '"' && quote !== "'") return raw;
  const open = raw.lastIndexOf(quote, raw.length - 2);
  if (open < 1) return raw;
  const destination = raw.slice(0, open).trimEnd();
  if (destination === '' || destination.length === open) return raw;
  return destination;
}

export interface ParsedLinks {
  /** Destinations to resolve against the filesystem. */
  readonly resolvable: string[];
  /** Destinations whose unbracketed whitespace stops them being links. */
  readonly nonRendering: string[];
}

/**
 * Single pass over the `[…](…)` shapes, sorting each destination into the two
 * outcomes the gate reports on.
 *
 * The normalization order is load-bearing. Title-stripping runs first so a
 * titled link's space is not read as a path space. Angle-unwrapping runs
 * before the fragment strip, because stripping first would leave `<foo.md`
 * from `<foo.md#sec>` — closing bracket gone, resolving against nothing
 * (measured before the fix). Percent-decoding runs last so a `%23` inside a
 * filename can never be mistaken for the fragment delimiter.
 */
export function parseLinkDestinations(markdown: string): ParsedLinks {
  const resolvable: string[] = [];
  const nonRendering: string[] = [];
  const prose = stripCode(markdown);
  const pattern = /\[[^[\]]*\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prose)) !== null) {
    const raw = stripLinkTitle(match[1].trim());
    const angled = raw.startsWith('<') && raw.endsWith('>');
    if (!angled && /\s/.test(raw)) {
      // Judged on the fragment-stripped form, reported whole. The resolvable
      // branch below strips before judging for the same reason: an anchor makes
      // the last segment `Theme.md#sec`, which no extension test can match, so
      // judging the raw form drops a heading link to a spaced file entirely.
      if (looksLikeIntendedPath(raw.split('#')[0])) {
        nonRendering.push(raw);
      }
      continue;
    }
    const target = decodePath((angled ? raw.slice(1, -1) : raw).split('#')[0]);
    if (isRelativeFileTarget(target)) {
      resolvable.push(target);
    }
  }
  return { resolvable, nonRendering };
}

/**
 * True when a spaced destination was plausibly MEANT to be a path.
 *
 * The resolvable branch is gated by `isRelativeFileTarget`, which is what keeps
 * ordinary bracketed prose from being reported as rot — `[see the epic](whatever
 * we call it)` is an idiom, not a dead link. The non-rendering branch needs its
 * own gate for the same reason, or it re-opens that false-positive class from
 * the other side, with a message about angle-wrapping a filename that is not one.
 *
 * `isRelativeFileTarget` can't be applied to the whole string: it sees the
 * spaces and nothing else changes, so `whatever we call it` and
 * `doc-20 - Theme.md` both fail its extension test. Testing each
 * whitespace-delimited SEGMENT is what separates them — `Theme.md` is
 * file-shaped, `it` is not. The dot-prefix check is separate because
 * `../notes (draft` (the literal-paren truncation) has no file-shaped segment
 * at all, and dropping it would trade this false positive for a silent miss.
 *
 * Per-segment testing needs the scheme check applied to the WHOLE string,
 * though: in `https://example.com/some page.md` the scheme segment is correctly
 * rejected, but `page.md` still matches, so the target would be reported as a
 * repo-relative path and advised to percent-encode its spaces. It is a broken
 * external URL. This gate never checks external URLs, so it is passed over
 * here for the same reason `isRelativeFileTarget` passes over them.
 *
 * Expects the fragment already stripped — see the call site.
 */
function looksLikeIntendedPath(raw: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  if (raw.startsWith('./') || raw.startsWith('../')) return true;
  return raw.split(/\s+/).some(isRelativeFileTarget);
}

/**
 * Percent-decode a destination, falling back to the raw form when it cannot be
 * decoded. `decodeURIComponent` throws `URIError` on a malformed escape (`%zz`,
 * a lone `%` — both probed); returning the raw string keeps such a target in
 * the resolvable set, so it reports dangling rather than vanishing from the
 * gate entirely.
 */
function decodePath(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}
