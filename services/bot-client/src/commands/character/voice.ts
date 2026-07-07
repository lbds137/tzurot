/**
 * Character Voice Handler
 *
 * Handles voice reference upload and clear for characters.
 * Mirrors the avatar handler pattern — upload downloads from Discord CDN,
 * base64-encodes, and sends to the gateway API. Clear nulls the reference.
 *
 * Auto-toggles voiceEnabled: upload sets true, clear sets false.
 */

import { escapeMarkdown } from 'discord.js';
import { type EnvConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../utils/apiCheck.js';
import type { UserClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import { validateDiscordCdnUrl } from '../../utils/discordCdnGuard.js';
import { validateAudioAttachment } from './mediaValidation.js';
import { fetchCharacter, updateCharacter, type FetchedCharacter } from './api.js';

const logger = createLogger('character-voice');

/**
 * Fetch a character and verify the user has edit permission.
 * Sends error reply and returns null if the character is not found or not editable.
 */
async function fetchEditableCharacter(
  slug: string,
  config: EnvConfig,
  userClient: UserClient,
  context: DeferredCommandContext
): Promise<FetchedCharacter | null> {
  const character = await fetchCharacter(slug, config, userClient);
  if (!character) {
    await context.editReply(
      `❌ Character \`${escapeMarkdown(slug)}\` not found or not accessible.`
    );
    return null;
  }
  if (!character.canEdit) {
    await context.editReply(
      `❌ You don't have permission to edit \`${escapeMarkdown(slug)}\`.\n` +
        'You can only edit characters you own.'
    );
    return null;
  }
  return character;
}

/**
 * Handle /character voice upload
 */
async function handleVoiceUpload(
  context: DeferredCommandContext,
  config: EnvConfig
): Promise<void> {
  const interaction = context.interaction;
  const slug = interaction.options.getString('character', true);
  if (isAutocompleteErrorSentinel(slug)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }
  const attachment = interaction.options.getAttachment('audio', true);
  const userId = context.user.id;
  const { contentType } = attachment;

  const validationError = validateAudioAttachment(attachment);
  if (validationError !== null) {
    await context.editReply(validationError);
    return;
  }

  // Validate attachment URL is from Discord CDN (SSRF defense-in-depth)
  const cdnGuard = validateDiscordCdnUrl(attachment.url, logger);
  if (!cdnGuard.ok) {
    await context.editReply('❌ Invalid attachment URL.');
    return;
  }

  const { userClient } = clientsFor(context.interaction);

  try {
    // Check permissions
    const character = await fetchEditableCharacter(slug, config, userClient, context);
    if (!character) {
      return;
    }

    // Download audio from Discord CDN (30s timeout to avoid holding the deferred interaction)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let audioResponse: Response;
    try {
      audioResponse = await fetch(attachment.url, { signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        await context.editReply(
          '❌ Voice download timed out. Discord may be slow — please try again.'
        );
        return;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (!audioResponse.ok) {
      await context.editReply('❌ Failed to download the audio file. Please try again.');
      return;
    }

    const rawBuffer = Buffer.from(await audioResponse.arrayBuffer());
    const base64Audio = `data:${contentType};base64,${rawBuffer.toString('base64')}`;

    // Update character with voice reference and auto-enable voice
    await updateCharacter(
      slug,
      { voiceReferenceData: base64Audio, voiceEnabled: true },
      userClient,
      config
    );

    logger.info(
      { slug, userId, sizeKB: Math.round(rawBuffer.length / 1024) },
      'Character voice reference uploaded'
    );

    await context.editReply(
      `✅ Voice reference uploaded for **${character.displayName ?? character.name}**! Voice is now enabled.`
    );
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to upload voice reference');
    await context.editReply('❌ Failed to upload voice reference. Please try again.');
  }
}

/**
 * Handle /character voice clear
 */
async function handleVoiceClear(context: DeferredCommandContext, config: EnvConfig): Promise<void> {
  const interaction = context.interaction;
  const slug = interaction.options.getString('character', true);
  if (isAutocompleteErrorSentinel(slug)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }
  const userId = context.user.id;

  const { userClient } = clientsFor(context.interaction);

  try {
    // Check permissions
    const character = await fetchEditableCharacter(slug, config, userClient, context);
    if (!character) {
      return;
    }

    // Clear voice reference and disable voice
    await updateCharacter(
      slug,
      { voiceReferenceData: null, voiceEnabled: false },
      userClient,
      config
    );

    await context.editReply(
      `✅ Voice reference removed for **${character.displayName ?? character.name}**. Voice is now disabled.`
    );

    logger.info({ slug, userId }, 'Character voice reference cleared');
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to clear voice reference');
    await context.editReply('❌ Failed to clear voice reference. Please try again.');
  }
}

/**
 * Handle /character voice subcommands
 * Routes to upload or clear based on subcommand name
 */
export async function handleVoice(
  context: DeferredCommandContext,
  config: EnvConfig
): Promise<void> {
  const subcommand = context.interaction.options.getSubcommand();

  // Subcommands are registered flat: 'voice', 'voice-clear'
  if (subcommand === 'voice') {
    await handleVoiceUpload(context, config);
  } else if (subcommand === 'voice-clear') {
    await handleVoiceClear(context, config);
  } else {
    logger.warn({ subcommand }, 'Unexpected voice subcommand');
    await context.editReply('❌ Unknown voice command.');
  }
}
