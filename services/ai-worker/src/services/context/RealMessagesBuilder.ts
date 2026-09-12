/**
 * Real Messages Builder
 *
 * Renders a selected conversation-history window as real LangChain messages
 * (PR 2.3 of the prompt-assembly epic, `docs/proposals/backlog/prompt-assembly-architecture.md`
 * §2.3), behind the `realMessagesEnabled` runtime flag. Reuses the XML path's
 * speaker resolution (`resolveSpeakerInfo`) and entry-body renderer
 * (`renderHistoryEntryBody`) so the two containers describe one history
 * identically — this module owns only the ENVELOPE difference: a header line
 * + role assignment instead of XML attributes, and `additional_kwargs` for
 * machine-readable identity.
 */

import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { formatAbsoluteTimestamp } from '@tzurot/common-types/utils/dateFormatting';
import { calculateTimeGap, formatTimeGap, shouldShowGap } from '@tzurot/common-types/utils/timeGap';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  buildHistoryEntryIndex,
  collectPersonalityNames,
  renderHistoryEntryBody,
  type HistoryEntryBodyOptions,
} from '../../jobs/utils/conversationUtils.js';
import {
  resolveSpeakerInfo,
  INVISIBLE_FORMATTING,
  type ChatLogRole,
  type HeaderIdTagMap,
} from '../../jobs/utils/participantUtils.js';
import type { StructuredHistoryEntry } from '../../jobs/utils/conversationTypes.js';

const logger = createLogger('RealMessagesBuilder');

/**
 * The rendered header's structural pieces. Exported patterns below are built
 * from these SAME strings `buildHeaderLine` renders with, so the shape the
 * platform emits and the shapes its consumers hunt for cannot drift apart:
 * a change to the header format breaks
 * `RealMessagesBuilder.test.ts`'s drift guard rather than silently
 * disarming the transform and the output-side strip.
 */
const HEADER_OPEN = '[';
const HEADER_CLOSE = ']';
/**
 * U+2014 EM DASH, spaced. Deliberately the em dash ALONE and not a dash
 * class: a hyphen imitation already fails the form the model learns, and
 * widening to the dash class buys false positives on ordinary prose. Note
 * `sanitizeHeaderName` neutralizes the whole dash CLASS on the NAME side —
 * that is the opposite direction (names may not contribute to the syntax)
 * and is deliberately asymmetric.
 */
const HEADER_SEPARATOR = ' — ';

/**
 * Bound on the decorated preamble `leadingSelfHeaderLineMatcher` tolerates
 * before the self-header bracket — generous enough for a realistic stray
 * tag plus an aside, but finite: an unbounded quantifier immediately before
 * a literal is the catastrophic-backtracking shape `regexp/no-super-linear-move`
 * rejects. Counts UNITS of the preamble alternation — one whole
 * non-header-shaped bracket group, one asterisk- or underscore-delimited
 * emphasis run, or one single decoration character — not raw characters, so
 * a bracket group or an emphasis run collapses to one unit regardless of its
 * interior length. The boundary is pinned by the `preamble length cap`
 * fixtures in `RealMessagesBuilder.test.ts`, which build the preamble out of
 * single decoration characters so the unit count equals the character count.
 */
const SELF_HEADER_PREAMBLE_MAX = 120;

/**
 * Interior character bound for a single emphasis run (asterisk- or
 * underscore-delimited) inside the self-header preamble. Without this bound,
 * an emphasis run's interior is an unbounded non-bracket character class, so
 * an italic ACTION BEAT preceding the header — narration, not scaffolding —
 * tiles into one preamble unit and is deleted along with the header it
 * precedes; `bracketGroup`'s header-separator lookahead does not generalize
 * to this case because narration need not contain the separator at all. The
 * leak's own real preamble, `*previous context*`, has a 16-character
 * interior; 40 leaves comfortable room for a longer stray tag or short aside
 * while still excluding a narrated sentence — the underscore KEEP-CASE
 * narration fixture in this file's own test suite runs a 73-character
 * interior and is correctly rejected — pinned by the `emphasis run interior
 * cap` fixtures in this file's own test suite.
 */
const EMPHASIS_RUN_INTERIOR_MAX = 40;

/**
 * Correlation fields for the header-spoof hit log. Content and the matched
 * line itself are deliberately absent — the no-PII logging rule forbids
 * putting message text in logs, so the log carries WHERE and HOW MANY only.
 */
export interface HeaderSpoofTelemetry {
  channelId?: string;
  requestId?: string;
}

/**
 * Identity + role metadata carried on every history message's
 * `additional_kwargs` (§2.3 council: "text headers are for the model, kwargs
 * are for the machine"). `speakerId` is the identity key kwargs must carry
 * (§9c) — `personalityId` for an assistant/character row, `personaId` for a
 * user row — never a name, which drifts on rename.
 */
