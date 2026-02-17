/**
 * Shapes Import Helper Functions
 *
 * Personality creation and avatar download extracted from ShapesImportJob
 * to keep the main job file within line limits.
 */

import {
  createLogger,
  type PrismaClient,
  type ShapesIncPersonalityConfig,
  SHAPES_USER_AGENT,
} from '@tzurot/common-types';
import type { Prisma } from '@tzurot/common-types';
import {
  mapShapesConfigToPersonality,
  type MappedPersonalityData,
} from '../services/shapes/ShapesPersonalityMapper.js';

const logger = createLogger('ShapesImportJob');

/** Max avatar size (10MB — matches Discord's limit) */
const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

/** Avatar download timeout in ms (matches ShapesDataFetcher.REQUEST_TIMEOUT_MS) */
const AVATAR_TIMEOUT_MS = 30_000;

export async function createFullPersonality(
  prisma: PrismaClient,
  config: ShapesIncPersonalityConfig,
  slug: string,
  ownerId: string
): Promise<{ personalityId: string; slug: string }> {
  const mapped = mapShapesConfigToPersonality(config, slug);

  await upsertSystemPrompt(prisma, mapped.systemPrompt);
  await upsertPersonality(prisma, mapped, ownerId);
  await upsertLlmConfig(prisma, mapped.llmConfig, ownerId);

  // Link as default config for this personality
  await prisma.personalityDefaultConfig.upsert({
    where: { personalityId: mapped.personality.id },
    create: { personalityId: mapped.personality.id, llmConfigId: mapped.llmConfig.id },
    update: { llmConfigId: mapped.llmConfig.id },
  });

  // Record ownership in PersonalityOwner table (supplements ownerId on personality record)
  await prisma.personalityOwner.upsert({
    where: { personalityId_userId: { personalityId: mapped.personality.id, userId: ownerId } },
    create: { personalityId: mapped.personality.id, userId: ownerId, role: 'owner' },
    update: {},
  });

  logger.info(
    { personalityId: mapped.personality.id, slug: mapped.personality.slug },
    '[ShapesImportJob] Created/updated personality with LLM config'
  );

  return { personalityId: mapped.personality.id, slug: mapped.personality.slug };
}

async function upsertSystemPrompt(
  prisma: PrismaClient,
  sp: MappedPersonalityData['systemPrompt']
): Promise<void> {
  await prisma.systemPrompt.upsert({
    where: { id: sp.id },
    create: { id: sp.id, name: sp.name, content: sp.content },
    update: { content: sp.content },
  });
}

async function upsertPersonality(
  prisma: PrismaClient,
  mapped: MappedPersonalityData,
  ownerId: string
): Promise<void> {
  const customFieldsJson = (mapped.personality.customFields ?? undefined) as
    | Prisma.InputJsonValue
    | undefined;
  await prisma.personality.upsert({
    where: { slug: mapped.personality.slug },
    create: {
      ...mapped.personality,
      customFields: customFieldsJson,
      ownerId,
      systemPromptId: mapped.systemPrompt.id,
    },
    update: {
      characterInfo: mapped.personality.characterInfo,
      personalityTraits: mapped.personality.personalityTraits,
      personalityTone: mapped.personality.personalityTone,
      personalityAge: mapped.personality.personalityAge,
      personalityAppearance: mapped.personality.personalityAppearance,
      personalityLikes: mapped.personality.personalityLikes,
      personalityDislikes: mapped.personality.personalityDislikes,
      conversationalGoals: mapped.personality.conversationalGoals,
      conversationalExamples: mapped.personality.conversationalExamples,
      errorMessage: mapped.personality.errorMessage,
      birthMonth: mapped.personality.birthMonth,
      birthDay: mapped.personality.birthDay,
      birthYear: mapped.personality.birthYear,
      customFields: customFieldsJson,
      systemPromptId: mapped.systemPrompt.id,
    },
  });
}

async function upsertLlmConfig(
  prisma: PrismaClient,
  llm: MappedPersonalityData['llmConfig'],
  ownerId: string
): Promise<void> {
  const advancedParamsJson = llm.advancedParameters as Prisma.InputJsonValue;
  await prisma.llmConfig.upsert({
    where: { id: llm.id },
    create: {
      id: llm.id,
      name: llm.name,
      description: llm.description,
      model: llm.model,
      provider: llm.provider,
      advancedParameters: advancedParamsJson,
      memoryScoreThreshold: llm.memoryScoreThreshold,
      memoryLimit: llm.memoryLimit,
      contextWindowTokens: llm.contextWindowTokens,
      maxMessages: llm.maxMessages,
      ownerId,
      isGlobal: false,
      isDefault: false,
    },
    update: {
      model: llm.model,
      advancedParameters: advancedParamsJson,
      memoryScoreThreshold: llm.memoryScoreThreshold,
      memoryLimit: llm.memoryLimit,
      maxMessages: llm.maxMessages,
    },
  });
}

export async function downloadAndStoreAvatar(
  prisma: PrismaClient,
  personalityId: string,
  avatarUrl: string
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AVATAR_TIMEOUT_MS);

  try {
    const response = await fetch(avatarUrl, {
      headers: { 'User-Agent': SHAPES_USER_AGENT },
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn(
        { personalityId, status: response.status },
        '[ShapesImportJob] Failed to download avatar — skipping'
      );
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length > MAX_AVATAR_BYTES) {
      logger.warn(
        { personalityId, sizeBytes: buffer.length, maxBytes: MAX_AVATAR_BYTES },
        '[ShapesImportJob] Avatar exceeds size limit — skipping'
      );
      return;
    }

    await prisma.personality.update({
      where: { id: personalityId },
      data: { avatarData: buffer },
    });

    logger.info(
      { personalityId, sizeBytes: buffer.length },
      '[ShapesImportJob] Avatar downloaded and stored'
    );
  } catch (error) {
    // Non-fatal — personality is usable without an avatar
    if (error instanceof DOMException && error.name === 'AbortError') {
      logger.warn(
        { personalityId, timeoutMs: AVATAR_TIMEOUT_MS },
        '[ShapesImportJob] Avatar download timed out — skipping'
      );
    } else {
      logger.warn(
        { err: error, personalityId },
        '[ShapesImportJob] Avatar download failed — skipping'
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}
