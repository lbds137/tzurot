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
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

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
      renderSpec(CATALOG.error.notFound('Character', { name: escapeMarkdown(slug) }))
    );
    return null;
  }
  if (!character.canEdit) {
    await context.editReply(
      renderSpec(
        CATALOG.error.permissionDenied(
          `edit \`${escapeMarkdown(slug)}\` — you can only edit characters you own`
        )
      )
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
    await context.editReply(renderSpec(CATALOG.error.validation('Invalid attachment URL.')));
    return;
  }

  const { userClient } = clientsFor(context.interaction);

  // Read phase gets its own catch: a transient failure while CHECKING the
  // character must never render the write-uncertain "may still be applying"
  // copy — nothing has been submitted yet.
  let character: FetchedCharacter | null;
  try {
    character = await fetchEditableCharacter(slug, config, userClient, context);
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to load character for voice upload');
    await context.editReply(
      renderSpec(classifyGatewayFailure(error, 'character', { operation: 'read' }))
    );
    return;
  }
  if (!character) {
    return;
  }

  try {
    // Download audio from Discord CDN (30s timeout to avoid holding the deferred interaction)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let audioResponse: Response;
    try {
      audioResponse = await fetch(attachment.url, { signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        await context.editReply(
          renderSpec(CATALOG.error.userRetryable('Voice download timed out — Discord may be slow.'))
        );
        return;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    if (!audioResponse.ok) {
      await context.editReply(renderSpec(CATALOG.error.operationFailed('download the audio file')));
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
    await context.editReply(
      renderSpec(
        classifyGatewayFailure(error, 'voice reference', {
          failedAction: 'upload the voice reference',
        })
      )
    );
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

  let character: FetchedCharacter | null;
  try {
    character = await fetchEditableCharacter(slug, config, userClient, context);
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to load character for voice clear');
    await context.editReply(
      renderSpec(classifyGatewayFailure(error, 'character', { operation: 'read' }))
    );
    return;
  }
  if (!character) {
    return;
  }

  try {
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
    await context.editReply(
      renderSpec(
        classifyGatewayFailure(error, 'voice reference', {
          failedAction: 'clear the voice reference',
        })
      )
    );
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
    await context.editReply(renderSpec(CATALOG.error.validation('Unknown voice command.')));
  }
}