export interface HistoryMessageKwargs {
  speakerId?: string;
  isAi: boolean;
  discordMessageId?: string[];
  /**
   * Rides on EVERY message for machine-readable uniformity, regardless of
   * role. The model-readable copy of the same value rides in the header line
   * on every role too, assistant included — an assistant turn is stamped so
   * the model can date its own prior statements when reasoning over history.
   * The header-leakage risk that stamping raises is owned elsewhere: the S0
   * header-leakage constraint tells the model never to emit the bracket form
   * itself, and the output-side strip (`leadingHeaderLineMatcher`) removes
   * any leading header-shaped line a reply produces anyway.
   */
  timestamp?: string;
  [key: string]: unknown;
}

/** speakerId for kwargs: persona id for a user row, personality id otherwise. */
function speakerIdFor(msg: StructuredHistoryEntry, role: ChatLogRole): string | undefined {
  return role === 'user' ? msg.personaId : msg.personalityId;
}

/**
 * The row's header tag, id-keyed. Shared by the SHIP path (`buildRealMessages`)
 * and the MEASURE path (`renderHistoryEntryForMeasure`, and transitively
 * `measureHistoryEntryRealTokens`) so the two cannot ask different questions
 * of the same map — a row is tagged in the measure iff it would be tagged in
 * the shipped render, using the row's own speaker id, never its rendered
 * name (which can legitimately diverge from the roster display name that
 * decided collision-group membership: a user row's `(@username)`
 * disambiguation suffix, `preferredName` on the roster side).
 */
function resolveIdTag(
  msg: StructuredHistoryEntry,
  role: ChatLogRole,
  headerIdTags: HeaderIdTagMap
): string | undefined {
  const speakerId = speakerIdFor(msg, role);
  return speakerId === undefined ? undefined : headerIdTags.get(speakerId);
}

/**
 * Neutralize header-forgery characters in a speaker name. The bracket header
 * is the ONLY structural signal separating "who said what" once history rides
 * as plain-text turns, and persona/personality names are unrestricted beyond
 * length — a crafted name containing `]`, `[`, or a newline could close the
 * header early and forge additional `[Name — timestamp]` turns inside one
 * message. Same threat the XML path answers with `escapeXml` on the `from=`
 * attribute; here brackets become parentheses and line breaks become spaces,
 * which keeps the name readable instead of entity-escaped.
 */
function sanitizeHeaderName(speakerName: string): string {
  return (
    speakerName
      // FIRST: strip the same invisible/formatting class the collision keys
      // strip (single-sourced from participantUtils) — an interposed
      // zero-width renders as nothing but breaks the literal `id:` token the
      // anti-forgery regexes below match, so without this a name like
      // `Lila (i\u200Bd:aaaa)` ships a visually genuine forged tag. Zero
      // display cost: these codepoints have no visible form.
      .replace(INVISIBLE_FORMATTING, '')
      // Fold fullwidth delimiter confusables into their ASCII forms so the
      // strips below see them — same incomplete-sanitization class, visible
      // variant. Only the three delimiter codepoints fold (not full NFKC):
      // the rendered name must otherwise stay recognizable against the
      // roster's un-normalized rendering.
      .replace(/\uFF08/g, '(')
      .replace(/\uFF09/g, ')')
      .replace(/\uFF1A/g, ':')
      .replace(/\[/g, '(')
      .replace(/\]/g, ')')
      .replace(/[\r\n]+/g, ' ')
      // Runs AFTER the bracket conversion above: a persona named `Lila
      // [id:fake]` becomes `Lila (id:fake)` at the two replaces above, and MUST
      // NOT survive as a forged id tag — the platform's own collision tag is
      // appended after this sanitization (see buildHeaderLine), so a name-slot
      // string that merely looks like one must be stripped first.
      .replace(/\(id:[^)]*\)/gi, '')
      // ...and the strip above requires a CLOSING paren, so an unclosed
      // forgery (`Lila [id:dead` → `Lila (id:dead`) would otherwise survive
      // and sit beside the platform's genuine tag as a well-formed-looking
      // `(id:` fragment. Defuse any remaining opener by breaking the tag
      // grammar (colon → hyphen) instead of deleting text — an unclosed
      // fragment has no boundary, so deletion would have to eat the rest of
      // the name.
      .replace(/\(id:/gi, '(id-')
      // The header separator: a name containing a space-dash-space sequence
      // could otherwise fork the header shape by supplying its own timestamp
      // delimiter. Neutralized as a dash CLASS, not just the em dash the
      // platform renders — figure dash, en dash, em dash, horizontal bar and
      // the minus sign all read as the separator to a model even though only
      // U+2014 is ours. The platform owns the header syntax; names may never
      // contribute to it.
      .replace(/ [\u2012\u2013\u2014\u2015\u2212] /g, ' - ')
      // The strips above can leave doubled interior spaces (`Lila (id:fake)` →
      // `Lila ` mid-name) and stray edge whitespace; collapse and trim so the
      // header never renders a double space beside the platform's own tag.
      .replace(/ {2,}/g, ' ')
      .trim()
  );
}

/** The `[Name — timestamp]` header, or `[Name]` when the entry has no usable timestamp.
 *  `idTag` is appended to the SANITIZED name, after every name-derived forgery
 *  vector above has already been neutralized — a name's own text can
 *  therefore never produce or survive as a collision tag. */
