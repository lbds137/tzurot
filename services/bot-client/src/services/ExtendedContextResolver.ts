/**
 * Extended Context Resolver
 *
 * Resolves whether extended context (Discord channel history) should be used
 * for AI responses. Implements 3-layer resolution:
 *
 * 1. Personality opt-out: If personality.supportsExtendedContext = false, NEVER enable
 * 2. Channel override: If ChannelSettings.extendedContext is set, use that value
 * 3. Global default: Use BotSettings.extended_context_default (defaults to false)
 */

import { createLogger } from '@tzurot/common-types';
import type { LoadedPersonality } from '../types.js';
import { GatewayClient } from '../utils/GatewayClient.js';

const logger = createLogger('ExtendedContextResolver');

/**
 * Source of the extended context setting
 */
export type ExtendedContextSource = 'personality' | 'channel' | 'global';

/**
 * Result of resolving extended context setting
 */
export interface ExtendedContextResolution {
  /** Whether extended context is enabled */
  enabled: boolean;
  /** Where the setting came from */
  source: ExtendedContextSource;
}

/**
 * Resolves extended context settings with caching
 */
export class ExtendedContextResolver {
  constructor(private gatewayClient: GatewayClient) {}

  /**
   * Resolve whether extended context should be used for a channel/personality
   *
   * Resolution priority:
   * 1. If personality doesn't support extended context -> DISABLED
   * 2. If channel has explicit setting -> use channel setting
   * 3. Otherwise -> use global default (false if not set)
   *
   * @param channelId - Discord channel ID
   * @param personality - Loaded personality (includes supportsExtendedContext)
   * @returns Resolution with enabled status and source
   */
  async resolve(
    channelId: string,
    personality: LoadedPersonality
  ): Promise<ExtendedContextResolution> {
    // Check 1: Personality opt-out (hard block)
    if (personality.supportsExtendedContext === false) {
      logger.debug(
        { channelId, personalitySlug: personality.slug },
        '[ExtendedContextResolver] Personality does not support extended context'
      );
      return {
        enabled: false,
        source: 'personality',
      };
    }

    // Check 2: Channel-specific override
    const channelSettings = await this.gatewayClient.getChannelSettings(channelId);

    if (channelSettings?.hasSettings === true && channelSettings.settings !== undefined) {
      const channelExtendedContext = channelSettings.settings.extendedContext;

      // If channel has explicit setting (not null), use it
      if (channelExtendedContext !== null) {
        logger.debug(
          {
            channelId,
            extendedContext: channelExtendedContext,
          },
          '[ExtendedContextResolver] Using channel-specific extended context setting'
        );
        return {
          enabled: channelExtendedContext,
          source: 'channel',
        };
      }
    }

    // Check 3: Global default
    const globalDefault = await this.gatewayClient.getExtendedContextDefault();

    logger.debug(
      {
        channelId,
        globalDefault,
      },
      '[ExtendedContextResolver] Using global extended context default'
    );

    return {
      enabled: globalDefault,
      source: 'global',
    };
  }
}
