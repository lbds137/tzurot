/**
 * System-settings boot seed (design D3, admin-runtime-settings).
 *
 * Writes each registry entry's seed value into `admin_settings.system_settings`
 * ONLY where the key is absent — an admin's explicit choice is never clobbered.
 * Race-safe by construction: one atomic SQL statement whose JSONB merge puts
 * the seed on the LEFT and the existing bag on the RIGHT (`seed || existing`),
 * so existing keys always win. Idempotent under concurrent replica boots —
 * every replica derives identical seed values from the same env anyway.
 *
 * Failure is non-fatal by design: readers fall back to the registry's in-code
 * constants (the floor beneath the floor), so a failed seed degrades service
 * configuration, not availability.
 */

import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import { buildSystemSettingsSeed } from '@tzurot/common-types/schemas/api/systemSettings';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

const logger = createLogger('SystemSettingsSeed');

export async function seedSystemSettingsIfUnset(prisma: PrismaClient): Promise<void> {
  const seed = buildSystemSettingsSeed();
  const seedJson = JSON.stringify(seed);

  try {
    // Operand order is load-bearing: `seed || existing` means existing keys
    // override the seed — per-key insert-if-absent in one atomic statement.
    // created_at/updated_at need explicit values on the INSERT branch (no DB
    // default for updated_at; Prisma's @updatedAt is client-managed).
    // The UPDATE branch deliberately does NOT bump updated_at: the merge is a
    // no-op whenever every key already exists (every boot after the first),
    // and bumping would spuriously 409 any in-flight dashboard write's
    // optimistic-concurrency token on every replica boot. The residual race
    // (a seed ADDING a brand-new key between a client's read and write) can't
    // lose data — writes are single-key server-side merges.
    await prisma.$executeRaw`
      INSERT INTO admin_settings (id, system_settings, created_at, updated_at)
      VALUES (${ADMIN_SETTINGS_SINGLETON_ID}::uuid, ${seedJson}::jsonb, now(), now())
      ON CONFLICT (id) DO UPDATE
      SET system_settings = ${seedJson}::jsonb || COALESCE(admin_settings.system_settings, '{}'::jsonb)
    `;
    logger.info({ keyCount: Object.keys(seed).length }, 'System settings seed pass complete');
  } catch (error) {
    logger.error(
      { err: error },
      'System settings seed pass failed — readers will serve in-code fallbacks'
    );
  }
}