function buildHeaderLine(
  speakerName: string,
  createdAt: string | undefined,
  idTag: string | undefined
): string {
  const safeName = sanitizeHeaderName(speakerName);
  const named = idTag === undefined ? safeName : `${safeName} (id:${idTag})`;
  if (createdAt === undefined || createdAt.length === 0) {
    return `${HEADER_OPEN}${named}${HEADER_CLOSE}`;
  }
  return `${HEADER_OPEN}${named}${HEADER_SEPARATOR}${formatAbsoluteTimestamp(createdAt)}${HEADER_CLOSE}`;
}

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Shared line-end tail for both output-side header matchers
 * (`leadingHeaderLineMatcher`, `leadingSelfHeaderLineMatcher`): the closing
 * bracket must be the last non-blank thing on its line — a lookahead requires
 * end-of-line (or end-of-string) after optional trailing spaces/tabs — and
 * the tail then consumes that line break so the header's own newline never
 * survives into the stripped output — pinned at the UNIT tier by the
 * leading-header strip cases in `responseArtifacts.test.ts`, which assert the
 * exact remainder. The seam tier cannot pin this half: stage 2
 * (`stripResponseArtifacts`) trims, so a surviving blank line is invisible
 * there. One shared string so the two matchers' line-end handling cannot
 * drift apart from each other.
 */
const HEADER_LINE_END = '(?=[ \\t]*(?:\\r?\\n|$))[ \\t]*\\r?\\n?';

/** The header shape's regex core: open bracket, bracket-free text, the
 *  separator, bracket-free tail, close bracket. Capture group 1 is the inner
 *  text. Only the TIMESTAMPED form is expressible here — the bare `[Name]`
 *  form carries no separator and is far too generic to hunt for. */
function headerShapeCore(): string {
  const inner = '[^\\[\\]\\r\\n]*';
  return `${escapeForRegExp(HEADER_OPEN)}(${inner}${escapeForRegExp(HEADER_SEPARATOR)}${inner})${escapeForRegExp(HEADER_CLOSE)}`;
}

/**
 * Matches every LINE of a body that is a rendered-header shape, tolerating
 * surrounding whitespace: leading spaces/tabs are captured (group 1) so the
 * replacement can preserve them, and trailing whitespace before end-of-line
 * is allowed via the lookahead — both are invisible in rendered Discord
 * text, so either would otherwise be a zero-effort bypass of the
 * neutralizer. The output-side matcher below carries the same tolerance.
 * A fresh RegExp per call: the `g` flag makes `lastIndex` stateful, and a
 * shared module-level instance would leak that state across calls.
 */
export function headerShapedLineMatcher(): RegExp {
  return new RegExp(`^([ \\t]*)${headerShapeCore()}(?=[ \\t]*\\r?$)`, 'gm');
}

/**
 * Matches a header-shaped line only at the START of a string, together with
 * its trailing line break — the output-side strip's matcher. Tolerates the
 * same invisible surrounding whitespace as the input-side matcher above, and
 * requires the closing bracket to be the last non-blank thing on its line
 * (`HEADER_LINE_END`) — a bracketed em-dash aside followed by same-line prose
 * (`[laughs — really] Anyway, no.`) is therefore left intact rather than
 * truncated at the bracket, pinned by the keep-case fixtures in
 * `responseStripSeam.test.ts`.
 */
export function leadingHeaderLineMatcher(): RegExp {
  return new RegExp(`^[ \\t]*${headerShapeCore()}${HEADER_LINE_END}`);
}

