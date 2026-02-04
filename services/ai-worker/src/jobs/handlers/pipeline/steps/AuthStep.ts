/**
 * Auth Step
 *
 * Resolves API key from database (BYOK) and handles guest mode.
 * API keys are NEVER passed through BullMQ jobs - they're resolved at runtime.
 */

import { createLogger, AIProvider, GUEST_MODE, isFreeModel } from '@tzurot/common-types';
import type { ApiKeyResolver } from '../../../../services/ApiKeyResolver.js';
import type { LlmConfigResolver } from '@tzurot/common-types';
import type { IPipelineStep, GenerationContext } from '../types.js';

const logger = createLogger('AuthStep');

export class AuthStep implements IPipelineStep {
  readonly name = 'AuthResolution';

  constructor(
    private readonly apiKeyResolver?: ApiKeyResolver,
    private readonly configResolver?: LlmConfigResolver
  ) {}

  async process(context: GenerationContext): Promise<GenerationContext> {
    const { job, config } = context;
    const { context: jobContext } = job.data;

    if (!config) {
      throw new Error('[AuthStep] ConfigStep must run before AuthStep');
    }

    let resolvedApiKey: string | undefined;
    let resolvedProvider: string | undefined;
    let isGuestMode = false;
    let effectivePersonality = config.effectivePersonality;

    if (this.apiKeyResolver) {
      try {
        const keyResult = await this.apiKeyResolver.resolveApiKey(
          jobContext.userId,
          AIProvider.OpenRouter
        );
        resolvedApiKey = keyResult.apiKey;
        resolvedProvider = keyResult.provider;
        isGuestMode = keyResult.isGuestMode;

        logger.debug(
          {
            userId: jobContext.userId,
            source: keyResult.source,
            provider: resolvedProvider,
            isGuestMode,
          },
          '[AuthStep] Resolved API key'
        );

        // Guest Mode: Enforce free-model-only
        if (isGuestMode) {
          effectivePersonality = await this.applyGuestModeOverrides(
            effectivePersonality,
            jobContext.userId
          );
        }
      } catch (error) {
        // Log at error level - resolution failure is unexpected and should be investigated
        // (Normal guest mode is signaled via isGuestMode=true, not by throwing)
        // We still recover gracefully by falling back to guest mode
        logger.error(
          { err: error, userId: jobContext.userId },
          '[AuthStep] Failed to resolve API key, falling back to guest mode'
        );
        isGuestMode = true;

        // Apply guest mode model override
        effectivePersonality = await this.applyGuestModeOverrides(
          effectivePersonality,
          jobContext.userId
        );
      }
    }

    // Update config with potentially modified personality
    const updatedConfig = {
      ...config,
      effectivePersonality,
    };

    return {
      ...context,
      config: updatedConfig,
      auth: {
        apiKey: resolvedApiKey,
        provider: resolvedProvider,
        isGuestMode,
      },
    };
  }

  /**
   * Apply guest mode model overrides
   */
  private async applyGuestModeOverrides(
    personality: NonNullable<GenerationContext['config']>['effectivePersonality'],
    userId: string
  ): Promise<NonNullable<GenerationContext['config']>['effectivePersonality']> {
    const currentModel = personality.model;

    // If current model is already free, no change needed
    if (isFreeModel(currentModel)) {
      logger.info(
        { userId, model: personality.model },
        '[AuthStep] Guest mode active - using free model'
      );
      return personality;
    }

    // Override to guest default
    let guestModel: string = GUEST_MODE.DEFAULT_MODEL;

    // Try to get free default from database
    if (this.configResolver) {
      try {
        const freeConfig = await this.configResolver.getFreeDefaultConfig();
        if (freeConfig !== null) {
          guestModel = freeConfig.model;
          logger.debug({ model: guestModel }, '[AuthStep] Using database free default config');
        }
      } catch (error) {
        logger.warn(
          { err: error },
          '[AuthStep] Failed to get free default config, using hardcoded fallback'
        );
      }
    }

    logger.info(
      {
        userId,
        originalModel: currentModel,
        guestModel,
      },
      '[AuthStep] Guest mode: overriding paid model with free model'
    );

    return {
      ...personality,
      model: guestModel,
      // Clear vision model if not free
      visionModel:
        personality.visionModel !== undefined &&
        personality.visionModel.length > 0 &&
        isFreeModel(personality.visionModel)
          ? personality.visionModel
          : undefined,
    };
  }
}
