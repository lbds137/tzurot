import { Prisma } from '../generated/prisma/client.js';

/**
 * Write-side value for a nullable Prisma `Json?` column: `undefined` leaves
 * the column untouched (the key is omitted from the write), `null` clears it
 * to SQL NULL, anything else is stored as-is.
 *
 * `Prisma.DbNull` is what actually clears the column. A bare JS `null` is
 * accepted without error but stores the JSON value `null`, leaving the column
 * non-NULL — and Prisma reads both back as JS `null`, so the difference shows
 * up only in SQL. Pinned by the clearing case in
 * `services/api-gateway/src/routes/admin/updatePersonality.component.test.ts`,
 * which asserts `custom_fields IS NULL`.
 */
export function toNullableJsonInput(
  value: object | null | undefined
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return Prisma.DbNull;
  }
  return value;
}
