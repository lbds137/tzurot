/**
 * LLM Config Singleton Flag Utilities for Database Sync
 *
 * Handles resolution of singleton boolean flags (is_default, is_free_default)
 * between dev and prod databases to avoid unique constraint violations during sync.
 */

import { type PrismaClient } from '@tzurot/common-types';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('db-sync-llm-config');

interface LlmConfigFlags {
  id: string;
  is_default: boolean;
  is_free_default: boolean;
  updated_at: Date;
}

/**
 * Prepare llm_configs singleton flags before syncing
 *
 * The llm_configs table has partial unique indexes that only allow one row
 * with is_default=true and one row with is_free_default=true. Before syncing,
 * we need to resolve conflicts by using the most recently updated value.
 */
export async function prepareLlmConfigSingletonFlags(
  devClient: PrismaClient,
  prodClient: PrismaClient
): Promise<void> {
  // Fetch llm_configs with singleton flags from both databases
  const devConfigs = await devClient.$queryRawUnsafe<LlmConfigFlags[]>(`
    SELECT id, is_default, is_free_default, updated_at
    FROM llm_configs
    WHERE is_default = true OR is_free_default = true
  `);

  const prodConfigs = await prodClient.$queryRawUnsafe<LlmConfigFlags[]>(`
    SELECT id, is_default, is_free_default, updated_at
    FROM llm_configs
    WHERE is_default = true OR is_free_default = true
  `);

  // Handle is_default singleton
  await resolveSingletonFlag(devClient, prodClient, devConfigs, prodConfigs, 'is_default');

  // Handle is_free_default singleton
  await resolveSingletonFlag(devClient, prodClient, devConfigs, prodConfigs, 'is_free_default');
}

/**
 * Resolve a singleton boolean flag between dev and prod
 * Clears the flag on the "losing" config (older updated_at)
 */
async function resolveSingletonFlag(
  devClient: PrismaClient,
  prodClient: PrismaClient,
  devConfigs: LlmConfigFlags[],
  prodConfigs: LlmConfigFlags[],
  flagName: 'is_default' | 'is_free_default'
): Promise<void> {
  const devWithFlag = devConfigs.find(c => c[flagName]);
  const prodWithFlag = prodConfigs.find(c => c[flagName]);

  // No conflict if only one database has the flag set
  if (!devWithFlag || !prodWithFlag) {
    return;
  }

  // Same config has the flag in both - no conflict
  if (devWithFlag.id === prodWithFlag.id) {
    return;
  }

  // Different configs have the flag - resolve using updated_at
  const devTime = new Date(devWithFlag.updated_at).getTime();
  const prodTime = new Date(prodWithFlag.updated_at).getTime();

  logger.info(
    {
      flagName,
      devConfigId: devWithFlag.id,
      devUpdatedAt: devWithFlag.updated_at,
      prodConfigId: prodWithFlag.id,
      prodUpdatedAt: prodWithFlag.updated_at,
      winner: devTime >= prodTime ? 'dev' : 'prod',
    },
    '[Sync] Resolving llm_configs singleton flag conflict'
  );

  if (devTime >= prodTime) {
    // Dev wins - clear the flag in prod (so dev's config can be synced)
    await prodClient.$executeRawUnsafe(
      `UPDATE llm_configs SET ${flagName} = false, updated_at = NOW() WHERE id = $1::uuid`,
      prodWithFlag.id
    );
  } else {
    // Prod wins - clear the flag in dev (so prod's config can be synced)
    await devClient.$executeRawUnsafe(
      `UPDATE llm_configs SET ${flagName} = false, updated_at = NOW() WHERE id = $1::uuid`,
      devWithFlag.id
    );
  }
}
