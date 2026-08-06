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

/**
 * Read `--flag value` or `--flag=value` verbatim from an argv array.
 * Returns undefined when the flag is absent or has no value token.
 */
export function rawOptionValue(argv: string[], flag: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === flag) {
      const next = argv[i + 1];
      return next !== undefined && !next.startsWith('--') ? next : undefined;
    }
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return undefined;
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
 * @throws Error naming the flag when the value is present but not an integer
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
    throw new Error(`${flag} must be an integer, got: "${String(raw)}"`);
  }
  // The shape check above guarantees a decimal integer STRING, but a long
  // enough one still lands on an imprecise float — `Number.isInteger` reports
  // true for it, so the value would be silently rounded. This is the shared
  // choke point for numeric CLI parsing, so it rejects rather than rounds.
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `${flag} is too large to represent exactly, got: "${String(raw)}" (max ${String(Number.MAX_SAFE_INTEGER)})`
    );
  }
  // Range messages quote `raw`, not the coerced value: `--limit 007` should
  // echo back what was typed, so the operator can spot the typo in their own
  // command line rather than in a normalized form they never wrote.
  if (value < range.min) {
    throw new Error(`${flag} must be at least ${range.min}, got: ${String(raw)}`);
  }
  if (range.max !== undefined && value > range.max) {
    throw new Error(`${flag} must be at most ${range.max}, got: ${String(raw)}`);
  }
  return value;
}

/**
 * `parseIntFlag` for commands that report usage errors by printing and
 * setting `exitCode` rather than throwing — the dominant convention among the
 * `ops` commands that take numeric input.
 *
 * Returns the parsed integer, `undefined` for an absent optional flag, or
 * `null` when the value was present but invalid (having already printed the
 * error and set `exitCode`). The caller returns on `null`.
 *
 * The three-way return is what lets a caller distinguish "flag omitted, use
 * the default" from "flag given but unusable, abort" — collapsing them would
 * silently run an invalid flag under the default, which is the failure this
 * whole helper exists to prevent.
 */
export function parseIntFlagOrReport(
  raw: string | number | undefined,
  flag: string,
  range: IntFlagRange
): number | undefined | null {
  try {
    return parseIntFlag(raw, flag, range);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return null;
  }
}
