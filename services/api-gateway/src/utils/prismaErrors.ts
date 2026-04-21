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
export function isPrismaUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'P2002';
}

/**
 * Check if an error is a Prisma P2002 unique constraint violation **and**
 * the violated index targets every column in `columns`.
 *
 * Scoping a P2002 catch to a specific target prevents accidental wrapping of
 * unrelated unique-constraint errors. For example, when auto-suffix logic
 * retries on an `(owner_id, name)` collision, a hypothetical PK collision
 * would otherwise also be caught and mislabelled as a name conflict.
 */
export function isPrismaUniqueConstraintErrorOn(
  error: unknown,
  columns: readonly string[]
): error is { code: 'P2002'; meta: { target: string[] } } {
  if (!isPrismaUniqueConstraintError(error)) {
    return false;
  }
  const meta = (error as { meta?: unknown }).meta;
  if (meta === null || typeof meta !== 'object' || !('target' in meta)) {
    return false;
  }
  const target = meta.target;
  if (!Array.isArray(target)) {
    return false;
  }
  return columns.every(col => target.includes(col));
}