/**
 * Matches a line, at the START of a string only, whose leading run is
 * followed by a header-shaped bracket group whose name field begins with
 * `personalityName`, with the closing bracket the LAST thing on the line —
 * the compound case `leadingHeaderLineMatcher` cannot see, where the model
 * prefixes its own decorated preamble before restamping its own header
 * (`[stray tag] — *aside* — [Name — timestamp]`). The trailing tail
 * (`HEADER_LINE_END`, shared with `leadingHeaderLineMatcher`) requires
 * end-of-line (or end-of-string) immediately after the closing bracket, so
 * same-line prose that merely FOLLOWS a self-named bracketed aside is left
 * untouched — pinned by the narration keep-case in this function's own test
 * suite.
 *
 * Deliberately name-scoped rather than shape-scoped: a shape-only match would
 * delete legitimate character dialogue that happens to end in a bracketed,
 * em-dash-separated aside (a quoted OTHER speaker's header, or an in-fiction
 * label). Missing a compound self-header leaks cosmetic scaffolding; a false
 * strip deletes what the character said — the asymmetry is why this matcher
 * requires the personality's own name as a prefix of the bracket's name
 * field rather than matching on shape alone.
 *
 * The name is matched as a PREFIX (via a bracket-free run after the escaped
 * name, before the separator) rather than the whole field, because the
 * header's rendered name can be the webhook display name
 * (`${displayName}${botSuffix}`) rather than the roster name on a
 * registry-miss fallback — a strict whole-field match would miss that case.
 * The prefix relaxation requires a boundary immediately after the escaped
 * name, and that boundary is a SPACE only — not a bare closing bracket —
 * because this matcher's own bracket group requires the header separator
 * later in the pattern unconditionally: a `]` sitting immediately after the
 * name can never complete a match here regardless, since the bracket-free
 * class between the name and the separator already excludes `]`. A
 * closing-bracket boundary alternative would therefore protect a case this
 * matcher cannot produce, so it is left out; the space boundary stops a
 * prefix only WITHIN a single token — `Anna` does not cross-match
 * `[Annabelle — …]`, pinned by the `Anna`-vs-`Annabelle`-shaped cases in
 * this function's own test suite. It does NOT stop a name that extends the
 * responder's name ACROSS a space: `Anna` still cross-matches
 * `[Anna Belle — …]`, because a multi-word name's own internal separator is
 * also a space, indistinguishable from the boundary the prefix relaxation
 * looks for. That is an accepted consequence of the prefix relaxation —
 * tightening the boundary to reject it would also reject the bot-suffix
 * header shape (`[Name (bot) — …]`) the relaxation exists to cover, so it is
 * left in place. It is tracked as a miss-direction residual of the
 * render-path rebuild. A header naming a genuinely different personality
 * that shares no such prefix relationship remains a known, accepted residual
 * MISS this matcher does not close.
 *
 * A blank (or whitespace-only) `personalityName` returns a matcher that can
 * NEVER match, rather than the bare-shape pattern an empty escaped name
 * would otherwise collapse to. Without this guard, a blank comparand would
 * make the matcher shape-scoped again — exactly the class of deletion the
 * name-scoping above exists to prevent — which is the same failure mode the
 * sibling `resolveAssistantRowRole`/`matchesPersonality` name comparisons
 * guard against for the identical reason.
 *
 * The name is trimmed before it is spliced into the pattern, matching
 * `sanitizeHeaderName`'s own final `.trim()` on the render side — a stored
 * name carrying incidental leading/trailing whitespace renders bare, so an
 * untrimmed comparand would silently never match (pinned by the padded-name
 * cases in the `leadingSelfHeaderLineMatcher` describe block).
 *
 * The name comparison is case-insensitive (the `i` flag), completing the
 * port of `matchesPersonality`'s trim-then-lowercase comparand handling
 * above: the header's rendered name can be `Personality.displayName`, a
 * separate, independently-editable schema field whose case need not track
 * the roster name, so a case-only divergence must still strip — pinned by
 * the STRIP-CASE cases in this function's own test suite. The name-prefix
 * boundary above still guards against a case-folded cross-match: `anna`
 * folded against `Annabelle` remains a non-match because the boundary
 * requires a space immediately after the name, which `b` is not — pinned by
 * the KEEP-CASE case in this function's own test suite. Every other literal
 * in the pattern (brackets, the separator, whitespace) is already caseless,
 * so `i` affects only the name comparison.
 *
 * No `m` flag: with `m`, the trailing lookahead's `$` would mean end-of-LINE
 * rather than end-of-string, and `m` would also make the leading `^` match
 * every line start — stripping a header sitting on a LATER line, which
 * breaks this matcher's own start-of-string anchoring. Flagless, `^` and the
 * lookahead's `$`/`\n` alternation both resolve against the whole string.
 * (`i` above is orthogonal to this: it folds case only, and does not add
 * `m`'s multiline anchoring.)
 *
 * The preamble admits decoration OUTSIDE emphasis delimiters only — a bare
 * letter or digit outside a bracket group or an emphasis run is not a unit,
 * so a first line of ordinary prose that merely ENDS in a self-named
 * bracketed aside cannot be swallowed with its newline, pinned by the
 * prose-then-aside keep-case in this function's own test suite and by its
 * twin over `stripRealMessageEchoArtifacts` in `responseArtifacts.test.ts`.
 * INSIDE an emphasis run, up to `EMPHASIS_RUN_INTERIOR_MAX` characters of
 * ordinary word content is admitted as decoration — the emphasis run is
 * load-bearing rather than cosmetic, since the leak's own preamble carries
 * `*previous context*`, whose interior word characters no other unit shape
 * admits, pinned by the leaked-compound strip cases in both suites. This
 * necessarily also admits a short narrated action beat sitting where the
 * leak's own scaffolding sits (`*sighs softly*`, `*nods*`): the two shapes
 * are structurally identical — one or two space-separated lowercase words
 * inside single-asterisk delimiters — and no character-class or length rule
 * distinguishes them, so a short action beat immediately preceding a
 * self-header is stripped along with it. This is a known, accepted residual
 * of closing the leak, not a KEEP-CASE: pinned by the
 * `accepted residual: short narrated action beat` fixture in this function's
 * own test suite and its twin over `stripRealMessageEchoArtifacts` in
 * `responseArtifacts.test.ts`. The interior is still bounded to
 * `EMPHASIS_RUN_INTERIOR_MAX` characters: unlike `bracketGroup`, an emphasis
 * run carries no header-separator lookahead (narration need not contain the
 * separator at all), so an unbounded interior would let a narrated SENTENCE,
 * not just a short beat, tile into one unit and be swallowed with the
 * header — pinned by the `emphasis run interior cap` fixtures in this
 * function's own test suite, which pin the boundary at the matcher tier
 * only; the strip tier's twin covers the accepted residual above, not the cap.
 *
 * The preamble does NOT tolerate a header-SHAPED bracket group (one
 * containing the header separator): a legitimate quoted OTHER speaker's
 * header preceding a genuine trailing self-header must survive, pinned by
 * the quote-plus-trailing-self-header keep-case in this function's own test
 * suite. A bracket group with no separator (like the leak's own stray tag)
 * still passes as one preamble unit.
 */
