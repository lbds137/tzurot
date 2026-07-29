/**
 * Shared Settings Update Utility
 *
 * Maps dashboard setting IDs to API PATCH body format.
 * Used by all three settings dashboards (admin, channel, personality).
 *
 * All tiers use the same body shape: `{ [settingId]: value }` — a flat
 * Partial<ConfigOverrides> object. The API uses merge semantics:
 * sending null for a field clears that override.
 */

import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingUpdateHandler,
  DashboardView,
  SettingType,
  isPlainSetting,
} from './types.js';
import {
  buildOverviewMessage,
  buildSettingMessage,
  getSettingById,
} from './SettingsDashboardBuilder.js';
import { storeSession } from './SettingsSessionStorage.js';

const logger = createLogger('settings-update');

/** Config override field names that map to SettingsData keys */
const SETTING_FIELDS = [
  'maxMessages',
  'maxImages',
  'crossChannelHistoryEnabled',
  'shareLtmAcrossPersonalities',
  'memoryScoreThreshold',
  'memoryLimit',
  'showModelFooter',
  'voiceResponseMode',
  'voiceTranscriptionEnabled',
] as const;

/**
 * Map dashboard setting ID to API PATCH body.
 *
 * Returns a flat `Partial<ConfigOverrides>` object suitable for sending
 * directly to any config cascade tier endpoint. Returns null if the
 * setting ID is not recognized.
 *
 * Special cases:
 * - maxAge: -1 (CONFIG_WIRE_OFF) means "off" and is sent AS -1 — the gateway
 *   persists it as stored JSON null, an explicit terminal OFF at this tier
 *   (does NOT fall through to lower tiers)
 * - null values: mean "auto" → clear override (mergeConfigOverrides strips the key)
 */
export function mapSettingToApiUpdate(
  settingId: string,
  value: unknown
): Record<string, unknown> | null {
  // maxAge: "off" (-1) and "auto" (null) are DIFFERENT wire states — collapsing
  // them was the off-vs-inherit bug (off silently meant inherit).
  if (settingId === 'maxAge') {
    if (value === null) {
      return { maxAge: null }; // "auto" → clear override at this tier
    }
    return { maxAge: value }; // seconds, or -1 (CONFIG_WIRE_OFF) → explicit OFF
  }

  // All other settings: null = clear override (auto/inherit), otherwise set the value
  if (SETTING_FIELDS.includes(settingId as (typeof SETTING_FIELDS)[number])) {
    return { [settingId]: value };
  }

  return null;
}

/**
 * Handle the set button — directly set a value (tri-state/boolean/enum
 * buttons). Lives here with the update mapping (rather than in
 * SettingsDashboardHandler) so the router file stays under the `max-lines`
 * cap; the router dispatches to it for the 'set' action.
 */
export async function handleSetButton(
  interaction: ButtonInteraction,
  config: SettingsDashboardConfig,
  session: SettingsDashboardSession,
  extra: string | undefined,
  updateHandler: SettingUpdateHandler
): Promise<void> {
  if (extra === undefined) {
    // Reached via the already-deferred `set` action; a bare return would leave the
    // interaction unresolved. No current builder produces a `set` customId without
    // the setting:value extra, but a stale message or future builder change could.
    logger.warn('Set button missing extra data');
    await interaction.followUp({
      content: 'Invalid button data. Please run the command again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Parse setting:value format (single split — values may contain colons)
  const colonIdx = extra.indexOf(':');
  const settingId = extra.slice(0, colonIdx);
  const rawValue = extra.slice(colonIdx + 1);
  const setting = getSettingById(config, settingId);

  if (setting === undefined) {
    // followUp/editReply throughout — the router deferUpdate'd before dispatch.
    await interaction.followUp({
      content: 'Unknown setting.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Parse the value
  let newValue: unknown;
  switch (rawValue) {
    case 'auto':
      newValue = null; // Auto means inherit
      break;
    case 'true':
      newValue = true;
      break;
    case 'false':
      newValue = false;
      break;
    default:
      newValue = rawValue;
  }

  // Non-cascading settings have no inherit tier — a null here can only come
  // from a forged/stale `:auto` customId (no plain-mode builder renders an
  // Auto button). Reject with a friendly message rather than letting the
  // update handler surface a raw validation error.
  if (
    newValue === null &&
    (isPlainSetting(config, setting) || setting.type === SettingType.BOOLEAN)
  ) {
    await interaction.followUp({
      content: 'This setting has no Auto — set an explicit value.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Call the update handler
  const result = await updateHandler(interaction, session, settingId, newValue);

  if (!result.success) {
    await interaction.followUp({
      content: `Failed to update: ${result.error}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Update session with new data (a successful update clears any pending
  // rejected-input state — the retry affordance is per-failure, not sticky)
  if (result.newData !== undefined) {
    session.data = result.newData;
  }
  session.lastRejectedInput = undefined;
  session.lastActivityAt = new Date();
  await storeSession(session, config.entityType);

  // Rebuild the current view
  if (session.view === DashboardView.SETTING && session.activeSetting !== undefined) {
    const activeSetting = getSettingById(config, session.activeSetting);
    if (activeSetting !== undefined) {
      const message = buildSettingMessage(config, session, activeSetting);
      await interaction.editReply({
        embeds: message.embeds,
        components: message.components,
      });
      return;
    }
  }

  // Default: return to overview
  const message = buildOverviewMessage(config, session);
  await interaction.editReply({
    embeds: message.embeds,
    components: message.components,
  });
}
