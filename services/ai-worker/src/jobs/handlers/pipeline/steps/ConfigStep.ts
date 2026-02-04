/**
 * Config Step
 *
 * Resolves LLM configuration with user overrides.
 * Hierarchy: user-personality > user-default > personality default
 */

import {
  createLogger,
  LLM_CONFIG_OVERRIDE_KEYS,
  type LoadedPersonality,
} from '@tzurot/common-types';
import type { LlmConfigResolver, ResolvedLlmConfig } from '@tzurot/common-types';
import type { IPipelineStep, GenerationContext, ResolvedConfig } from '../types.js';

const logger = createLogger('ConfigStep');

/**
 * Merge user LLM config override with personality defaults.
 * Config values take precedence; personality values are fallbacks.
 */
function mergeConfigWithPersonality(
  personality: LoadedPersonality,
  config: ResolvedLlmConfig
): LoadedPersonality {
  // Start with personality as base, override model (required field)
  const result = { ...personality, model: config.model } as LoadedPersonality;

  // For each config key, use config value if defined, else keep personality value
  for (const key of LLM_CONFIG_OVERRIDE_KEYS) {
    const configValue = config[key];
    if (configValue !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (result as any)[key] = configValue;
    }
  }

  return result;
}

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
          effectivePersonality = mergeConfigWithPersonality(personality, configResult.config);

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
