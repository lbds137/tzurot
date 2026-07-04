/**
 * Clone-name collision resolution for LLM config presets.
 *
 * Extracted from LlmConfigService (keeps that file under the max-lines limit).
 * Self-contained: a name-walk over the owner's existing configs of a given kind,
 * with no service state beyond the injected Prisma client.
 */

import { type ConfigKind } from '@tzurot/common-types/constants/ai';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { generateClonedName, stripCopySuffix } from '@tzurot/common-types/utils/presetCloneName';
import { CloneNameExhaustedError } from './LlmConfigErrors.js';

/**
 * Upper bound on how far {@link resolveNonCollidingName} will iterate before
 * giving up. Chosen generously — a user with 20+ copies of the same base name
 * is pathological; we'd rather throw a clear error than loop forever.
 */
export const MAX_CLONE_NAME_ATTEMPTS = 20;

/**
 * Find a name that doesn't collide with any existing config owned by the same
 * user (of the given `kind`), starting from `baseName` and bumping `(Copy N)`
 * suffixes via `generateClonedName` until a free slot is found.
 *
 * Uses a single SELECT to enumerate all variants (base, `base (Copy)`,
 * `base (Copy N)`) and resolves the bump in-memory, so the server handles the
 * entire collision walk in one DB round-trip instead of a client-side loop.
 *
 * A race where another request inserts a colliding name between the SELECT and
 * the INSERT is caught by the caller's P2002 translator — not this function's
 * concern.
 */
export async function resolveNonCollidingName(
  prisma: PrismaClient,
  baseName: string,
  ownerId: string,
  kind: ConfigKind
): Promise<string> {
  const stripped = stripCopySuffix(baseName);

  // Tight filter: fetch the exact base name OR a `base (Copy...)` variant.
  // Splitting the copy-variant match into two startsWith predicates —
  // `"<base> (Copy)"` (the no-number form) and `"<base> (Copy "` (the numbered
  // form, note trailing space) — avoids over-fetching false positives like
  // `"<base> (Copycat Theme)"` that can never match a generated candidate but
  // still consume the `take` budget. `orderBy: name asc` puts the base name
  // first and the copy variants right behind it.
  //
  // Bounded read: the in-memory loop walks at most MAX_CLONE_NAME_ATTEMPTS
  // candidates, so the SELECT only needs to see those N rows. Any collision that
  // slips past this limit is still caught by the P2002 translator in create().
  //
  // `name` is a CITEXT column, so exact equality (`{ name: stripped }`) is
  // case-insensitive at the DB level. startsWith compiles to `LIKE` though, and
  // Postgres citext inherits text behavior for LIKE — it does NOT override it to
  // be case-insensitive. `mode: 'insensitive'` switches startsWith to `ILIKE` so
  // lowercase legacy rows like `"preset (copy 5)"` still match a title-case-seeded
  // SELECT. Without this, the walk would miss those rows, pick a "free" candidate,
  // and trip P2002 on INSERT.
  //
  // takenNames is additionally lowercased so the in-memory `Set.has(...)` probe
  // matches how the citext unique index evaluates equality — without the
  // lowercasing, `Set.has("Preset (Copy 2)")` misses `"preset (copy 2)"` fetched
  // via the ILIKE above, same P2002 failure mode via a different path.
  const existing = await prisma.llmConfig.findMany({
    where: {
      ownerId,
      kind,
      OR: [
        { name: stripped },
        { name: { startsWith: `${stripped} (Copy)`, mode: 'insensitive' } },
        { name: { startsWith: `${stripped} (Copy `, mode: 'insensitive' } },
      ],
    },
    select: { name: true },
    orderBy: { name: 'asc' },
    take: MAX_CLONE_NAME_ATTEMPTS + 1,
  });
  const takenNames = new Set(existing.map(row => row.name.toLowerCase()));

  let candidate = baseName;
  for (let i = 0; i < MAX_CLONE_NAME_ATTEMPTS; i++) {
    if (!takenNames.has(candidate.toLowerCase())) {
      return candidate;
    }
    candidate = generateClonedName(candidate);
  }

  // Pathological: user has 20+ copy variants in a row. Typed so the route can
  // translate to a user-friendly NAME_COLLISION instead of an opaque 500.
  // Passing `stripped` (not the raw baseName) makes the message read "Too many
  // copies of 'Preset'..." — how the user identifies the preset.
  throw new CloneNameExhaustedError(stripped, MAX_CLONE_NAME_ATTEMPTS);
}
