/**
 * Voice Clear Handler
 * Deletes ALL tzurot-prefixed voices with destructive confirmation.
 *
 * `createHardDeleteConfig({ source: 'voice', ... })` is load-bearing: it
 * generates customIds prefixed `voice::destructive::...` so CommandHandler
 * routes confirm/cancel/modal interactions to /voice's handleButton +
 * handleModal. Using `source: 'settings'` would route to /settings, which
 * no longer dispatches voice-clear after the /voice consolidation.
 */

import { EmbedBuilder, type ButtonInteraction, type ModalSubmitInteraction } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import {
  buildDestructiveWarning,
  createHardDeleteConfig,
  handleDestructiveConfirmButton,
  handleDestructiveCancel,
  handleDestructiveModalSubmit,
} from '../../../utils/destructiveConfirmation.js';
import { DestructiveCustomIds } from '../../../utils/customIds.js';
import { invalidateVoiceCache } from './voiceCache.js';

const logger = createLogger('voice-voices-clear');

/** Operation name for destructive confirmation custom IDs */
export const VOICE_CLEAR_OPERATION = 'voice-clear';

/**
 * Handle /voice voices clear
 * Shows destructive confirmation before clearing all tzurot voices
 */
export async function handleClearVoices(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.listVoices();

    if (!result.ok) {
      await context.editReply({ content: `❌ ${result.error}` });
      return;
    }

    if (result.data.voices.length === 0) {
      await context.editReply({ content: 'No Tzurot voices to clear.' });
      return;
    }

    // Don't show a count in the warning. The warning fires on a snapshot
    // from this GET; the actual delete happens server-side on a re-fetched
    // snapshot in POST /user/voices/clear, which can drift if the user's
    // voice slate changes between the two calls (concurrent clone from a
    // parallel session). The result message reports the gateway's actual
    // "deleted N/M" count from the same snapshot it deleted from, so the
    // user gets accurate post-delete numbers without a misleading pre-count.
    const count = result.data.voices.length;
    const config = createHardDeleteConfig({
      entityType: 'cloned voices',
      entityName: 'all your Tzurot voices',
      additionalWarning:
        'This will remove all auto-cloned voices from your audio provider accounts.\n' +
        'They will be re-cloned automatically when needed.',
      source: 'voice',
      operation: VOICE_CLEAR_OPERATION,
      entityId: 'all',
    });

    const warning = buildDestructiveWarning(config);
    await context.editReply(warning);

    logger.info({ userId, voiceCount: count }, 'Showing confirmation');
  } catch (error) {
    logger.error({ err: error, userId }, 'Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}

/**
 * Handle confirm button for voice-clear operation
 */
export async function handleVoiceClearConfirmButton(interaction: ButtonInteraction): Promise<void> {
  const config = createHardDeleteConfig({
    entityType: 'cloned voices',
    entityName: 'all Tzurot voices',
    additionalWarning: 'This will remove all auto-cloned voices from your audio provider accounts.',
    source: 'settings',
    operation: VOICE_CLEAR_OPERATION,
    entityId: 'all',
  });

  await handleDestructiveConfirmButton(interaction, config);
}

/**
 * Handle modal submit for voice-clear operation
 */
export async function handleVoiceClearModalSubmit(
  interaction: ModalSubmitInteraction
): Promise<void> {
  const userId = interaction.user.id;

  await handleDestructiveModalSubmit(interaction, 'DELETE', async () => {
    const { userClient } = clientsFor(interaction);
    const result = await userClient.clearVoices();

    if (!result.ok) {
      return { success: false, errorMessage: `❌ ${result.error}` };
    }

    const { deleted, total, errors } = result.data;

    const embed = new EmbedBuilder()
      .setTitle('🗑️ Voices Cleared')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTimestamp();

    if (errors !== undefined && errors.length > 0) {
      // Truncate error list to avoid exceeding Discord's 2048-char embed description limit.
      // With ~50 voices and verbose error messages, the full list can easily overflow.
      const MAX_ERRORS_SHOWN = 5;
      const shownErrors = errors.slice(0, MAX_ERRORS_SHOWN);
      const overflow =
        errors.length > MAX_ERRORS_SHOWN ? `\n…and ${errors.length - MAX_ERRORS_SHOWN} more` : '';
      embed.setDescription(
        `Deleted **${deleted}/${total}** voices. ${errors.length} failed:\n` +
          shownErrors.map(e => `• ${e}`).join('\n') +
          overflow
      );
      embed.setColor(DISCORD_COLORS.WARNING);
    } else {
      embed.setDescription(`Deleted **${deleted}** cloned voice${deleted !== 1 ? 's' : ''}.`);
    }

    // Invalidate autocomplete cache so deleted voices don't appear in /voice voices delete
    invalidateVoiceCache(userId);

    logger.info({ userId, deleted, total }, 'Cleared voices');

    return { success: true, successEmbed: embed };
  });
}

/**
 * Route button interactions for voice-clear destructive confirmation
 */
export async function handleVoiceClearButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = DestructiveCustomIds.parse(interaction.customId);
  if (parsed === null) {
    return;
  }

  if (parsed.action === 'cancel_button') {
    await handleDestructiveCancel(interaction, 'Voice clear cancelled.');
    return;
  }

  if (parsed.action === 'confirm_button') {
    await handleVoiceClearConfirmButton(interaction);
  }
}

/**
 * Route modal interactions for voice-clear destructive confirmation
 */
export async function handleVoiceClearModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parsed = DestructiveCustomIds.parse(interaction.customId);
  if (parsed === null) {
    return;
  }

  if (parsed.action === 'modal_submit') {
    await handleVoiceClearModalSubmit(interaction);
  }
}
