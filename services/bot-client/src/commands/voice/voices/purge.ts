/**
 * Voice Purge Handler
 * Handles /voice voices purge — destroys ALL tzurot-prefixed voices behind a
 * typed-phrase destructive confirmation (§4.1: `purge` is the destroy-all
 * verb; `clear` never destroys entities).
 *
 * `source: 'voice'` in the warning config is load-bearing: it prefixes the
 * customIds `voice::destructive::...` so CommandHandler routes confirm/
 * cancel/modal interactions to /voice's handleButton + handleModal. The
 * modal's customId is derived from the button's inside the factory, so only
 * the warning config carries routing state.
 */

import { EmbedBuilder, type ButtonInteraction, type ModalSubmitInteraction } from 'discord.js';
import { classifyGatewayFailure } from '../../../ux/catalog/classify.js';
import { renderSpec } from '../../../ux/render/render.js';
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
  hardDeleteModalDisplay,
  type DestructiveOperationResult,
} from '../../../utils/confirmation/confirmDestructive.js';
import { DestructiveCustomIds } from '../../../utils/customIds.js';
import { invalidateVoiceCache } from './voiceCache.js';

const logger = createLogger('voice-voices-purge');

/** Shared failedAction verb for the purge-voices classify paths. */
const PURGE_VOICES_ACTION = 'purge your voices';

/**
 * Operation name for destructive confirmation custom IDs. Renamed with the
 * subcommand (unlike browse prefixes, destructive confirms are minutes-lived
 * and an unmatched in-flight confirm fails CLOSED — the user just re-runs).
 */
export const VOICE_PURGE_OPERATION = 'voice-purge';

/**
 * Entity name shared by the warning config and the modal-submit validation so
 * the dynamic confirmation phrase can't drift between the two.
 */
const VOICE_PURGE_ENTITY_NAME = 'all your Tzurot voices';

/**
 * Handle /voice voices purge
 * Shows destructive confirmation before purging all tzurot voices
 */
export async function handlePurgeVoices(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.listVoices();

    if (!result.ok) {
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, 'voices', { failedAction: PURGE_VOICES_ACTION })
        ),
      });
      return;
    }

    if (result.data.voices.length === 0) {
      await context.editReply({ content: 'No Tzurot voices to purge.' });
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
      entityName: VOICE_PURGE_ENTITY_NAME,
      additionalWarning:
        'This will remove all auto-cloned voices from your audio provider accounts.\n' +
        'They will be re-cloned automatically when needed.',
      source: 'voice',
      operation: VOICE_PURGE_OPERATION,
      entityId: 'all',
    });

    const warning = buildDestructiveWarning(config);
    await context.editReply(warning);

    logger.info({ userId, voiceCount: count }, 'Showing confirmation');
  } catch (error) {
    logger.error({ err: error, userId }, 'Unexpected error');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'voices', { failedAction: PURGE_VOICES_ACTION })
      ),
    });
  }
}

/**
 * Handle confirm button for voice-purge operation.
 *
 * Display-only: the modal's routing customId is derived from the button's own
 * customId inside the factory. (The previous config-rebuild here carried
 * `source: 'settings'`, which routed the modal to /settings — whose handleModal
 * has no voice-purge branch — silently dropping the typed confirmation.)
 */
export async function handleVoicePurgeConfirmButton(interaction: ButtonInteraction): Promise<void> {
  await handleDestructiveConfirmButton(
    interaction,
    hardDeleteModalDisplay(VOICE_PURGE_ENTITY_NAME)
  );
}

/**
 * Handle modal submit for voice-purge operation
 */
export async function handleVoicePurgeModalSubmit(
  interaction: ModalSubmitInteraction
): Promise<void> {
  const userId = interaction.user.id;
  const { confirmationPhrase } = hardDeleteModalDisplay(VOICE_PURGE_ENTITY_NAME);

  const executeOperation = async (): Promise<DestructiveOperationResult> => {
    const { userClient } = clientsFor(interaction);
    const result = await userClient.clearVoices();

    if (!result.ok) {
      return {
        success: false,
        errorMessage: renderSpec(
          classifyGatewayFailure(result, 'voices', { failedAction: PURGE_VOICES_ACTION })
        ),
      };
    }

    const { deleted, total, errors } = result.data;

    const embed = new EmbedBuilder()
      .setTitle('🗑️ Voices Purged')
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

    logger.info({ userId, deleted, total }, 'Purged voices');

    return { success: true, successEmbed: embed };
  };

  await handleDestructiveModalSubmit(interaction, confirmationPhrase, executeOperation, {
    progressContent: 'Purging voices…',
  });
}

/**
 * Route button interactions for voice-purge destructive confirmation
 */
export async function handleVoicePurgeButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = DestructiveCustomIds.parse(interaction.customId);
  if (parsed === null) {
    return;
  }

  if (parsed.action === 'cancel_button') {
    await handleDestructiveCancel(interaction, 'Voice purge cancelled.');
    return;
  }

  if (parsed.action === 'confirm_button') {
    await handleVoicePurgeConfirmButton(interaction);
  }
}

/**
 * Route modal interactions for voice-purge destructive confirmation
 */
export async function handleVoicePurgeModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parsed = DestructiveCustomIds.parse(interaction.customId);
  if (parsed === null) {
    return;
  }

  if (parsed.action === 'modal_submit') {
    await handleVoicePurgeModalSubmit(interaction);
  }
}
