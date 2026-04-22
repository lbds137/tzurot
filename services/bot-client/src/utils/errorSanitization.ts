/**
 * Error Sanitization
 *
 * Maps internal error messages to user-friendly Discord text.
 * Prevents leaking Prisma errors, stack traces, or internal details.
 */

/** Matches stack trace lines like "    at SomeClass.method (file.ts:42:15)".
 * Bounded leading `\s{1,16}` prevents polynomial-slide ReDoS on long error
 * bodies — real stack trace indentation is at most 4-8 spaces in practice.
 * An unbounded `\s+` (or `\s*`) would let the engine retry from every
 * whitespace position in a pathological input. */
const STACK_TRACE_PATTERN = /\s{1,16}at\s{1,4}\w/;

/** Map known internal error patterns to user-friendly messages */
export function sanitizeErrorForDiscord(error: string): string {
  if (error.includes('Unique constraint') || error.includes('P2002')) {
    return 'A duplicate request was detected. Please wait a moment and try again.';
  }
  if (
    error.includes('ECONNREFUSED') ||
    /\bconnect\b.*\b(?:refused|failed|timeout)\b/i.test(error)
  ) {
    return 'Service temporarily unavailable. Please try again in a moment.';
  }
  // Avoid leaking internal details — only pass through short, non-technical messages
  if (error.length > 200 || error.includes('prisma') || STACK_TRACE_PATTERN.test(error)) {
    return 'Something went wrong. Please try again or contact support.';
  }
  return error;
}
