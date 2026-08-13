/**
 * CLI argument parsing helpers: raw-argv extraction (the snowflake-precision
 * escape hatch) and validated numeric-flag coercion.
 *
 * cac (via mri) coerces digit-only option values to Number at TOKENIZE time,
 * before any type declaration applies. A Discord snowflake (17-20 digits)
 * exceeds Number.MAX_SAFE_INTEGER, so the parsed value arrives silently
 * corrupted in its low digits — it still LOOKS like a snowflake and passes
 * shape validation, then queries the wrong row. Runtime-verified:
 * `--channel 123456789012345678` parses as 123456789012345680, with
 * `{ type: [String] }` making no difference (stringified AFTER coercion).
 *
 * Commands taking snowflake-valued options must read them from the raw argv
 * with this helper instead of the parsed options object.
 */

import { UsageError } from './errors.js';

/**
 * Read `--flag value` or `--flag=value` verbatim from an argv array.
 * Returns undefined when the flag is absent or has no value token.
 *
 * Matches cac's camelCase spelling of the same option as well as the kebab one
 * (`--jobId` alongside `--job-id`). cac normalizes every option name to
 * camelCase, so both spellings parse to the same key and NEITHER is rejected as
 * unknown — which means a scan for the literal kebab token alone returns
 * undefined for a camelCase invocation, and the command then runs with the
 * filter silently absent while looking entirely successful. Probe-verified
 * against cac 7.0.0: `--job-id abc` and `--jobId abc` both yield
 * `{ jobId: 'abc' }`.
 *
 * @throws UsageError when the flag appears more than once. cac collects
 *   repeated occurrences into an ARRAY, so returning the first here would
 *   silently disagree with the parser — and on `retention:purge --exclude`
 *   that disagreement is a quietly NARROWED protection list on an irreversible
 *   purge. Refusing is the fail-closed reading.
 */
export function rawOptionValue(argv: string[], flag: string): string | undefined {
  const spellings = new Set([flag, camelCaseSpelling(flag)]);
  const values: (string | undefined)[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (spellings.has(arg)) {
      const next = argv[i + 1];
      values.push(next !== undefined && !next.startsWith('--') ? next : undefined);
      continue;
    }
    // Compare the segment BEFORE the `=` rather than prefix-matching the whole
    // arg, so `--channel-id=1` still does not answer a scan for `--channel`.
    const equals = arg.indexOf('=');
    if (equals > 0 && spellings.has(arg.slice(0, equals))) {
      values.push(arg.slice(equals + 1));
    }
  }

  if (values.length > 1) {
    // Deliberately says nothing about list syntax: only `--exclude` accepts
    // several values, and its own option help already calls itself
    // comma-separated. Mentioning lists here would send the operator of the
    // other six single-value flags looking for a syntax they do not have.
    throw new UsageError(`${flag} was given ${values.length} times; pass it once`);
  }
  return values[0];
}

/**
 * cac's camelCase spelling of a kebab-case flag (`--job-id` → `--jobId`).
 *
 * A single-word flag comes back unchanged, which is harmless: the scan walks
 * argv and tests each element for membership, so a spelling listed twice is
 * still one match per argument. (The `Set` is for lookup, not deduplication —
 * an array behaves identically here, confirmed by canary.)
 *
 * Hyphen-only on purpose. cac does NOT treat `_` as a word separator: probed
 * against cac 7.0.0, `--job_id` on an option declared `--job-id <id>` throws
 * ``Unknown option `--job_id` `` rather than parsing to `jobId`. Widening this
 * to `[-_]` would make the scan answer for a spelling the parser rejects,
 * which is this bug's own failure mode pointed the other way.
 *
 * `codegen/command-types.ts` has a similar-looking `toCamelCase`. They are NOT
 * interchangeable and should not be merged: that one turns an option name into
 * a TypeScript property name, this one reconstructs a spelling the PARSER will
 * accept, so its character class is answerable to cac's behavior rather than to
 * what makes a valid identifier.
 *
 * Takes the `--`-prefixed form every call site passes.
 */
function camelCaseSpelling(flag: string): string {
  return `--${flag.slice(2).replace(/-([a-z0-9])/g, match => match[1].toUpperCase())}`;
}

/** Accepted range for a numeric flag. `max` is omitted when none applies. */
export interface IntFlagRange {
  /** Smallest accepted value, inclusive. */
  min: number;
  /** Largest accepted value, inclusive. */
  max?: number;
}

/**
 * Coerce a numeric CLI flag to an integer, throwing a flag-named error when
 * the value is not one.
 *
 * Bare `Number(options.x)` is unsafe as a flag parser: `Number('abc')` is NaN
 * and EVERY comparison against NaN is false, so a downstream `if (n > cap)`
 * guard silently passes and the typo'd flag ignores itself instead of
 * erroring — a run that was meant to be capped executes uncapped. `Number`
 * also accepts floats and `Number('')` is 0, both of which read as valid to a
 * later `> 0` check.
 *
 * `raw` is typed to accept `number` as well as `string` because cac (via mri)
 * number-coerces digit-only option values at tokenize time, so a flag
 * declared as a string can still arrive as a number.
 *
 * Returns `undefined` for an absent flag, so an optional flag stays optional.
 *
 * @throws UsageError naming the flag when the value is present but not an integer
 *   within `range`.
 */
export function parseIntFlag(
  raw: string | number | undefined,
  flag: string,
  range: IntFlagRange
): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const text = String(raw).trim();
  // Shape-check before coercing, because `Number` accepts several spellings
  // that are integers by the time `Number.isInteger` sees them but are not
  // what an operator typed on purpose: `1e2` → 100, `0x10` → 16, `0b11` → 3,
  // and `''`/`'  '` → 0. Silently reading `--limit 1e2` as 100 is the same
  // class of quiet misinterpretation this helper exists to end, so the
  // literal decimal form is the only accepted one.
  const value = /^-?\d+$/.test(text) ? Number(text) : Number.NaN;

  if (!Number.isInteger(value)) {
    throw new UsageError(`${flag} must be an integer, got: "${String(raw)}"`);
  }
  // The shape check above guarantees a decimal integer STRING, but a long
  // enough one still lands on an imprecise float — `Number.isInteger` reports
  // true for it, so the value would be silently rounded. This is the shared
  // choke point for numeric CLI parsing, so it rejects rather than rounds.
  if (!Number.isSafeInteger(value)) {
    throw new UsageError(
      `${flag} is too large to represent exactly, got: "${String(raw)}" (max ${String(Number.MAX_SAFE_INTEGER)})`
    );
  }
  // Range messages quote `raw`, not the coerced value: `--limit 007` should
  // echo back what was typed, so the operator can spot the typo in their own
  // command line rather than in a normalized form they never wrote.
  if (value < range.min) {
    throw new UsageError(`${flag} must be at least ${range.min}, got: ${String(raw)}`);
  }
  if (range.max !== undefined && value > range.max) {
    throw new UsageError(`${flag} must be at most ${range.max}, got: ${String(raw)}`);
  }
  return value;
}
