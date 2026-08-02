/**
 * Raw CLI argument extraction — the snowflake-precision escape hatch.
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
