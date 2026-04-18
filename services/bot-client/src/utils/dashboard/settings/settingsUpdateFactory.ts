/**
 * Settings Update Handler Factory
 *
 * Creates a SettingUpdateHandler for a settings dashboard. Extracted from
 * character/settings.ts and character/overrides.ts, which had nearly-identical
 * 80-line handleSettingUpdate implementations differing only in endpoints,
 * source tier, and log context.
 *
 * Flow:
 * 1. Map setting ID to API patch body via mapSettingToApiUpdate
 * 2. PATCH to the configured endpoint
 * 3. Re-resolve the cascade via the configured resolve endpoint
 * 4. Convert resolved cascade back to SettingsData (filtering by source tier)
 */

import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import {
  createLogger,
  GATEWAY_TIMEOUTS,
  type ConfigOverrides,
  type ConfigOverrideSource,
  type ResolvedConfigOverrides,
} from '@tzurot/common-types';
import { callGatewayApi, toGatewayUser } from '../../userGatewayClient.js';
import type {
  SettingsData,
  SettingsDashboardSession,
  SettingUpdateHandler,
  SettingUpdateResult,
} from './types.js';
import { mapSettingToApiUpdate } from './settingsUpdate.js';
import { buildCascadeSettingsData } from './settingsDataBuilder.js';

const logger = createLogger('settingsUpdateFactory');

/** Configuration for a settings update handler */
export interface SettingUpdateConfig {
  /** Function to build the PATCH endpoint from entityId (e.g., personalityId) */
  patchEndpoint: (entityId: string) => string;
  /** Function to build the GET resolve endpoint from entityId */
  resolveEndpoint: (entityId: string) => string;
  /** Source tier to treat as "local" when converting the resolved cascade */
  sourceTier: ConfigOverrideSource;
  /** Log context prefix (e.g., '[Character Settings]') */
  logContext: string;
}

/**
 * Convert a resolved cascade back to dashboard SettingsData, extracting the
 * local-tier overrides by matching the configured source.
 */
export function convertCascadeToSettingsData(
  resolved: ResolvedConfigOverrides,
  sourceTier: ConfigOverrideSource
): SettingsData {
  const localOverrides: Partial<ConfigOverrides> = {};
  for (const [field, source] of Object.entries(resolved.sources)) {
    if (source === sourceTier) {
      // Safe: we only iterate config field keys from resolved.sources, never the
      // `sources` key itself, so the indexed value is always a config primitive.
      localOverrides[field as keyof ConfigOverrides] = resolved[
        field as keyof ResolvedConfigOverrides
      ] as never;
    }
  }
  return buildCascadeSettingsData(
    resolved,
    Object.keys(localOverrides).length > 0 ? localOverrides : null,
    sourceTier
  );
}

/**
 * Create a settings update handler bound to a specific entity ID.
 * The returned handler matches the SettingUpdateHandler signature and can be
 * passed directly to handleSettingsSelectMenu/Button/Modal.
 */
export function createSettingsUpdateHandler(
  entityId: string,
  config: SettingUpdateConfig
): SettingUpdateHandler {
  return async (
    interaction: ButtonInteraction | ModalSubmitInteraction,
    _session: SettingsDashboardSession,
    settingId: string,
    newValue: unknown
  ): Promise<SettingUpdateResult> => {
    const userId = interaction.user.id;
    const user = toGatewayUser(interaction.user);

    logger.debug(
      { settingId, newValue, entityId, userId },
      `${config.logContext} Updating setting`
    );

    try {
      // Map setting ID to cascade field
      const body = mapSettingToApiUpdate(settingId, newValue);
      if (body === null) {
        return { success: false, error: 'Unknown setting' };
      }

      // Write the patch to the configured endpoint
      const result = await callGatewayApi(config.patchEndpoint(entityId), {
        method: 'PATCH',
        body,
        user,
        timeout: GATEWAY_TIMEOUTS.DEFERRED,
      });

      if (!result.ok) {
        logger.warn(
          { settingId, error: result.error, entityId },
          `${config.logContext} Update failed`
        );
        return { success: false, error: result.error };
      }

      // Re-resolve cascade to get updated effective values
      const cascadeResult = await callGatewayApi<ResolvedConfigOverrides>(
        config.resolveEndpoint(entityId),
        { method: 'GET', user, timeout: GATEWAY_TIMEOUTS.DEFERRED }
      );

      if (!cascadeResult.ok) {
        return { success: false, error: 'Failed to fetch updated settings' };
      }

      const newData = convertCascadeToSettingsData(cascadeResult.data, config.sourceTier);

      logger.info(
        { settingId, newValue, entityId, userId },
        `${config.logContext} Setting updated`
      );

      return { success: true, newData };
    } catch (error) {
      logger.error(
        { err: error, settingId, entityId },
        `${config.logContext} Error updating setting`
      );
      return { success: false, error: 'Failed to update setting' };
    }
  };
}
