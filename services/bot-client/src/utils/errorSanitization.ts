/**
 * Error Sanitization
 *
 * Maps internal error messages to user-friendly Discord text.
 * Prevents leaking Prisma errors, stack traces, or internal details.
 */

/** Matches stack trace lines like "    at SomeClass.method (file.ts:42:15)" */
const STACK_TRACE_PATTERN = /\s+at\s+\w/;

/** Map known internal error patterns to user-friendly messages */
export function sanitizeErrorForDiscord(error: string): string {
  if (error.includes('Unique constraint') || error.includes('P2002')) {
    return 'A duplicate request was detected. Please wait a moment and try again.';
  }
  if (error.includes('connect') || error.includes('ECONNREFUSED')) {
    return 'Service temporarily unavailable. Please try again in a moment.';
  }
  // Avoid leaking internal details — only pass through short, non-technical messages
  if (error.length > 200 || error.includes('prisma') || STACK_TRACE_PATTERN.test(error)) {
    return 'Something went wrong. Please try again or contact support.';
  }
  return error;
}
