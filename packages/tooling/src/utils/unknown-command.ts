/**
 * What to do when cac matched no command.
 *
 * cac dispatches to a registered command, a default command, or nothing. This
 * CLI registers no default, so an unmatched name falls through
 * `runMatchedCommand()` as a silent no-op: `pnpm ops no:such:command` printed
 * nothing and exited 0, making an operator typo indistinguishable from success.
 * Nothing throws, so the top-level UsageError handler never saw it.
 *
 * Three distinct no-match cases, and they want different outcomes:
 *
 * - **A name was given and matched nothing** — a mistake the operator can fix by
 *   retyping, which is exactly what `UsageError` is for: one line, exit 1.
 * - **No name was given, but unrecognized flags were** (`pnpm ops --bogus-flag`)
 *   — cac validates unknown options only against a MATCHED command, so with no
 *   command name nothing rejects the flag. Also an operator mistake, same
 *   `UsageError` treatment.
 * - **No name and no unrecognized flags** (`pnpm ops`) — not a mistake, just an
 *   incomplete invocation. Print help and exit 0, the way every other CLI does.
 *
 * `--help` and `--version` also leave `matchedCommand` unset (cac unsets it
 * after printing), so both are excluded — otherwise `pnpm ops db:status --help`
 * would print help and then error.
 */

/**
 * The only option keys valid on the global (no-command) invocation — what
 * `cli.help()` / `cli.version()` register in `cli.ts`, **including their short
 * aliases**. cac writes every alias into the parsed options object, not just
 * the long name: probed on cac 7.0.0, `-h` yields `{h: true, help: true}` and
 * `--no-help` yields `{help: false, h: false}`. Listing long names alone let
 * the alias key fall through as unrecognized. Any future global flag must be
 * added here with its aliases; `unknown-command.test.ts` asserts this set
 * against a real cac instance's `option.names` (which carries both forms), so
 * forgetting fails a test rather than silently rejecting a valid flag.
 */
export const VALID_GLOBAL_FLAGS: readonly string[] = ['h', 'help', 'v', 'version'];

export type NoMatchAction =
  | { kind: 'run' }
  | { kind: 'help' }
  | { kind: 'unknown'; name: string }
  | { kind: 'unknown-flag'; flags: string[] };

/**
 * Structural subset of cac's `CAC`. `matchedCommand` is optional there too, and
 * `args` is typed `string[]` — widened to allow a number here only because mri
 * coerces digit-only values in some positions, never to anything `String()`
 * would render as `[object Object]`.
 */
export interface ParsedCliState {
  matchedCommand?: unknown;
  args: readonly (string | number)[];
  options: Record<string, unknown>;
}

/**
 * Options cac parsed that aren't in the global allowlist, spelled the way
 * cac's own `checkUnknownOptions` spells them: skip the ever-present `--`
 * key, and render `--name` for a multi-character key or `-name` for a
 * single-character one (cac's camelCase key as-is — not de-camelized).
 *
 * A negated flag is restored to its `--no-` form. cac strips the prefix and
 * stores the boolean `false`, so `--no-bogus-flag` would otherwise be reported
 * as `--bogusFlag` — naming a flag the operator never typed. A boolean `false`
 * is an unambiguous tell: probed on cac 7.0.0, only the `--no-x` form produces
 * it, while `--x false` and `--x=false` both store the STRING `"false"`.
 */
function findUnknownFlags(options: Record<string, unknown>): string[] {
  return Object.entries(options)
    .filter(([name]) => name !== '--' && !VALID_GLOBAL_FLAGS.includes(name))
    .map(([name, value]) => {
      if (value === false) return `--no-${name}`;
      return name.length > 1 ? `--${name}` : `-${name}`;
    });
}

export function classifyNoMatch(state: ParsedCliState): NoMatchAction {
  if (state.matchedCommand !== undefined) return { kind: 'run' };
  // cac has already printed help/version and unset the match; nothing to add.
  if (state.options.help === true || state.options.version === true) return { kind: 'run' };

  const [first] = state.args;
  if (first === undefined || first === '') {
    const unknownFlags = findUnknownFlags(state.options);
    if (unknownFlags.length > 0) return { kind: 'unknown-flag', flags: unknownFlags };
    return { kind: 'help' };
  }
  // Stringify rather than requiring a string. cac hands us strings today
  // (verified: `pnpm ops 123` reports an unknown command, it does not coerce the
  // positional to a number the way `cli-args.ts` documents for --flag VALUES).
  // The coercion is defensive against that changing — and it must fail toward
  // "unknown", because routing a coerced positional to help would silently
  // restore the exit-0-on-a-typo bug this module exists to remove.
  return { kind: 'unknown', name: String(first) };
}

export function unknownCommandMessage(name: string): string {
  return `Unknown command "${name}". Run \`pnpm ops --help\` to list the available commands.`;
}

export function unknownFlagsMessage(flags: string[]): string {
  // "commands" would be the wrong noun here — the operator mistyped a flag, so
  // point at usage generally rather than at the command list specifically.
  return `Unknown option${flags.length > 1 ? 's' : ''} ${flags.join(', ')}. Run \`pnpm ops --help\` for usage.`;
}
