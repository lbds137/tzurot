/**
 * Character Avatar Handler
 *
 * Handles avatar upload/replace and clear for characters.
 * Mirrors the voice handler pattern — upload downloads from Discord CDN,
 * resizes to fit the gateway body limit, base64-encodes, and sends to the API.
 * Clear nulls the reference.
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
import { validateImageAttachment } from './mediaValidation.js';
import { fetchCharacter, updateCharacter, type FetchedCharacter } from './api.js';
import { processAvatarBuffer } from './avatarUtils.js';

const logger = createLogger('character-avatar');

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
 * Handle /character avatar upload
 */
async function handleAvatarUpload(
  context: DeferredCommandContext,
  config: EnvConfig
): Promise<void> {
  const interaction = context.interaction;
  const slug = interaction.options.getString('character', true);
  if (isAutocompleteErrorSentinel(slug)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }
  const attachment = interaction.options.getAttachment('image', true);
  const userId = context.user.id;

  const validationError = validateImageAttachment(attachment);
  if (validationError !== null) {
    await context.editReply(validationError);
    return;
  }

  const cdnGuard = validateDiscordCdnUrl(attachment.url, logger);
  if (!cdnGuard.ok) {
    await context.editReply('❌ Invalid attachment URL.');
    return;
  }

  const { userClient } = clientsFor(context.interaction);

  try {
    const character = await fetchEditableCharacter(slug, config, userClient, context);
    if (!character) {
      return;
    }

    // Download the image with a 30s timeout (pattern matches voice.ts).
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let imageResponse: Response;
    try {
      imageResponse = await fetch(attachment.url, { signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        await context.editReply(
          '❌ Avatar download timed out. Discord may be slow — please try again.'
        );
        return;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (!imageResponse.ok) {
      await context.editReply('❌ Failed to download the image. Please try again.');
      return;
    }

    const rawBuffer = Buffer.from(await imageResponse.arrayBuffer());

    // Process avatar (resize if needed)
    const result = await processAvatarBuffer(rawBuffer, slug);
    if (!result.success) {
      await context.editReply(`❌ ${result.message}`);
      return;
    }

    const base64Image = result.buffer.toString('base64');
    await updateCharacter(slug, { avatarData: base64Image }, userClient, config);

    await context.editReply(
      `✅ Avatar updated for **${character.displayName ?? character.name}**!`
    );

    logger.info({ slug, userId }, 'Character avatar updated');
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to update avatar');
    await context.editReply('❌ Failed to update avatar. Please try again.');
  }
}

/**
 * Handle /character avatar-clear
 */
async function handleAvatarClear(
  context: DeferredCommandContext,
  config: EnvConfig
): Promise<void> {
  const interaction = context.interaction;
  const slug = interaction.options.getString('character', true);
  if (isAutocompleteErrorSentinel(slug)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }
  const userId = context.user.id;

  const { userClient } = clientsFor(context.interaction);

  try {
    const character = await fetchEditableCharacter(slug, config, userClient, context);
    if (!character) {
      return;
    }

    // `clearAvatar: true` is the explicit clear signal — `avatarData: null`
    // means "no change" (dashboard round-trip), so it would silently no-op.
    await updateCharacter(slug, { clearAvatar: true }, userClient, config);

    await context.editReply(
      `✅ Avatar removed for **${character.displayName ?? character.name}**.`
    );

    logger.info({ slug, userId }, 'Character avatar cleared');
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to clear avatar');
    await context.editReply('❌ Failed to clear avatar. Please try again.');
  }
}

/**
 * Handle /character avatar subcommands.
 * Routes to upload or clear based on subcommand name (registered flat:
 * 'avatar', 'avatar-clear').
 */
export async function handleAvatar(
  context: DeferredCommandContext,
  config: EnvConfig
): Promise<void> {
  const subcommand = context.interaction.options.getSubcommand();
  if (subcommand === 'avatar') {
    await handleAvatarUpload(context, config);
  } else if (subcommand === 'avatar-clear') {
    await handleAvatarClear(context, config);
  } else {
    logger.warn({ subcommand }, 'Unexpected avatar subcommand');
    await context.editReply('❌ Unknown avatar command.');
  }
}
