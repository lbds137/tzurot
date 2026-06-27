/**
 * System-globals bootstrap for vision configs (`kind='vision'` LlmConfig rows).
 *
 * Vision configs reuse the `llm_configs` table (kind discriminator). This seeds the
 * two global vision defaults so `VisionConfigResolver` resolves a real model instead
 * of falling to the hardcoded `VISION_FALLBACK` last resort:
 *   - the PAID global default (kind='vision', isGlobal, isDefault) — what the resolver
 *     stamps for the no-override case; changing THIS row's model is the "one action"
 *     win (no per-preset edits).
 *   - the FREE default (kind='vision', isFreeDefault) — the data foundation for the
 *     guest tier (Phase 1 still downgrades guests via AuthStep + VISION_FALLBACK_FREE;
 *     Phase 3 folds this row into the resolver cascade).
 *
 * Mirrors {@link bootstrapTtsSystemGlobalsIfNeeded}. Superuser-gated (the seed needs a
 * real owner UUID), idempotent (deterministic UUIDs + skipDuplicates).
 *
 * NOTE: the paid default is deliberately a FAST vision model, NOT `MODEL_DEFAULTS.
 * VISION_FALLBACK` (the 397B MoE whose latency consistently blew the vision budget and
 * timed out) — that constant stays the resolver's last-resort floor, not the seeded
 * default.
 */

import {
  type PrismaClient,
  MODEL_DEFAULTS,
  generateSystemGlobalLlmConfigUuid,
  createLogger,
} from '@tzurot/common-types';

const logger = createLogger('VisionConfigBootstrap');

interface VisionGlobalSeed {
  name: string;
  description: string;
  model: string;
  isDefault: boolean;
  isFreeDefault: boolean;
}

const VISION_GLOBALS: readonly VisionGlobalSeed[] = [
  {
    name: 'vision-default',
    description: 'Global vision default — multimodal model for image description',
    // Fast, capable multimodal model (the user's confirmed-good prod vision model) —
    // deliberately NOT the slow 397B VISION_FALLBACK that caused the incident. Tunable
    // in one action: edit this global default to change vision for everyone.
    model: 'qwen/qwen3.7-plus',
    isDefault: true,
    isFreeDefault: false,
  },
  {
    name: 'vision-free-default',
    description: 'Free-tier vision default — multimodal model for non-BYOK users',
    model: MODEL_DEFAULTS.VISION_FALLBACK_FREE,
    isDefault: false,
    isFreeDefault: true,
  },
];

/** Seed the vision system globals when a superuser exists; no-op otherwise. */
export async function bootstrapVisionSystemGlobalsIfNeeded(prisma: PrismaClient): Promise<void> {
  const superuser = await prisma.user.findFirst({
    where: { isSuperuser: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (superuser === null) {
    logger.warn(
      {},
      'Vision config bootstrap skipped: no superuser exists yet — vision falls back to the hardcoded default until one is created'
    );
    return;
  }

  // skipDuplicates → INSERT ... ON CONFLICT DO NOTHING; concurrent first-callers converge.
  // Deterministic UUIDs (uuidv5 from name) so dev/prod produce the same ID for the same
  // logical row, avoiding (owner_id, name) collisions during /admin db-sync.
  const result = await prisma.llmConfig.createMany({
    data: VISION_GLOBALS.map(seed => ({
      id: generateSystemGlobalLlmConfigUuid(seed.name),
      name: seed.name,
      description: seed.description,
      ownerId: superuser.id,
      kind: 'vision',
      isGlobal: true,
      isDefault: seed.isDefault,
      isFreeDefault: seed.isFreeDefault,
      provider: 'openrouter',
      model: seed.model,
    })),
    skipDuplicates: true,
  });

  if (result.count > 0) {
    logger.info(
      { seeded: result.count, ownerId: superuser.id },
      'Bootstrapped vision config system globals'
    );
  }
}
