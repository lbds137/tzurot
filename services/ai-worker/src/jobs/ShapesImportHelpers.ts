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
import { mapShapesConfigToPersonality } from '../services/shapes/ShapesPersonalityMapper.js';

const logger = createLogger('ShapesImportJob');

/** Max avatar size (10MB — matches Discord's limit) */
const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

export async function createFullPersonality(
  prisma: PrismaClient,
  config: ShapesIncPersonalityConfig,
  slug: string,
  ownerId: string
): Promise<{ personalityId: string; slug: string }> {
  const mapped = mapShapesConfigToPersonality(config, slug);

  // Create system prompt
  await prisma.systemPrompt.upsert({
    where: { id: mapped.systemPrompt.id },
    create: {
      id: mapped.systemPrompt.id,
      name: mapped.systemPrompt.name,
      content: mapped.systemPrompt.content,
    },
    update: {
      content: mapped.systemPrompt.content,
    },
  });

  // Create personality
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
      customFields: customFieldsJson,
      systemPromptId: mapped.systemPrompt.id,
    },
  });

  // Create LLM config and link as default
  const advancedParamsJson = mapped.llmConfig.advancedParameters as Prisma.InputJsonValue;
  await prisma.llmConfig.upsert({
    where: { id: mapped.llmConfig.id },
    create: {
      id: mapped.llmConfig.id,
      name: mapped.llmConfig.name,
      description: mapped.llmConfig.description,
      model: mapped.llmConfig.model,
      provider: mapped.llmConfig.provider,
      advancedParameters: advancedParamsJson,
      memoryScoreThreshold: mapped.llmConfig.memoryScoreThreshold,
      memoryLimit: mapped.llmConfig.memoryLimit,
      contextWindowTokens: mapped.llmConfig.contextWindowTokens,
      maxMessages: mapped.llmConfig.maxMessages,
      ownerId,
      isGlobal: false,
      isDefault: false,
    },
    update: {
      model: mapped.llmConfig.model,
      advancedParameters: advancedParamsJson,
      memoryScoreThreshold: mapped.llmConfig.memoryScoreThreshold,
      memoryLimit: mapped.llmConfig.memoryLimit,
      maxMessages: mapped.llmConfig.maxMessages,
    },
  });

  // Link as default config for this personality
  await prisma.personalityDefaultConfig.upsert({
    where: { personalityId: mapped.personality.id },
    create: {
      personalityId: mapped.personality.id,
      llmConfigId: mapped.llmConfig.id,
    },
    update: {
      llmConfigId: mapped.llmConfig.id,
    },
  });

  logger.info(
    { personalityId: mapped.personality.id, slug: mapped.personality.slug },
    '[ShapesImportJob] Created/updated personality with LLM config'
  );

  return { personalityId: mapped.personality.id, slug: mapped.personality.slug };
}

export async function downloadAndStoreAvatar(
  prisma: PrismaClient,
  personalityId: string,
  avatarUrl: string
): Promise<void> {
  try {
    const response = await fetch(avatarUrl, {
      headers: { 'User-Agent': SHAPES_USER_AGENT },
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
    logger.warn(
      { err: error, personalityId },
      '[ShapesImportJob] Avatar download failed — skipping'
    );
  }
}