export function leadingSelfHeaderLineMatcher(personalityName: string): RegExp {
  const trimmedName = personalityName.trim();
  if (trimmedName.length === 0) {
    // Matches nothing: no input string contains a position where "not
    // immediately followed by the empty string" is true, since the empty
    // string always matches at every position.
    return /(?!)/;
  }
  const escapedName = escapeForRegExp(trimmedName);
  const nonBracketChar = '[^\\[\\]\\r\\n]';
  // A whole bracket group whose interior never forms the header separator — a
  // header-shaped group cannot be skipped past, so it stops the preamble from
  // reaching a later bracket instead of being absorbed as scaffolding.
  const bracketGroup = `\\[(?:(?!${escapeForRegExp(HEADER_SEPARATOR)})${nonBracketChar})*\\]`;
  // Emphasis/scaffolding runs. Word characters are admitted INSIDE the
  // delimiters only, which is what lets the leak's own `*previous context*`
  // pass while bare narration does not. One or two delimiters, so `**bold**`
  // and `__under__` collapse to a single unit like their single-delimiter
  // forms. The interior is bounded by `EMPHASIS_RUN_INTERIOR_MAX` — see that
  // constant's doc comment for why an unbounded interior reopens the exact
  // bug this preamble narrowing exists to close.
  //
  // The delimiter itself is NOT a plain `{1,2}` quantifier: on a failing
  // overall match (no valid trailing header), `{1,2}` on both the opening
  // AND closing delimiter lets the SAME run of bare asterisks/underscores
  // be partitioned into a full preamble in more than one way (e.g. 4
  // delimiter characters as open=2/close=2 or open=1/close=... — every
  // split the engine can construct is a separate backtracking path), and
  // that multiplicity compounds across the outer `{0,SELF_HEADER_PREAMBLE_MAX}`
  // repetition into exponential blowup — measured at 645ms for a 30-character
  // adversarial "asterisks then an incomplete header" input under the plain
  // `{1,2}` form, unmeasurable (<1ms) at 1000 characters under this form.
  // `\*(?:\*)?(?!\*)` picks the SAME one or two characters a plain `{1,2}`
  // would try first, but the trailing negative lookahead makes that the only
  // reading the engine ever considers: it also rejects a delimiter run of
  // three or more characters outright, which a plain `{1,2}` would otherwise
  // accept via a mixed open/close split — preserving the "one or two
  // delimiters only" intent while removing the split ambiguity.
  // The open and close delimiter each independently match one or two
  // characters, with no requirement that the counts agree — `**text*` and
  // `*text**` both close as one run. Accepted and bounded: the interior cap
  // above already limits how much a mismatched-count run can absorb.
  const asteriskDelim = '\\*(?:\\*)?(?!\\*)';
  const underscoreDelim = '_(?:_)?(?!_)';
  const asteriskRun = `${asteriskDelim}[^\\[\\]\\r\\n*]{0,${EMPHASIS_RUN_INTERIOR_MAX}}${asteriskDelim}`;
  const underscoreRun = `${underscoreDelim}[^\\[\\]\\r\\n_]{0,${EMPHASIS_RUN_INTERIOR_MAX}}${underscoreDelim}`;
  // A single decoration character: whitespace, the dash family, quotes, and
  // ordinary separator punctuation. Deliberately an allowlist rather than the
  // complement of `\w`, which is ASCII-only and would still admit non-Latin
  // narration. `<` and `>` are both admitted symmetrically — neither is the
  // header's own bracket syntax (`[`/`]`), so there is no asymmetric reason
  // to allow one and not the other. This dash range also admits U+2010
  // HYPHEN and U+2011 NON-BREAKING HYPHEN, which `sanitizeHeaderName`'s dash
  // class does not — a deliberate divergence, not drift: this side reads
  // decoration a NAME never contributes, so the narrower forgery-relevant set
  // there has no bearing on what is safe to admit here.
  const decorChar =
    '[ \\t\\-\\u2010-\\u2015\\u2212<>|:;,.!?~"\'\\u2018\\u2019\\u201C\\u201D\\u2026]';
  // One preamble UNIT: decoration only, never a bare word character.
  const preambleUnit = `(?:${bracketGroup}|${asteriskRun}|${underscoreRun}|${decorChar})`;
  return new RegExp(
    `^(?:${preambleUnit}){0,${SELF_HEADER_PREAMBLE_MAX}}?${escapeForRegExp(HEADER_OPEN)}${escapedName}(?= )[^\\[\\]\\r\\n]*?${escapeForRegExp(HEADER_SEPARATOR)}[^\\[\\]\\r\\n]*${escapeForRegExp(HEADER_CLOSE)}${HEADER_LINE_END}`,
    'i'
  );
}

