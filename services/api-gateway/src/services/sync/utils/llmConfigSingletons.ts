/**
 * LLM Config Singleton Flag Utilities for Database Sync
 *
 * Handles resolution of singleton boolean flags (is_default, is_free_default)
 * between dev and prod databases to avoid unique constraint violations during sync.
 */

import { type PrismaClient } from '@tzurot/common-types';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('db-sync-llm-config');

interface LlmConfigWithFlags {
  id: string;
  isDefault: boolean;
  isFreeDefault: boolean;
  updatedAt: Date;
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
  // Fetch llm_configs with singleton flags from both databases using typed Prisma methods
  const [devConfigs, prodConfigs] = await Promise.all([
    devClient.llmConfig.findMany({
      where: { OR: [{ isDefault: true }, { isFreeDefault: true }] },
      select: { id: true, isDefault: true, isFreeDefault: true, updatedAt: true },
    }),
    prodClient.llmConfig.findMany({
      where: { OR: [{ isDefault: true }, { isFreeDefault: true }] },
      select: { id: true, isDefault: true, isFreeDefault: true, updatedAt: true },
    }),
  ]);

  // Handle is_default singleton
  await resolveSingletonFlag(devClient, prodClient, devConfigs, prodConfigs, 'isDefault');

  // Handle is_free_default singleton
  await resolveSingletonFlag(devClient, prodClient, devConfigs, prodConfigs, 'isFreeDefault');
}

/**
 * Resolve a singleton boolean flag between dev and prod
 * Clears the flag on the "losing" config (older updated_at)
 */
async function resolveSingletonFlag(
  devClient: PrismaClient,
  prodClient: PrismaClient,
  devConfigs: LlmConfigWithFlags[],
  prodConfigs: LlmConfigWithFlags[],
  flagName: 'isDefault' | 'isFreeDefault'
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
  const devTime = new Date(devWithFlag.updatedAt).getTime();
  const prodTime = new Date(prodWithFlag.updatedAt).getTime();

  logger.info(
    {
      flagName,
      devConfigId: devWithFlag.id,
      devUpdatedAt: devWithFlag.updatedAt,
      prodConfigId: prodWithFlag.id,
      prodUpdatedAt: prodWithFlag.updatedAt,
      winner: devTime >= prodTime ? 'dev' : 'prod',
    },
    '[Sync] Resolving llm_configs singleton flag conflict'
  );

  // Use typed Prisma update instead of raw SQL to avoid injection risk
  if (devTime >= prodTime) {
    // Dev wins - clear the flag in prod (so dev's config can be synced)
    if (flagName === 'isDefault') {
      await prodClient.llmConfig.update({
        where: { id: prodWithFlag.id },
        data: { isDefault: false, updatedAt: new Date() },
      });
    } else {
      await prodClient.llmConfig.update({
        where: { id: prodWithFlag.id },
        data: { isFreeDefault: false, updatedAt: new Date() },
      });
    }
  } else {
    // Prod wins - clear the flag in dev (so prod's config can be synced)
    if (flagName === 'isDefault') {
      await devClient.llmConfig.update({
        where: { id: devWithFlag.id },
        data: { isDefault: false, updatedAt: new Date() },
      });
    } else {
      await devClient.llmConfig.update({
        where: { id: devWithFlag.id },
        data: { isFreeDefault: false, updatedAt: new Date() },
      });
    }
  }
}
