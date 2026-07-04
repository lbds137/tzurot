/**
 * LLM Config Singleton Flag Utilities for Database Sync
 *
 * Handles resolution of singleton boolean flags (is_default, is_free_default)
 * between dev and prod databases to avoid unique constraint violations during sync.
 */

import { CONFIG_KINDS, type ConfigKind } from '@tzurot/common-types/constants/ai';
import { toConfigKind } from '@tzurot/common-types/services/LlmConfigMapper';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('db-sync-llm-config');

interface SingletonResolution {
  flagName: 'isDefault' | 'isFreeDefault';
  winnerId: string;
  winnerEnv: 'dev' | 'prod';
}

// Track resolutions for finalization after sync
let pendingResolutions: SingletonResolution[] = [];

interface LlmConfigWithFlags {
  id: string;
  kind: ConfigKind;
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
  // Clear any pending resolutions from previous runs
  pendingResolutions = [];

  // Fetch llm_configs with singleton flags from both databases using typed Prisma methods.
  // Prisma returns `kind` as a raw string; narrow it to ConfigKind via toConfigKind.
  const [devRows, prodRows] = await Promise.all([
    devClient.llmConfig.findMany({
      where: { OR: [{ isDefault: true }, { isFreeDefault: true }] },
      select: { id: true, kind: true, isDefault: true, isFreeDefault: true, updatedAt: true },
    }),
    prodClient.llmConfig.findMany({
      where: { OR: [{ isDefault: true }, { isFreeDefault: true }] },
      select: { id: true, kind: true, isDefault: true, isFreeDefault: true, updatedAt: true },
    }),
  ]);

  const devConfigs: LlmConfigWithFlags[] = devRows.map(row => ({
    ...row,
    kind: toConfigKind(row.kind),
  }));
  const prodConfigs: LlmConfigWithFlags[] = prodRows.map(row => ({
    ...row,
    kind: toConfigKind(row.kind),
  }));

  // The default / free-default singletons are PER KIND — the partial unique indexes
  // (`llm_configs_default_unique`, `llm_configs_free_default_unique`) are scoped to
  // `kind`, so a text default and a vision default coexist. Resolve each (kind, flag)
  // group independently; resolving globally would clobber one kind's default with the
  // other's during sync.
  for (const kind of CONFIG_KINDS) {
    await resolveSingletonFlag({
      devClient,
      prodClient,
      devConfigs,
      prodConfigs,
      flagName: 'isDefault',
      kind,
    });
    await resolveSingletonFlag({
      devClient,
      prodClient,
      devConfigs,
      prodConfigs,
      flagName: 'isFreeDefault',
      kind,
    });
  }
}

/**
 * Resolve a singleton boolean flag between dev and prod
 * Clears the flag on the "losing" config (older updated_at)
 */
interface ResolveSingletonFlagArgs {
  devClient: PrismaClient;
  prodClient: PrismaClient;
  devConfigs: LlmConfigWithFlags[];
  prodConfigs: LlmConfigWithFlags[];
  flagName: 'isDefault' | 'isFreeDefault';
  kind: ConfigKind;
}

async function resolveSingletonFlag(args: ResolveSingletonFlagArgs): Promise<void> {
  const { devClient, prodClient, devConfigs, prodConfigs, flagName, kind } = args;
  const devWithFlag = devConfigs.find(c => c[flagName] && c.kind === kind);
  const prodWithFlag = prodConfigs.find(c => c[flagName] && c.kind === kind);

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
      kind,
      devConfigId: devWithFlag.id,
      devUpdatedAt: devWithFlag.updatedAt,
      prodConfigId: prodWithFlag.id,
      prodUpdatedAt: prodWithFlag.updatedAt,
      winner: devTime >= prodTime ? 'dev' : 'prod',
    },
    '[Sync] Resolving llm_configs singleton flag conflict'
  );

  // Use typed Prisma update instead of raw SQL to avoid injection risk
  // We need to both clear the loser's flag AND set the winner's flag in both environments
  // Since sync excludes these columns, we must explicitly propagate the winner
  const updateData = flagName === 'isDefault' ? { isDefault: true } : { isFreeDefault: true };
  const clearData = flagName === 'isDefault' ? { isDefault: false } : { isFreeDefault: false };

  if (devTime >= prodTime) {
    // Dev wins - clear prod's flag and ensure dev's config has the flag in prod
    await prodClient.llmConfig.update({
      where: { id: prodWithFlag.id },
      data: { ...clearData, updatedAt: new Date() },
    });

    // Set the flag on dev's winning config in prod (if it exists)
    const devConfigInProd = await prodClient.llmConfig.findUnique({
      where: { id: devWithFlag.id },
    });
    if (devConfigInProd) {
      await prodClient.llmConfig.update({
        where: { id: devWithFlag.id },
        data: { ...updateData, updatedAt: new Date() },
      });
    } else {
      // Track for finalization - sync will copy the config, then we set the flag
      pendingResolutions.push({ flagName, winnerId: devWithFlag.id, winnerEnv: 'dev' });
    }
  } else {
    // Prod wins - clear dev's flag and ensure prod's config has the flag in dev
    await devClient.llmConfig.update({
      where: { id: devWithFlag.id },
      data: { ...clearData, updatedAt: new Date() },
    });

    // Set the flag on prod's winning config in dev (if it exists)
    const prodConfigInDev = await devClient.llmConfig.findUnique({
      where: { id: prodWithFlag.id },
    });
    if (prodConfigInDev) {
      await devClient.llmConfig.update({
        where: { id: prodWithFlag.id },
        data: { ...updateData, updatedAt: new Date() },
      });
    } else {
      // Track for finalization - sync will copy the config, then we set the flag
      pendingResolutions.push({ flagName, winnerId: prodWithFlag.id, winnerEnv: 'prod' });
    }
  }
}

/**
 * Finalize singleton flags after sync completes
 *
 * Handles the case where the winning config didn't exist in the other environment
 * before sync. After sync copies it, we set the flag.
 */
export async function finalizeLlmConfigSingletonFlags(
  devClient: PrismaClient,
  prodClient: PrismaClient
): Promise<void> {
  for (const resolution of pendingResolutions) {
    const { flagName, winnerId, winnerEnv } = resolution;
    const updateData = flagName === 'isDefault' ? { isDefault: true } : { isFreeDefault: true };

    // Set the flag in the OTHER environment (the one that didn't have the config before)
    const targetClient = winnerEnv === 'dev' ? prodClient : devClient;

    const configExists = await targetClient.llmConfig.findUnique({
      where: { id: winnerId },
    });

    if (configExists) {
      logger.info(
        { flagName, winnerId, targetEnv: winnerEnv === 'dev' ? 'prod' : 'dev' },
        '[Sync] Setting singleton flag on newly synced config'
      );
      await targetClient.llmConfig.update({
        where: { id: winnerId },
        data: { ...updateData, updatedAt: new Date() },
      });
    } else {
      logger.warn(
        { flagName, winnerId, targetEnv: winnerEnv === 'dev' ? 'prod' : 'dev' },
        '[Sync] Warning: winning config still not found after sync'
      );
    }
  }

  // Clear pending resolutions
  pendingResolutions = [];
}
