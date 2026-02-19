/**
 * Prisma Error Utilities
 *
 * Shared helpers for detecting specific Prisma error codes.
 */

/**
 * Check if an error is a Prisma P2002 unique constraint violation.
 * Used for defense-in-depth handling when concurrent requests race
 * past transaction-level conflict checks.
 */
export function isPrismaUniqueConstraintError(error: unknown): error is { code: string } {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'P2002';
}
