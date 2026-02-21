/**
 * Shared Personality Helpers
 *
 * Extracted from admin and user personality creation routes to eliminate duplication.
 */

import { createLogger, type PrismaClient } from '@tzurot/common-types';

const logger = createLogger('personalityHelpers');

/**
 * Set up default LLM config for a newly created personality.
 * Finds the global default LLM config and links it to the personality.
 * Logs errors but doesn't fail the creation.
 */
export async function setupDefaultLlmConfig(
  prisma: PrismaClient,
  personalityId: string,
  slug?: string
): Promise<void> {
  try {
    const defaultLlmConfig = await prisma.llmConfig.findFirst({
      where: { isGlobal: true, isDefault: true },
    });

    if (defaultLlmConfig !== null) {
      await prisma.personalityDefaultConfig.create({
        data: {
          personalityId,
          llmConfigId: defaultLlmConfig.id,
        },
      });
      logger.info(
        { personalityId, slug, configName: defaultLlmConfig.name },
        'Set default LLM config for personality'
      );
    } else {
      logger.warn({}, 'No default global LLM config found, skipping default config assignment');
    }
  } catch (error) {
    logger.error({ err: error, personalityId }, 'Failed to set default LLM config');
  }
}
