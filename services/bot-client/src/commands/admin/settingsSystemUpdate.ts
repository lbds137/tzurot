/**
 * System-settings dashboard write path (the owner-only, non-cascading bag).
 * Extracted from admin/settings.ts to keep that file within the max-lines
 * budget; dispatched to by settingId registry membership (see
 * dispatchSettingUpdate there).
 */

import { MessageFlags, type ButtonInteraction, type ModalSubmitInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { SystemSettings } from '@tzurot/common-types/schemas/api/systemSettings';
import { SYSTEM_SETTINGS_REGISTRY } from '@tzurot/common-types/schemas/api/systemSettingsRegistry';
import { clientsFor } from '../../utils/gatewayClients.js';
import { invalidateAdminSettingsCache } from '../../utils/gatewayServiceCalls.js';
import { parseSlugList } from '../../utils/dashboard/settings/parseSlugList.js';
import {
  type SettingsData,
  type SettingsDashboardSession,
  type SettingUpdateResult,
  buildSystemSettingsData,
} from '../../utils/dashboard/settings/index.js';

const logger = createLogger('admin-settings-system');

/**
 * Handle SYSTEM setting updates from the dashboard.
 *
 * Optimistic concurrency: reads the bag FRESH per write for `expectedUpdatedAt`
 * — the token is the singleton ROW's timestamp, which cascade (configDefaults)
 * writes also bump, so a session-stored token would spuriously 409 the very
 * next System edit after any Defaults edit. The fresh read narrows the race
 * window to this call; a true concurrent write still 409s as designed.
 */
export async function handleSystemSettingUpdate(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  session: SettingsDashboardSession,
  settingId: string,
  newValue: unknown
): Promise<SettingUpdateResult> {
  const userId = interaction.user.id;
  logger.debug({ settingId, userId }, 'Updating system setting');

  try {
    const { ownerClient } = clientsFor(interaction);

    const current = await ownerClient.getSystemSettings();
    if (!current.ok) {
      return { success: false, error: `Could not read current settings: ${current.error}` };
    }

    // The dashboard's SettingType.TEXT modal always yields a raw string, but a
    // `list` control's schema field is `string[]` — coerce it the SAME way the
    // slash setter does (parseSlugList) so the two write paths never diverge on
    // what counts as a valid entry.
    const meta = SYSTEM_SETTINGS_REGISTRY[settingId as keyof SystemSettings];
    const patchValue: unknown =
      meta?.control === 'list' && typeof newValue === 'string' ? parseSlugList(newValue) : newValue;

    const result = await ownerClient.updateSystemSettings({
      expectedUpdatedAt: current.data.updatedAt,
      patch: { [settingId]: patchValue },
    });

    if (!result.ok) {
      const conflictHint =
        result.status === 409 ? ' Settings changed underneath you — try again.' : '';
      logger.warn({ settingId, error: result.error }, 'System settings write rejected');
      return { success: false, error: `${result.error}${conflictHint}` };
    }

    // Clear the service-read cache so live readers (getMultiTagCap, the voice
    // processors) see the owner's own change immediately instead of waiting
    // out the 60s TTL — mirrors the cascade write path in settings.ts.
    invalidateAdminSettingsCache();

    // Surface non-blocking write warnings (catalog fail-open notes) and the
    // restart-liveness banner — mirrors the slash setter's contract. The
    // dashboard flow refreshes in place, so these ride an ephemeral followUp.
    const notices = result.data.warnings.map(warning => `⚠️ ${warning}`);
    if (meta?.liveness === 'restart') {
      notices.push('🔄 Saved — takes effect on the next deploy/restart.');
    }
    if (notices.length > 0) {
      await interaction.followUp({ content: notices.join('\n'), flags: MessageFlags.Ephemeral });
    }

    // Merge the refreshed bag over the session map (cascade entries untouched)
    const newData: SettingsData = {
      ...session.data,
      ...buildSystemSettingsData(result.data.systemSettings),
    };
    logger.info({ settingId, userId }, 'System setting updated');
    return { success: true, newData };
  } catch (error) {
    logger.error({ err: error, settingId }, 'Error updating system setting');
    return { success: false, error: 'unexpected error, please try again' };
  }
}
