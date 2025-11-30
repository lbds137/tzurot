/**
 * Config Step
 *
 * Resolves LLM configuration with user overrides.
 * Hierarchy: user-personality > user-default > personality default
 */

import { createLogger } from '@tzurot/common-types';
import type { LlmConfigResolver } from '../../../../services/LlmConfigResolver.js';
import type { IPipelineStep, GenerationContext, ResolvedConfig } from '../types.js';

const logger = createLogger('ConfigStep');

export class ConfigStep implements IPipelineStep {
  readonly name = 'ConfigResolution';

  constructor(private readonly configResolver?: LlmConfigResolver) {}

  async process(context: GenerationContext): Promise<GenerationContext> {
    const { job } = context;
    const { personality, context: jobContext } = job.data;

    let effectivePersonality = personality;
    let configSource: ResolvedConfig['configSource'] = 'personality';

    if (this.configResolver) {
      try {
        const configResult = await this.configResolver.resolveConfig(
          jobContext.userId,
          personality.id,
          personality
        );

        configSource = configResult.source;

        // If user has an override, apply it to the personality
        if (configResult.source !== 'personality') {
          effectivePersonality = {
            ...personality,
            model: configResult.config.model,
            visionModel: configResult.config.visionModel ?? personality.visionModel,
            temperature: configResult.config.temperature ?? personality.temperature,
            topP: configResult.config.topP ?? personality.topP,
            topK: configResult.config.topK ?? personality.topK,
            frequencyPenalty: configResult.config.frequencyPenalty ?? personality.frequencyPenalty,
            presencePenalty: configResult.config.presencePenalty ?? personality.presencePenalty,
            repetitionPenalty:
              configResult.config.repetitionPenalty ?? personality.repetitionPenalty,
            maxTokens: configResult.config.maxTokens ?? personality.maxTokens,
            memoryScoreThreshold:
              configResult.config.memoryScoreThreshold ?? personality.memoryScoreThreshold,
            memoryLimit: configResult.config.memoryLimit ?? personality.memoryLimit,
            contextWindowTokens:
              configResult.config.contextWindowTokens ?? personality.contextWindowTokens,
          };

          logger.info(
            {
              userId: jobContext.userId,
              personalityId: personality.id,
              source: configResult.source,
              configName: configResult.configName,
              model: effectivePersonality.model,
            },
            '[ConfigStep] Applied user config override'
          );
        }
      } catch (error) {
        logger.warn(
          { err: error, userId: jobContext.userId },
          '[ConfigStep] Failed to resolve user config, using personality default'
        );
      }
    }

    return {
      ...context,
      config: {
        effectivePersonality,
        configSource,
      },
    };
  }
}