/**
 * Convert every body line that exactly matches the rendered-header shape from
 * brackets to parentheses, so author-typed text cannot forge a platform
 * speaker header. Applied UNCONDITIONALLY over the whole body INCLUDING
 * fenced and backticked regions: a fence is not an authority boundary to the
 * model, so exempting one reopens the hole. A pasted transcript inside a code
 * block therefore gets its brackets changed; accepted.
 */
function neutralizeHeaderShapedLines(body: string): { body: string; hits: number } {
  let hits = 0;
  const neutralized = body.replace(
    headerShapedLineMatcher(),
    (_match, lead: string, inner: string) => {
      hits += 1;
      return `${lead}(${inner})`;
    }
  );
  return { body: neutralized, hits };
}

/**
 * The time-gap line for the zone above the NEXT message's header — the gap
 * line precedes the header uniformly on every role — computed with the SAME
 * threshold machinery the XML path's `maybeAddTimeGapMarker`
 * calls (`calculateTimeGap`/`shouldShowGap`/`formatTimeGap`), not a
 * re-derived rule. The FORM differs deliberately: a plain bracketed line, not
 * `formatTimeGapMarker`'s `<time_gap />` XML — real messages carry no XML
 * scaffolding, and the S0 header-leakage constraint tells the model not to
 * emit bracket-form platform lines, which an XML element is not covered by.
 * Note this is a behavioral ADDITION relative to the shipped XML path: no
 * production call site passes a `TimeGapConfig`, so the XML path emits no
 * gap markers today, while this path emits them at the default 1-hour
 * threshold — §2.3 specifies gap lines as part of the real-messages shape.
 */
function gapLineFor(
  previousTimestamp: string | undefined,
  currentTimestamp: string | undefined
): string | undefined {
  if (previousTimestamp === undefined || currentTimestamp === undefined) {
    return undefined;
  }
  const gapMs = calculateTimeGap(previousTimestamp, currentTimestamp);
  return shouldShowGap(gapMs) ? `[time gap: ${formatTimeGap(gapMs)}]` : undefined;
}

/** Options for {@link buildMessageContent}. Bundled rather than positional —
 *  the function already sat at the 5-parameter ceiling before this flag
 *  joined it. */
interface MessageContentOptions {
  gapLine: string | undefined;
  idTag: string | undefined;
  /** This turn's captured kill switch. Off ⇒ the body is byte-identical to
   *  what it was before the transform existed (pinned by the flag-off
   *  byte-parity tests in RealMessagesBuilder.test.ts). */
  neutralizeHeaderSpoof: boolean;
}

/**
 * Compose one entry's message content: an optional time-gap line, then the
 * `[Name — t]` header (every role, assistant included), then the shared
 * body. The assistant header exists so the model can date its own prior
 * turns instead of reasoning over an undated statement; the leakage risk of
 * teaching the model this header shape by example is owned by the S0
 * header-leakage constraint plus the output-side leading-header strip.
 */
function buildMessageContent(
  msg: StructuredHistoryEntry,
  speakerInfo: { speakerName: string; role: ChatLogRole; normalizedRole: string },
  body: string,
  opts: MessageContentOptions
): { content: string; spoofHits: number } {
  const lines: string[] = [];
  if (opts.gapLine !== undefined) {
    lines.push(opts.gapLine);
  }
  lines.push(buildHeaderLine(speakerInfo.speakerName, msg.createdAt, opts.idTag));
  // Strip leading blank lines from the body so the entry's own BODY can never
  // push the header down. The header is not unconditionally line 1 of a turn
  // — a platform time-gap line may legitimately precede it (pushed above) —
  // the invariant here is narrower: nothing AUTHOR-controlled comes before
  // the header, so a body-typed spoof can never occupy the platform slots.
  const trimmedBody = body.replace(/^(?:[ \t]*\r?\n)+/, '');
  const { body: neutralizedBody, hits } = opts.neutralizeHeaderSpoof
    ? neutralizeHeaderShapedLines(trimmedBody)
    : { body: trimmedBody, hits: 0 };
  lines.push(neutralizedBody);
  return { content: lines.join('\n'), spoofHits: hits };
}

/**
 * Render an entry's body and decide whether the row should be skipped
 * entirely (an assistant row whose body renders empty — no metadata sections,
 * nothing to say). Shared by `buildRealMessages` and
 * `renderHistoryEntryForMeasure` so the skip decision cannot drift between
 * what gets SHIPPED and what gets MEASURED: both ask this same question of
 * the same body.
 *
 * Returns `null` for the skip case, the rendered body string otherwise
 * (including the legitimate empty-body case for a non-assistant row, which is
 * not a skip).
 */
