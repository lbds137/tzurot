/**
 * Voice Clear Handler
 * Deletes ALL tzurot-prefixed voices with destructive confirmation
 */

import { EmbedBuilder } from 'discord.js';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi, GATEWAY_TIMEOUTS, toGatewayUser } from '../../../utils/userGatewayClient.js';
import {
  buildDestructiveWarning,
  createHardDeleteConfig,
  handleDestructiveConfirmButton,
  handleDestructiveCancel,
  handleDestructiveModalSubmit,
} from '../../../utils/destructiveConfirmation.js';
import { DestructiveCustomIds } from '../../../utils/customIds.js';
import type { VoicesListResponse } from './types.js';
import { invalidateVoiceCache } from './voiceCache.js';

const logger = createLogger('settings-voices-clear');

/** Operation name for destructive confirmation custom IDs */
export const VOICE_CLEAR_OPERATION = 'voice-clear';

interface VoiceClearResponse {
  deleted: number;
  total: number;
  message?: string;
  errors?: string[];
}

/**
 * Handle /settings voices clear
 * Shows destructive confirmation before clearing all tzurot voices
 */
export async function handleClearVoices(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await callGatewayApi<VoicesListResponse>('/user/voices', {
      user: toGatewayUser(context.user),
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    });

    if (!result.ok) {
      await context.editReply({ content: `❌ ${result.error}` });
      return;
    }

    if (result.data.voices.length === 0) {
      await context.editReply({ content: 'No Tzurot voices to clear.' });
      return;
    }

    const count = result.data.voices.length;
    const config = createHardDeleteConfig({
      entityType: 'cloned voices',
      entityName: `${count} Tzurot voice${count !== 1 ? 's' : ''}`,
      additionalWarning:
        'This will remove all auto-cloned voices from your ElevenLabs account.\n' +
        'They will be re-cloned automatically when needed.',
      source: 'settings',
      operation: VOICE_CLEAR_OPERATION,
      entityId: 'all',
    });

    const warning = buildDestructiveWarning(config);
    await context.editReply(warning);

    logger.info({ userId, voiceCount: count }, '[Voices Clear] Showing confirmation');
  } catch (error) {
    logger.error({ err: error, userId }, '[Voices Clear] Unexpected error');
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
    additionalWarning: 'This will remove all auto-cloned voices from your ElevenLabs account.',
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
    const result = await callGatewayApi<VoiceClearResponse>('/user/voices/clear', {
      method: 'POST',
      user: toGatewayUser(interaction.user),
      timeout: GATEWAY_TIMEOUTS.BULK_OPERATION,
    });

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

    // Invalidate autocomplete cache so deleted voices don't appear in /settings voices delete
    invalidateVoiceCache(userId);

    logger.info({ userId, deleted, total }, '[Voices Clear] Cleared voices');

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
