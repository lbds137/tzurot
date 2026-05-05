/** System-globals bootstrap for `TtsConfigService.list(GLOBAL)`. */

import {
  type PrismaClient,
  generateSystemGlobalTtsConfigUuid,
  createLogger,
} from '@tzurot/common-types';

const logger = createLogger('TtsConfigBootstrap');

interface SystemGlobalSeed {
  name: string;
  description: string;
  provider: 'self-hosted' | 'elevenlabs' | 'mistral';
  modelId: string | null;
  isFreeDefault: boolean;
  /** When true, marks this seed as the system-wide default — set on kyutai-self-hosted. */
  isDefault: boolean;
}

const SYSTEM_GLOBALS: readonly SystemGlobalSeed[] = [
  {
    name: 'kyutai-self-hosted',
    description: 'Self-hosted Kyutai/Pocket TTS — free tier + system default',
    provider: 'self-hosted',
    modelId: null,
    isFreeDefault: true,
    isDefault: true,
  },
  {
    name: 'elevenlabs-multilingual-v2',
    description: 'ElevenLabs Multilingual v2 — historic default for BYOK users',
    provider: 'elevenlabs',
    modelId: 'eleven_multilingual_v2',
    isFreeDefault: false,
    isDefault: false,
  },
  {
    name: 'mistral-voxtral-mini',
    description: 'Mistral Voxtral Mini TTS — Phase 1 BYOK (~85% cost reduction vs ElevenLabs)',
    provider: 'mistral',
    modelId: 'voxtral-mini-tts-2603',
    isFreeDefault: false,
    isDefault: false,
  },
];

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
      isDefault: seed.isDefault,
      isFreeDefault: seed.isFreeDefault,
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
}