function renderBodyOrSkip(
  msg: StructuredHistoryEntry,
  speakerInfo: { speakerName: string; role: ChatLogRole; normalizedRole: string },
  opts: HistoryEntryBodyOptions
): string | null {
  const body = renderHistoryEntryBody(msg, speakerInfo, opts);
  if (speakerInfo.role === 'assistant' && body.length === 0) {
    // An assistant row with a blanked body and no metadata sections has
    // nothing to say. Reachability rests on the explicit `role ===
    // 'assistant'` condition above, not on header presence: every row
    // carries a header line, so the header cannot distinguish this case.
    // The XML path ships an empty <message/> element here, a shape only an
    // XML document can carry — and provider APIs are not verified to accept
    // an empty-content message (some reject it). Skip the row.
    return null;
  }
  return body;
}

/** The one compute site for the body transform's gate — a future third
 *  condition has exactly one place to land. */
function shouldNeutralizeHeaderSpoof(settings: {
  realMessagesEnabled: boolean;
  headerSpoofNeutralizeEnabled: boolean;
}): boolean {
  return settings.realMessagesEnabled && settings.headerSpoofNeutralizeEnabled;
}

/**
 * The per-turn real-message render inputs: this turn's captured flag values
 * and the collision tag map. Bundled rather than threaded as three loose
 * parameters because several signatures on the measure chain already sat at
 * the 5-parameter ceiling.
 */
export interface RealRenderSettings {
  realMessagesEnabled: boolean;
  /** This turn's `headerSpoofNeutralizeEnabled` capture. The body transform
   *  requires BOTH this and `realMessagesEnabled`. */
  headerSpoofNeutralizeEnabled: boolean;
  headerIdTags: HeaderIdTagMap;
}

/**
 * Per-entry inputs for the real-message MEASURE render
 * (`renderHistoryEntryForMeasure` / `measureHistoryEntryRealTokens`). Bundled
 * because the positional form hit the 5-param ceiling once the collision-tag
 * map joined it — not a style preference.
 */
export interface RealMeasureOptions extends RealRenderSettings {
  personalityName: string;
  allPersonalityNames: Set<string> | undefined;
  responderPersonalityId: string | undefined;
}

/**
 * The measure-form render of one history entry: the same body-rendering
 * pipeline `buildRealMessages` uses per entry, WITHOUT the ONE per-window
 * input that only exists once a window is being SHIPPED rather than sized —
 * the dedup index (`historyEntries: undefined`, the same documented
 * convention `measureHistoryEntryTokens` states: budget callers are choosing
 * WHICH entries ship, so the shipped-id set does not exist yet). The
 * inter-message gap line is likewise absent from THIS render (a budget
 * measures entries independently, one at a time; `historyTokenMeasure.ts`
 * charges a separate worst-case gap-line constant instead, since whether
 * THIS entry would actually pay one depends on a neighbour the per-entry
 * measure cannot see) — but the header id-tag IS resolved here, through the
 * same `resolveIdTag` helper `buildRealMessages` uses, because whether this
 * entry gets a tag depends only on its own speaker id and the window-level
 * `headerIdTags` map passed in `opts`, both of which are already in scope at
 * every call site (the map is computed once per turn upstream). Measure-form
 * and ship-form therefore cannot disagree about tagging.
 *
 * Returns '' for a row `resolveSpeakerInfo` declines and for the
 * assistant-empty-body skip — both match what the real-message render would
 * actually ship (nothing), which is the contract `measureHistoryEntryTokens`
 * documents for the XML form.
 */
export function renderHistoryEntryForMeasure(
  msg: StructuredHistoryEntry,
  opts: RealMeasureOptions
): string {
  const { personalityName, allPersonalityNames, responderPersonalityId, realMessagesEnabled } =
    opts;
  const speakerInfo = resolveSpeakerInfo(
    msg,
    personalityName,
    allPersonalityNames,
    responderPersonalityId
  );
  if (speakerInfo === null) {
    return '';
  }

  const body = renderBodyOrSkip(msg, speakerInfo, {
    personalityName,
    historyEntries: undefined,
    allPersonalityNames,
    responderPersonalityId,
    realMessagesEnabled,
  });
  if (body === null) {
    return '';
  }

  const idTag = resolveIdTag(msg, speakerInfo.role, opts.headerIdTags);
  const { content } = buildMessageContent(msg, speakerInfo, body, {
    gapLine: undefined,
    idTag,
    neutralizeHeaderSpoof: shouldNeutralizeHeaderSpoof(opts),
  });
  return content;
}

export interface BuildRealMessagesOptions extends RealRenderSettings {
  personalityName: string;
  responderPersonalityId: string | undefined;
  /**
   * Correlation fields for the header-spoof hit log. PRESENCE is what
   * distinguishes the SHIP call from the MEASURE call: the measure path
   * renders the same content to size it, so logging there would double-count
   * every hit. Ship callers pass it; measure callers omit it.
   */
  telemetry?: HeaderSpoofTelemetry;
}

