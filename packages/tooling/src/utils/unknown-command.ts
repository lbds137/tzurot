/**
 * What to do when cac matched no command.
 *
 * cac dispatches to a registered command, a default command, or nothing. This
 * CLI registers no default, so an unmatched name falls through
 * `runMatchedCommand()` as a silent no-op: `pnpm ops no:such:command` printed
 * nothing and exited 0, making an operator typo indistinguishable from success.
 * Nothing throws, so the top-level UsageError handler never saw it.
 *
 * Two distinct no-match cases, and they want different outcomes:
 *
 * - **A name was given and matched nothing** — a mistake the operator can fix by
 *   retyping, which is exactly what `UsageError` is for: one line, exit 1.
 * - **No name was given at all** (`pnpm ops`) — not a mistake, just an
 *   incomplete invocation. Print help and exit 0, the way every other CLI does.
 *
 * `--help` and `--version` also leave `matchedCommand` unset (cac unsets it
 * after printing), so both are excluded — otherwise `pnpm ops db:status --help`
 * would print help and then error.
 */

export type NoMatchAction = { kind: 'run' } | { kind: 'help' } | { kind: 'unknown'; name: string };

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

export function classifyNoMatch(state: ParsedCliState): NoMatchAction {
  if (state.matchedCommand !== undefined) return { kind: 'run' };
  // cac has already printed help/version and unset the match; nothing to add.
  if (state.options.help === true || state.options.version === true) return { kind: 'run' };

  const [first] = state.args;
  if (first === undefined || first === '') return { kind: 'help' };
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
