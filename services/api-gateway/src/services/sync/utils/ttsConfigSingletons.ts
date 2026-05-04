/**
 * TTS Config Singleton Flag Utilities for Database Sync
 *
 * Mirrors llmConfigSingletons.ts. Handles resolution of singleton boolean
 * flags (is_default, is_free_default) between dev and prod databases to
 * avoid unique constraint violations during sync.
 */

import { type PrismaClient, createLogger } from '@tzurot/common-types';

const logger = createLogger('db-sync-tts-config');

interface SingletonResolution {
  flagName: 'isDefault' | 'isFreeDefault';
  winnerId: string;
  winnerEnv: 'dev' | 'prod';
}

let pendingResolutions: SingletonResolution[] = [];

interface TtsConfigWithFlags {
  id: string;
  isDefault: boolean;
  isFreeDefault: boolean;
  updatedAt: Date;
}

/**
 * Prepare tts_configs singleton flags before syncing.
 *
 * The tts_configs table has partial unique indexes that only allow one row
 * with is_default=true and one row with is_free_default=true. Before syncing,
 * we resolve conflicts by using the most recently updated value.
 */
export async function prepareTtsConfigSingletonFlags(
  devClient: PrismaClient,
  prodClient: PrismaClient
): Promise<void> {
  pendingResolutions = [];

  const [devConfigs, prodConfigs] = await Promise.all([
    devClient.ttsConfig.findMany({
      where: { OR: [{ isDefault: true }, { isFreeDefault: true }] },
      select: { id: true, isDefault: true, isFreeDefault: true, updatedAt: true },
    }),
    prodClient.ttsConfig.findMany({
      where: { OR: [{ isDefault: true }, { isFreeDefault: true }] },
      select: { id: true, isDefault: true, isFreeDefault: true, updatedAt: true },
    }),
  ]);

  await resolveSingletonFlag(devClient, prodClient, devConfigs, prodConfigs, 'isDefault');
  await resolveSingletonFlag(devClient, prodClient, devConfigs, prodConfigs, 'isFreeDefault');
}

/**
 * Resolve a singleton boolean flag between dev and prod.
 * Clears the flag on the "losing" config (older updated_at).
 */
async function resolveSingletonFlag(
  devClient: PrismaClient,
  prodClient: PrismaClient,
  devConfigs: TtsConfigWithFlags[],
  prodConfigs: TtsConfigWithFlags[],
  flagName: 'isDefault' | 'isFreeDefault'
): Promise<void> {
  const devWithFlag = devConfigs.find(c => c[flagName]);
  const prodWithFlag = prodConfigs.find(c => c[flagName]);

  if (!devWithFlag || !prodWithFlag) {
    return;
  }

  if (devWithFlag.id === prodWithFlag.id) {
    return;
  }

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
    '[Sync] Resolving tts_configs singleton flag conflict'
  );

  const updateData = flagName === 'isDefault' ? { isDefault: true } : { isFreeDefault: true };
  const clearData = flagName === 'isDefault' ? { isDefault: false } : { isFreeDefault: false };

  if (devTime >= prodTime) {
    await prodClient.ttsConfig.update({
      where: { id: prodWithFlag.id },
      data: { ...clearData, updatedAt: new Date() },
    });

    const devConfigInProd = await prodClient.ttsConfig.findUnique({
      where: { id: devWithFlag.id },
    });
    if (devConfigInProd) {
      await prodClient.ttsConfig.update({
        where: { id: devWithFlag.id },
        data: { ...updateData, updatedAt: new Date() },
      });
    } else {
      pendingResolutions.push({ flagName, winnerId: devWithFlag.id, winnerEnv: 'dev' });
    }
  } else {
    await devClient.ttsConfig.update({
      where: { id: devWithFlag.id },
      data: { ...clearData, updatedAt: new Date() },
    });

    const prodConfigInDev = await devClient.ttsConfig.findUnique({
      where: { id: prodWithFlag.id },
    });
    if (prodConfigInDev) {
      await devClient.ttsConfig.update({
        where: { id: prodWithFlag.id },
        data: { ...updateData, updatedAt: new Date() },
      });
    } else {
      pendingResolutions.push({ flagName, winnerId: prodWithFlag.id, winnerEnv: 'prod' });
    }
  }
}

/**
 * Finalize singleton flags after sync completes.
 *
 * Handles the case where the winning config didn't exist in the other
 * environment before sync. After sync copies it, we set the flag.
 */
export async function finalizeTtsConfigSingletonFlags(
  devClient: PrismaClient,
  prodClient: PrismaClient
): Promise<void> {
  for (const resolution of pendingResolutions) {
    const { flagName, winnerId, winnerEnv } = resolution;
    const updateData = flagName === 'isDefault' ? { isDefault: true } : { isFreeDefault: true };

    const targetClient = winnerEnv === 'dev' ? prodClient : devClient;

    const configExists = await targetClient.ttsConfig.findUnique({
      where: { id: winnerId },
    });

    if (configExists) {
      logger.info(
        { flagName, winnerId, targetEnv: winnerEnv === 'dev' ? 'prod' : 'dev' },
        '[Sync] Setting singleton flag on newly synced tts_config'
      );
      await targetClient.ttsConfig.update({
        where: { id: winnerId },
        data: { ...updateData, updatedAt: new Date() },
      });
    } else {
      logger.warn(
        { flagName, winnerId, targetEnv: winnerEnv === 'dev' ? 'prod' : 'dev' },
        '[Sync] Warning: winning tts_config still not found after sync'
      );
    }
  }

  pendingResolutions = [];
}
