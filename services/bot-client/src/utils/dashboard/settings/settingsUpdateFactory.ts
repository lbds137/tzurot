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
 * 2. PATCH via the configured typed-client method
 * 3. Re-resolve the cascade via the configured typed-client method
 * 4. Convert resolved cascade back to SettingsData (filtering by source tier)
 *
 * Per-route `timeoutMs` on the manifest entries for `updatePersonalityOverrides`,
 * `updatePersonalityConfigDefaults`, `resolveCascade`, and `resolvePersonalityCascade`
 * carries `GATEWAY_TIMEOUTS.DEFERRED`, so the factory itself doesn't need to
 * thread a timeout — it flows through the generated client.
 */

import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import {
  type ConfigOverrides,
  type ConfigOverrideSource,
  type ResolvedConfigOverrides,
} from '@tzurot/common-types/schemas/api/configOverrides';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type GatewayResult, type UserClient } from '@tzurot/clients';
import { clientsFor } from '../../gatewayClients.js';
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
  /** Apply the PATCH via a typed-client method bound at config time */
  patchFn: (
    userClient: UserClient,
    entityId: string,
    body: ConfigOverrides
  ) => Promise<GatewayResult<unknown>>;
  /** Re-resolve the cascade via a typed-client method bound at config time */
  resolveFn: (
    userClient: UserClient,
    entityId: string
  ) => Promise<GatewayResult<ResolvedConfigOverrides>>;
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
    const { userClient } = clientsFor(interaction);

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

      // Write the patch via the typed-client method
      const result = await config.patchFn(userClient, entityId, body);

      if (!result.ok) {
        logger.warn(
          { settingId, error: result.error, entityId },
          `${config.logContext} Update failed`
        );
        return { success: false, error: result.error };
      }

      // Re-resolve cascade to get updated effective values
      const cascadeResult = await config.resolveFn(userClient, entityId);

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
