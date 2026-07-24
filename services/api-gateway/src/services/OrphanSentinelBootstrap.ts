/**
 * Orphaned-Characters sentinel bootstrap (Retention Phase 2, D11).
 *
 * A retention purge must not delete a departed user's characters out from under
 * OTHER active users. Instead it re-homes each cross-user character's ownership
 * to a single reserved, non-interactive **sentinel** User — a holder, not an
 * admin — and stamps the original owner's Discord ID onto the personality for a
 * future reclamation flow (Phase 3).
 *
 * This module ensures that sentinel row exists. It mirrors
 * `UserService.createUserWithDefaultPersona`'s circular-FK CTE (users ↔ personas
 * reference each other, resolved by a single INSERT...WITH statement) and
 * `TtsConfigBootstrap`'s idempotent, deterministic-UUID shape so dev and prod
 * converge on the SAME sentinel id under `/admin db-sync` (a random id per env
 * would collide on the unique constraints).
 *
 * The sentinel is `retention_exempt = true` (the purge predicate never selects
 * it) and `is_superuser = false` (it is explicitly NOT the operator's account).
 */

import {
  ORPHAN_SENTINEL_DISCORD_ID,
  ORPHAN_SENTINEL_USERNAME,
  ORPHAN_SENTINEL_DESCRIPTION,
} from '@tzurot/common-types/constants/persona';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  generateUserUuid,
  generatePersonaUuid,
} from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('OrphanSentinelBootstrap');

/**
 * Ensure the Orphaned-Characters sentinel user (and its paired persona) exists;
 * return its deterministic user id. Idempotent — `ON CONFLICT DO NOTHING` on
 * both inserts, so concurrent first-callers and every later call converge on
 * the same row without error. The id derives from the reserved discordId, so it
 * is stable across environments regardless of who created the row.
 */
export async function ensureOrphanSentinel(prisma: PrismaClient): Promise<string> {
  const sentinelId = generateUserUuid(ORPHAN_SENTINEL_DISCORD_ID);
  const personaId = generatePersonaUuid(ORPHAN_SENTINEL_USERNAME, sentinelId);

  // Circular-FK bootstrap via a single-statement CTE (users.default_persona_id
  // ↔ personas.owner_id): both rows land before the deferrable FK check at
  // statement end. Mirrors UserService.createUserWithDefaultPersona; the only
  // additions are ON CONFLICT DO NOTHING (idempotency) and retention_exempt.
  const rows = await prisma.$queryRaw<{ created: boolean }[]>`
    WITH new_persona AS (
      INSERT INTO personas (id, name, preferred_name, description, content, owner_id, updated_at)
      VALUES (
        ${personaId}::uuid,
        ${ORPHAN_SENTINEL_USERNAME},
        ${ORPHAN_SENTINEL_USERNAME},
        ${ORPHAN_SENTINEL_DESCRIPTION},
        '',
        ${sentinelId}::uuid,
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    ),
    new_user AS (
      INSERT INTO users (id, discord_id, username, is_superuser, retention_exempt, default_persona_id, updated_at)
      VALUES (
        ${sentinelId}::uuid,
        ${ORPHAN_SENTINEL_DISCORD_ID},
        ${ORPHAN_SENTINEL_USERNAME},
        false,
        true,
        ${personaId}::uuid,
        NOW()
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    )
    SELECT EXISTS (SELECT 1 FROM new_user) AS created
  `;

  if (rows[0]?.created === true) {
    logger.info({ sentinelId }, 'Bootstrapped Orphaned-Characters sentinel user');
  }
  return sentinelId;
}
