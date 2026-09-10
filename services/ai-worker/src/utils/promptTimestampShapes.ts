/**
 * Prompt-timestamp bracket shapes.
 *
 * Defines the single regex the generic response-artifact pass uses to strip
 * an echoed prompt timestamp from the start of a reply. The bracket's WHOLE
 * interior must be a string one of the prompt-facing time formatters in
 * `@tzurot/common-types/utils/dateFormatting` actually emits. A sweep of the
 * ai-worker prompt call sites found no other time shape shown to the model;
 * a prompt-facing formatter added later is NOT covered until listed here:
 *
 * - `formatRelativeTime` — "just now" / "5m ago" / "3h ago" / "2d ago" /
 *   an ISO date (>= 7 days)
 * - `formatRelativeTimeDelta` — "just now" / "5 minutes ago" / "yesterday" /
 *   "3 days ago" / "2 weeks ago" / "3 months ago" / "2 years ago" /
 *   "in the future" (also the trailing clause of `formatPromptTimestamp`)
 * - `formatAbsoluteTimestamp` — "YYYY-MM-DD (Tue) HH:MM"
 * - `formatPromptTimestamp` — "YYYY-MM-DD (Tue) HH:MM • 2h ago", or with the
 *   time dropped at the 7-day boundary: "YYYY-MM-DD (Fri) • 2 months ago"
 * - `formatMemoryTimestamp` — "Mon, Jan 27, 2025"
 * - `formatFullDateTime` — "Monday, January 27, 2025, 02:45 AM EST"
 *
 * Deliberately NOT matched:
 * - A weekday+clock compound with no formatter behind it, e.g. `[Sat 18:19]`
 *   — no formatter in this module emits that shape, and stripping it would
 *   also strip the other-speaker compound-header keep-case this pass must
 *   preserve. Pinned by the `[Sat 18:19] Hello` keep fixture.
 * - A bare `[now]` — every "now" formatter output is "just now", never bare
 *   "now". Pinned by the `[now] hello` keep fixture.
 * - Case variants like `[Just now]` — the formatters always lowercase "just
 *   now"; a differently-cased bracket interior is not a formatter output.
 *   Pinned by the `[Just now] hi` keep fixture.
 * - A duration, e.g. the `<time_gap duration>` marker — a duration names a
 *   SPAN, not a point-in-time timestamp, and no formatter above renders one
 *   bracketed at the start of a turn. Pinned by the `[3 hours] later` keep
 *   fixture.
 *
 * Structurally, every family alternative uses only bounded quantifiers; the
 * only unbounded quantifier in the whole pattern is the trailing `\s*` that
 * absorbs separator whitespace after the bracket. This keeps the pattern
 * immune to catastrophic backtracking on adversarial input — pinned by the
 * adversarial-input timing tests in promptTimestampShapes.test.ts.
 *
 * This pattern runs through `replaceOutsideCodeMarkup` via `patternStep` in
 * `responseArtifacts.ts`, exactly like its sibling artifact-strip patterns —
 * matches inside fenced/backticked code are left alone. The same module also
 * imports `PROMPT_TIMESTAMP_BRACKET_SOURCE` directly to compose it into the
 * name-prefix step, so both leading-bracket deletions in that file share one
 * vocabulary.
 */

const WEEKDAY_SHORT = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
const WEEKDAY_LONG = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)';
const MONTH_SHORT = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const MONTH_LONG =
  '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const ISO_DATE = '\\d{4}-\\d{2}-\\d{2}';
const CLOCK_24 = '\\d{2}:\\d{2}';
const COUNT = '\\d{1,4}';

/** `formatRelativeTime`: "just now" / "5m ago" / "3h ago" / "2d ago" / an ISO date fallback. */
const RELATIVE_COMPACT = `just now|${COUNT}[mhd] ago|${ISO_DATE}`;

/**
 * `formatRelativeTimeDelta` — also the trailing clause of
 * `formatPromptTimestamp` after its `•` separator.
 */
const RELATIVE_DELTA = `just now|yesterday|in the future|${COUNT} (?:minute|hour|day|week|month|year)s? ago`;

/** `formatAbsoluteTimestamp`: "YYYY-MM-DD (Tue) HH:MM". */
const ABSOLUTE = `${ISO_DATE} \\(${WEEKDAY_SHORT}\\) ${CLOCK_24}`;

/**
 * `formatPromptTimestamp`: the time component drops at the >= 7 days
 * boundary, so the clock is optional here.
 */
const PROMPT = `${ISO_DATE} \\(${WEEKDAY_SHORT}\\)(?: ${CLOCK_24})? • (?:${RELATIVE_DELTA})`;

/** `formatMemoryTimestamp`: "Mon, Jan 27, 2025". */
const MEMORY = `${WEEKDAY_SHORT}, ${MONTH_SHORT} \\d{1,2}, \\d{4}`;

/**
 * `formatFullDateTime`: "Monday, January 27, 2025, 02:45 AM EST". Node 24's
 * ICU (77.1, observed) renders ' at ' before the time, which the
 * formatFullDateTime fixtures in promptTimestampShapes.test.ts exercise; the
 * ', ' form is the formatter's documented example and is kept for other ICU
 * builds (not exercised on this runtime). The space before AM/PM allows both
 * an ordinary space and ICU's narrow no-break space (U+202F). The zone is
 * either a short abbreviation (EST, GMT) or a `GMT[+-]H[:MM]` offset form.
 */
const FULL = `${WEEKDAY_LONG}, ${MONTH_LONG} \\d{1,2}, \\d{4}(?:,| at) \\d{2}:\\d{2}[ \\u202f](?:AM|PM) (?:[A-Z]{2,5}|GMT[+-]\\d{1,2}(?::\\d{2})?)`;

/**
 * The bracket-interior vocabulary, unanchored and with no trailing
 * whitespace absorption: the single definition of which prompt
 * time-formatter outputs count as a leading-bracket timestamp. Every
 * consumer composes its own anchoring (`^`) and trailing `\s*` around this
 * source string rather than restating the alternation, so the vocabulary
 * cannot drift between call sites.
 */
export const PROMPT_TIMESTAMP_BRACKET_SOURCE = `\\[(?:(?:${RELATIVE_COMPACT})|(?:${RELATIVE_DELTA})|(?:${ABSOLUTE})|(?:${PROMPT})|(?:${MEMORY})|(?:${FULL}))\\]`;

/**
 * Strips a leading `[...]` bracket whose whole interior is a prompt
 * time-formatter output. See the module doc comment for the exact
 * vocabulary and what is deliberately excluded.
 */
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: an immutable non-global RegExp, whose lastIndex String.replace and RegExp.test never read or write, so one shared instance is safe; exported for responseArtifacts.ts and the shape tests in promptTimestampShapes.test.ts.
export const PROMPT_TIMESTAMP_BRACKET_PATTERN = new RegExp(
  `^${PROMPT_TIMESTAMP_BRACKET_SOURCE}\\s*`
);
