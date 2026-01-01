/**
 * Extended Context Resolver
 *
 * Resolves whether extended context (Discord channel history) should be used
 * for AI responses. Implements 3-layer tri-state resolution:
 *
 * Resolution cascade (first non-null value wins):
 * 1. Personality: If extendedContext is true/false, use it
 * 2. Channel: If extendedContext is true/false, use it
 * 3. Global: Use BotSettings.extended_context_default (defaults to false)
 *
 * @see docs/standards/TRI_STATE_PATTERN.md
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
   * Resolution cascade (first non-null value wins):
   * 1. Personality OFF (false) -> disabled
   * 2. Personality ON (true) -> enabled
   * 3. Personality AUTO (null) -> check channel
   * 4. Channel OFF (false) -> disabled
   * 5. Channel ON (true) -> enabled
   * 6. Channel AUTO (null) -> use global default
   *
   * @param channelId - Discord channel ID
   * @param personality - Loaded personality (includes extendedContext tri-state)
   * @returns Resolution with enabled status and source
   */
  async resolve(
    channelId: string,
    personality: LoadedPersonality
  ): Promise<ExtendedContextResolution> {
    // Check 1: Personality OFF (force disable)
    if (personality.extendedContext === false) {
      logger.debug(
        { channelId, personalitySlug: personality.slug },
        '[ExtendedContextResolver] Personality extended context OFF'
      );
      return {
        enabled: false,
        source: 'personality',
      };
    }

    // Check 2: Personality ON (force enable)
    if (personality.extendedContext === true) {
      logger.debug(
        { channelId, personalitySlug: personality.slug },
        '[ExtendedContextResolver] Personality extended context ON'
      );
      return {
        enabled: true,
        source: 'personality',
      };
    }

    // Check 3: Personality AUTO (null) - fall through to channel
    const channelSettings = await this.gatewayClient.getChannelSettings(channelId);

    if (channelSettings?.hasSettings === true && channelSettings.settings !== undefined) {
      const channelExtendedContext = channelSettings.settings.extendedContext;

      // Check 4: Channel OFF (force disable)
      if (channelExtendedContext === false) {
        logger.debug({ channelId }, '[ExtendedContextResolver] Channel extended context OFF');
        return {
          enabled: false,
          source: 'channel',
        };
      }

      // Check 5: Channel ON (force enable)
      if (channelExtendedContext === true) {
        logger.debug({ channelId }, '[ExtendedContextResolver] Channel extended context ON');
        return {
          enabled: true,
          source: 'channel',
        };
      }
    }

    // Check 6: Channel AUTO (null) or no settings - use global default
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
