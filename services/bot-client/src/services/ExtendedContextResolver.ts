/**
 * Extended Context Resolver
 *
 * Resolves extended context settings (enabled, maxMessages, maxAge, maxImages)
 * using 3-layer cascading resolution:
 *
 * Resolution hierarchy:
 * 1. Channel OFF beats everything (server admin decision)
 * 2. Personality can opt-out even in enabled channels
 * 3. Numeric limits use "most restrictive wins" logic
 *
 * @see docs/standards/TRI_STATE_PATTERN.md
 * @see docs/planning/EXTENDED_CONTEXT_IMPROVEMENTS.md
 */

import {
  createLogger,
  resolveExtendedContextSettings,
  toGlobalSettings,
  toLevelSettings,
  type ResolvedExtendedContextSettings,
  type LevelSettings,
} from '@tzurot/common-types';
import type { LoadedPersonality } from '../types.js';
import { GatewayClient } from '../utils/GatewayClient.js';

const logger = createLogger('ExtendedContextResolver');

/**
 * Source of the extended context setting
 * @deprecated Use ResolvedExtendedContextSettings.sources instead
 */
export type ExtendedContextSource = 'personality' | 'channel' | 'global';

/**
 * Result of resolving extended context setting (legacy interface)
 * @deprecated Use ResolvedExtendedContextSettings instead
 */
export interface ExtendedContextResolution {
  /** Whether extended context is enabled */
  enabled: boolean;
  /** Where the setting came from */
  source: ExtendedContextSource;
}

/**
 * Resolves extended context settings with 3-layer cascading
 *
 * ## Eventual Consistency Note
 *
 * Settings are cached at two levels for performance:
 * - Admin settings: 60 second TTL (via GatewayClient cache)
 * - Channel settings: 30 second TTL (via GatewayClient cache)
 *
 * This means settings changes may take up to 60 seconds to propagate.
 * This is acceptable for non-critical configuration changes where:
 * - Instant propagation isn't required for correct behavior
 * - The tradeoff favors reduced API gateway load
 * - Users can wait a minute for settings to take effect
 *
 * For time-sensitive operations, callers should bypass the cache.
 */
export class ExtendedContextResolver {
  constructor(private gatewayClient: GatewayClient) {}

  /**
   * Resolve all extended context settings for a channel/personality
   *
   * Uses the new 3-layer resolver from common-types that properly handles:
   * - Channel admin intent (OFF beats everything)
   * - Personality opt-out
   * - Most restrictive wins for numeric limits
   *
   * @param channelId - Discord channel ID
   * @param personality - Loaded personality with extended context settings
   * @returns Fully resolved settings with source tracking
   */
  async resolveAll(
    channelId: string,
    personality: LoadedPersonality
  ): Promise<ResolvedExtendedContextSettings> {
    // Fetch admin settings (global defaults)
    const adminSettings = await this.gatewayClient.getAdminSettings();

    // Use sensible defaults if admin settings unavailable (shouldn't happen in production)
    const globalSettings = toGlobalSettings({
      extendedContextDefault: adminSettings?.extendedContextDefault ?? true,
      extendedContextMaxMessages: adminSettings?.extendedContextMaxMessages ?? 20,
      extendedContextMaxAge: adminSettings?.extendedContextMaxAge ?? null,
      extendedContextMaxImages: adminSettings?.extendedContextMaxImages ?? 0,
    });

    // Fetch channel settings
    let channelLevelSettings: LevelSettings | null = null;
    const channelResult = await this.gatewayClient.getChannelSettings(channelId);
    if (channelResult?.hasSettings === true && channelResult.settings !== undefined) {
      channelLevelSettings = toLevelSettings({
        extendedContext: channelResult.settings.extendedContext,
        extendedContextMaxMessages: channelResult.settings.extendedContextMaxMessages,
        extendedContextMaxAge: channelResult.settings.extendedContextMaxAge,
        extendedContextMaxImages: channelResult.settings.extendedContextMaxImages,
      });
    }

    // Get personality settings
    const personalityLevelSettings = toLevelSettings({
      extendedContext: personality.extendedContext,
      extendedContextMaxMessages: personality.extendedContextMaxMessages,
      extendedContextMaxAge: personality.extendedContextMaxAge,
      extendedContextMaxImages: personality.extendedContextMaxImages,
    });

    // Resolve using the 3-layer cascading logic
    const resolved = resolveExtendedContextSettings(
      globalSettings,
      channelLevelSettings,
      personalityLevelSettings
    );

    logger.debug(
      {
        channelId,
        personalitySlug: personality.slug,
        resolved,
      },
      '[ExtendedContextResolver] Resolved extended context settings'
    );

    return resolved;
  }

  /**
   * Resolve whether extended context should be used for a channel/personality
   *
   * @deprecated Use resolveAll() to get all settings including limits
   *
   * @param channelId - Discord channel ID
   * @param personality - Loaded personality (includes extendedContext tri-state)
   * @returns Resolution with enabled status and source
   */
  async resolve(
    channelId: string,
    personality: LoadedPersonality
  ): Promise<ExtendedContextResolution> {
    const resolved = await this.resolveAll(channelId, personality);

    return {
      enabled: resolved.enabled,
      source: resolved.sources.enabled,
    };
  }
}
