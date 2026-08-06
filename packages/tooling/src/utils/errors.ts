/**
 * Usage-error typing for the `ops` CLI, and the single place that decides how
 * one is rendered.
 *
 * The distinction this module draws is between an error the OPERATOR caused
 * (a bad flag value, a missing required option) and one the CODE caused (a
 * bug, or an operational failure like an unreachable database). Only the first
 * kind deserves a one-line message: a stack trace tells the operator nothing
 * about their own typo, while stripping the stack from a genuine bug would
 * throw away the only thing that makes it debuggable. Tagging the operator's
 * mistakes lets the top-level handler in `cli.ts` print one line for them and
 * leave everything else to Node's default reporting.
 */

/**
 * An error caused by how the command was invoked: an invalid flag value, a
 * missing required option, an argument that fails validation.
 *
 * Throw this — never a bare `Error` — for anything an operator can fix by
 * retyping their command.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * Render `error` as a usage error if it is one.
 *
 * Returns `true` when it handled the error (message printed to stderr,
 * `process.exitCode` set to 1) and `false` otherwise, so the caller can
 * rethrow anything else and let a genuine bug keep its stack trace.
 */
export function reportUsageError(error: unknown): boolean {
  if (!isUsageError(error)) {
    return false;
  }
  console.error(error.message);
  process.exitCode = 1;
  return true;
}

/**
 * Usage errors are our own `UsageError` plus cac's `CACError`, which cac
 * throws for an unknown option, a missing required arg, or an option given
 * without its value — all operator mistakes by the same definition.
 *
 * The cac half is matched on `error.name`, not `instanceof`, because cac does
 * not export the `CACError` class (its only export line is
 * `export { CAC, Command, cac, cac as default }`). Do not "fix" this to an
 * `instanceof` check — there is nothing importable to check against.
 */
function isUsageError(error: unknown): error is Error {
  if (error instanceof UsageError) {
    return true;
  }
  return error instanceof Error && error.name === 'CACError';
}
