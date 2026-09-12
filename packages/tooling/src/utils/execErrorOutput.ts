/**
 * Extracts the useful text out of a thrown shell-command error.
 *
 * `execFileSync` throws an `Error` carrying the child process's `stdout` and
 * `stderr` as extra properties — neither is part of `Error.message`, which is
 * usually just "Command failed: git ...". Callers that need to show the
 * operator WHY a git/pnpm command failed want the combined output, falling
 * back to the message when the process produced no output, and to a plain
 * `String()` conversion for a non-`Error` throw.
 */
export function execErrorOutput(error: unknown): string {
  if (error instanceof Error) {
    const withOutput = error as Error & { stdout?: string; stderr?: string };
    const combined = [withOutput.stdout, withOutput.stderr]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join('\n');
    return combined.length > 0 ? combined : error.message;
  }
  return String(error);
}