/**
 * Build the real-message form of a selected history window: one
 * `HumanMessage`/`AIMessage` per entry, in chronological order (the same
 * order `selectedEntries` already arrives in — see
 * `ContextWindowManager.selectCurrentChannelEntries`'s newest-first walk with
 * `unshift`).
 *
 * A row `resolveSpeakerInfo` declines (a `system`/unknown role) contributes
 * no message — the same skip the XML path applies.
 *
 * Deliberately NO merging of consecutive same-role messages (§2.3, resolved
 * by fact-check: the current API set auto-combines same-role turns
 * server-side where required, and doing it ourselves would cost Discord's
 * rapid-fire rhythm cues and cache-prefix granularity). A live probe
 * confirmed z.ai-direct and OpenRouter both accept and reason over
 * consecutive `user` messages (record: prompt-assembly-architecture.md §9c).
 * If a future provider in this stack DOES require alternation, the
 * merge belongs at this per-entry push — the seam is named here so it has an
 * obvious home rather than being invented at the call site.
 */
export function buildRealMessages(
  selectedEntries: StructuredHistoryEntry[],
  opts: BuildRealMessagesOptions
): BaseMessage[] {
  const { personalityName, responderPersonalityId, realMessagesEnabled, headerIdTags, telemetry } =
    opts;

  if (selectedEntries.length === 0) {
    return [];
  }

  // Scoped to the SELECTED window, matching the XML path's shipped-render
  // scope exactly (`formatConversationHistoryAsXml` builds both from its
  // `history` parameter, which is the same selected subset at the call site
  // in `ContextWindowManager.selectCurrentChannelEntries`).
  const historyEntries = buildHistoryEntryIndex(selectedEntries);
  const allPersonalityNames = collectPersonalityNames(selectedEntries, personalityName);

  const messages: BaseMessage[] = [];
  let previousTimestamp: string | undefined;
  let totalSpoofHits = 0;
  const neutralizeHeaderSpoof = shouldNeutralizeHeaderSpoof(opts);

  for (const msg of selectedEntries) {
    const speakerInfo = resolveSpeakerInfo(
      msg,
      personalityName,
      allPersonalityNames,
      responderPersonalityId
    );
    if (speakerInfo === null) {
      continue;
    }

    const gapLine = gapLineFor(previousTimestamp, msg.createdAt);
    // Checked on the BODY, before the gap line joins: a >1h gap must not
    // rescue an otherwise-empty row into a gap-marker-only AIMessage. The gap
    // baseline below stays on the last message the model actually sees.
    const body = renderBodyOrSkip(msg, speakerInfo, {
      personalityName,
      historyEntries,
      allPersonalityNames,
      responderPersonalityId,
      realMessagesEnabled,
    });
    if (body === null) {
      continue;
    }

    // Resolve this row's header tag by ID, never by name — the same lookup
    // `resolveIdTag` performs for the measure path (`renderHistoryEntryForMeasure`),
    // so ship-form and measure-form cannot disagree about tagging. Inlined
    // here (rather than calling `resolveIdTag`) only to reuse the ONE
    // `speakerIdFor` call this loop already needs for `kwargs.speakerId` —
    // calling `resolveIdTag(msg, speakerInfo.role, headerIdTags)` here would
    // recompute `speakerIdFor` a second time for no benefit.
    const speakerId = speakerIdFor(msg, speakerInfo.role);
    const idTag = speakerId === undefined ? undefined : headerIdTags.get(speakerId);

    const { content, spoofHits } = buildMessageContent(msg, speakerInfo, body, {
      gapLine,
      idTag,
      neutralizeHeaderSpoof,
    });
    totalSpoofHits += spoofHits;

    const kwargs: HistoryMessageKwargs = {
      speakerId,
      isAi: speakerInfo.role !== 'user',
      discordMessageId: msg.discordMessageId,
      timestamp: msg.createdAt,
    };

    messages.push(
      speakerInfo.role === 'assistant'
        ? new AIMessage({ content, additional_kwargs: kwargs })
        : new HumanMessage({ content, additional_kwargs: kwargs })
    );

    // Only a rendered entry advances the gap baseline — the null-speaker skip
    // mirrors `formatConversationHistoryAsXml`, and the empty-content skip
    // above (new to this path) deliberately behaves the same way: the next
    // gap line measures from the last message the model actually SEES, not
    // from a row that rendered nothing.
    if (msg.createdAt !== undefined) {
      previousTimestamp = msg.createdAt;
    }
  }

  if (telemetry !== undefined && totalSpoofHits > 0) {
    logger.warn(
      { channelId: telemetry.channelId, requestId: telemetry.requestId, hits: totalSpoofHits },
      'Neutralized header-shaped lines in real-message body content'
    );
  }

  return messages;
}

/**
 * The `<prior_conversations>` XML as its own leading `HumanMessage` (§9c
 * council-adopted refinement of §2.3): cross-channel history renders BEFORE
 * the current-channel real messages, in its own user-role turn, so S0+S1
 * stays 100% stable and cross-channel churn invalidates only from its own
 * position. Content ships VERBATIM — no re-serialization, no restructuring
 * (explicitly ruled out, §9c). Omitted entirely when the XML is empty
 * (cross-channel disabled, or nothing fit the budget).
 */
export function buildCrossChannelMessage(crossChannelXml: string): HumanMessage | undefined {
  return crossChannelXml.length > 0 ? new HumanMessage(crossChannelXml) : undefined;
}
