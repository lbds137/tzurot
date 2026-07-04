/**
 * Config Step
 *
 * Resolves LLM configuration with user overrides.
 * Hierarchy: user-personality > user-default > personality default
 */

import {
  HARDCODED_CONFIG_DEFAULTS,
  type ConfigOverrideSource,
  type ResolvedConfigOverrides,
} from '@tzurot/common-types/schemas/api/configOverrides';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ConfigCascadeResolver } from '@tzurot/config-resolver';
import type { IPipelineStep, GenerationContext, ResolvedConfig } from '../types.js';

const logger = createLogger('ConfigStep');

/** Build a ResolvedConfigOverrides with all hardcoded defaults */
function buildDefaultOverrides(): ResolvedConfigOverrides {
  const fields = Object.keys(
    HARDCODED_CONFIG_DEFAULTS
  ) as (keyof typeof HARDCODED_CONFIG_DEFAULTS)[];
  const sources = {} as Record<keyof typeof HARDCODED_CONFIG_DEFAULTS, ConfigOverrideSource>;
  for (const field of fields) {
    sources[field] = 'hardcoded';
  }
  return { ...HARDCODED_CONFIG_DEFAULTS, sources };
}

export class ConfigStep implements IPipelineStep {
  readonly name = 'ConfigResolution';

  constructor(private readonly cascadeResolver?: ConfigCascadeResolver) {}

  async process(context: GenerationContext): Promise<GenerationContext> {
    const { job } = context;
    const { personality, context: jobContext, configSource: stampedSource } = job.data;

    // The effective LLM model/visionModel is resolved + stamped onto the
    // personality by the gateway's job-chain step (jobChainOrchestrator), so
    // ConfigStep no longer re-runs the LLM model cascade. The personality on the
    // job is already the user-cascaded one; `configSource` rides along as a
    // diagnostic. This step still owns the config-overrides cascade below.
    const effectivePersonality = personality;
    const configSource: ResolvedConfig['configSource'] = stampedSource ?? 'personality';

    // Resolve config cascade overrides (if resolver available)
    // Default to hardcoded values so downstream code always has a valid object
    let configOverrides: ResolvedConfigOverrides =
      context.configOverrides ?? buildDefaultOverrides();
    if (this.cascadeResolver) {
      try {
        configOverrides = await this.cascadeResolver.resolveOverrides(
          jobContext.userId,
          personality.id,
          jobContext.channelId
        );
      } catch (error) {
        logger.warn(
          { err: error, userId: jobContext.userId },
          'Failed to resolve config cascade, using hardcoded defaults'
        );
      }
    }

    return {
      ...context,
      config: {
        effectivePersonality,
        configSource,
      },
      configOverrides,
    };
  }
}
