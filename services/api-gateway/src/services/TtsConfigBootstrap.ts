/** System-globals bootstrap for `TtsConfigService.list(GLOBAL)`. */

import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { generateSystemGlobalTtsConfigUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('TtsConfigBootstrap');

interface SystemGlobalSeed {
  name: string;
  description: string;
  provider: 'self-hosted' | 'elevenlabs' | 'mistral';
  modelId: string | null;
}

const SYSTEM_GLOBALS: readonly SystemGlobalSeed[] = [
  {
    name: 'kyutai-self-hosted',
    description: 'Self-hosted Kyutai/Pocket TTS — free tier + system default',
    provider: 'self-hosted',
    modelId: null,
  },
  {
    name: 'elevenlabs-multilingual-v2',
    description: 'ElevenLabs Multilingual v2 — historic default for BYOK users',
    provider: 'elevenlabs',
    modelId: 'eleven_multilingual_v2',
  },
  {
    name: 'mistral-voxtral-mini',
    description: 'Mistral Voxtral Mini TTS — Phase 1 BYOK (~85% cost reduction vs ElevenLabs)',
    provider: 'mistral',
    modelId: 'voxtral-mini-tts-2603',
  },
];

/** The seed that the fresh-install default pointers should reference. */
const DEFAULT_SEED_NAME = 'kyutai-self-hosted';

/** Seed the 3 system globals when a superuser exists; no-op otherwise (caller re-queries). */
export async function bootstrapTtsSystemGlobalsIfNeeded(prisma: PrismaClient): Promise<void> {
  const superuser = await prisma.user.findFirst({
    where: { isSuperuser: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (superuser === null) {
    logger.warn(
      {},
      'TtsConfig bootstrap skipped: no superuser exists yet — create one before invoking /settings tts'
    );
    return;
  }

  // skipDuplicates compiles to INSERT ... ON CONFLICT DO NOTHING; concurrent first-callers converge.
  // Deterministic UUIDs (uuidv5 from name) so dev/prod produce the same ID for the same logical row,
  // avoiding (owner_id, name) collisions during /admin db-sync.
  const result = await prisma.ttsConfig.createMany({
    data: SYSTEM_GLOBALS.map(seed => ({
      id: generateSystemGlobalTtsConfigUuid(seed.name),
      name: seed.name,
      description: seed.description,
      ownerId: superuser.id,
      isGlobal: true,
      provider: seed.provider,
      modelId: seed.modelId,
    })),
    skipDuplicates: true,
  });

  if (result.count > 0) {
    logger.info(
      { seeded: result.count, ownerId: superuser.id },
      'Bootstrapped TtsConfig system globals on first list() call'
    );
  }

  await seedDefaultPointersIfUnset(prisma);
}

/**
 * Point the AdminSettings TTS defaults at the Kyutai seed — but ONLY when the
 * pointer is currently NULL, so an admin's explicit choice is never clobbered
 * by a later bootstrap pass. Runs even when the configs already existed
 * (result.count === 0) so a half-bootstrapped state converges.
 */
async function seedDefaultPointersIfUnset(prisma: PrismaClient): Promise<void> {
  const defaultId = generateSystemGlobalTtsConfigUuid(DEFAULT_SEED_NAME);
  const settings = await prisma.adminSettings.findUnique({
    where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    select: { globalDefaultTtsConfigId: true, freeDefaultTtsConfigId: true },
  });

  const data: { globalDefaultTtsConfigId?: string; freeDefaultTtsConfigId?: string } = {};
  if ((settings?.globalDefaultTtsConfigId ?? null) === null) {
    data.globalDefaultTtsConfigId = defaultId;
  }
  if ((settings?.freeDefaultTtsConfigId ?? null) === null) {
    data.freeDefaultTtsConfigId = defaultId;
  }
  if (Object.keys(data).length === 0) {
    return;
  }

  await prisma.adminSettings.upsert({
    where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    create: { id: ADMIN_SETTINGS_SINGLETON_ID, ...data },
    update: data,
  });
  logger.info({ pointers: Object.keys(data) }, 'Seeded AdminSettings TTS default pointers');
}
