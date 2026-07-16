/**
 * Delete a UserPersonalityConfig anchor row if clearing an override left every
 * slice null. Without this, set-then-clear accumulates dead anchor rows that
 * resolve to nothing and clutter data exports.
 *
 * Call AFTER the clear's `update`. The all-null predicate lives in the WHERE,
 * so the check-and-delete is one atomic statement — a concurrent set between
 * "read the row" and "delete it" cannot lose its write (`deleteMany` simply
 * matches zero rows).
 */

import { Prisma, type PrismaClient } from '@tzurot/common-types/services/prisma';
import { type PersonalityConfigSlices } from '@tzurot/common-types/utils/personalityConfigShape';

/**
 * The SQL-side twin of `isEmptyPersonalityConfig` (the export filter's JS
 * predicate). `satisfies` ties the field list to the shared
 * {@link PersonalityConfigSlices} shape, so adding a new slice breaks this
 * predicate at compile time instead of silently widening what "empty" means.
 *
 * `AnyNull` is required for the JSONB slice: the clear paths write
 * `Prisma.JsonNull` (a JSON null value), while a never-set slice is SQL NULL —
 * a plain `null` filter would miss the cleared rows entirely.
 */
const EMPTY_SLICES_WHERE = {
  personaId: null,
  llmConfigId: null,
  visionConfigId: null,
  ttsConfigId: null,
  configOverrides: { equals: Prisma.AnyNull },
} satisfies Record<keyof PersonalityConfigSlices, unknown>;

export async function pruneEmptyPersonalityConfig(
  prisma: PrismaClient,
  id: string
): Promise<boolean> {
  const deleted = await prisma.userPersonalityConfig.deleteMany({
    where: { id, ...EMPTY_SLICES_WHERE },
  });
  return deleted.count > 0;
}
