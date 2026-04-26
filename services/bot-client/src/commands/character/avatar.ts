/**
 * Character Avatar Handler
 *
 * Handles avatar upload and update for characters.
 * Automatically resizes large images to fit within the API gateway's body limit.
 */

import { createLogger, type EnvConfig, characterAvatarOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { toGatewayUser } from '../../utils/userGatewayClient.js';
import { validateDiscordCdnUrl } from '../../utils/discordCdnGuard.js';
import { fetchCharacter, updateCharacter } from './api.js';
import {
  VALID_IMAGE_TYPES,
  MAX_INPUT_SIZE_MB,
  MAX_INPUT_SIZE_BYTES,
  processAvatarBuffer,
} from './avatarUtils.js';

const logger = createLogger('character-avatar');

/**
 * Validate attachment is a supported image format and size
 * @returns Error message if invalid, null if valid
 */
function validateAttachment(contentType: string | null, size: number): string | null {
  if (contentType === null || !VALID_IMAGE_TYPES.includes(contentType)) {
    return '❌ Invalid image format. Please upload a PNG, JPG, GIF, or WebP image.';
  }
  if (size > MAX_INPUT_SIZE_BYTES) {
    return `❌ Image too large. Please upload an image under ${MAX_INPUT_SIZE_MB}MB.`;
  }
  return null;
}

/**
 * Handle avatar upload subcommand
 */
export async function handleAvatar(
  context: DeferredCommandContext,
  config: EnvConfig
): Promise<void> {
  const options = characterAvatarOptions(context.interaction);
  const slug = options.character();
  const attachment = options.image();
  const userId = context.user.id;

  const validationError = validateAttachment(attachment.contentType, attachment.size);
  if (validationError !== null) {
    await context.editReply(validationError);
    return;
  }

  try {
    // Check if user can edit this character
    const character = await fetchCharacter(slug, config, toGatewayUser(context.user));
    if (!character) {
      await context.editReply(`❌ Character \`${slug}\` not found or not accessible.`);
      return;
    }

    // Use server-side permission check (compares internal User UUIDs, not Discord IDs)
    if (!character.canEdit) {
      await context.editReply(
        `❌ You don't have permission to edit \`${slug}\`.\n` +
          'You can only edit characters you own.'
      );
      return;
    }

    // SSRF defense-in-depth: validate the attachment URL points at a Discord
    // CDN host before fetching. Discord interactions only ever supply CDN URLs,
    // so this is a guard rather than expected reject path.
    const cdnGuard = validateDiscordCdnUrl(attachment.url, logger);
    if (!cdnGuard.ok) {
      await context.editReply('❌ Invalid attachment URL.');
      return;
    }

    // Download the image with a 30s timeout (pattern matches voice.ts and
    // avatarProcessor.ts). try/catch/finally ensures clearTimeout runs in
    // every path — no double-clear in catch + after-try like the first draft.
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

    // Update character with new avatar
    await updateCharacter(slug, { avatarData: base64Image }, toGatewayUser(context.user), config);

    await context.editReply(
      `✅ Avatar updated for **${character.displayName ?? character.name}**!`
    );

    logger.info({ slug, userId }, 'Character avatar updated');
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to update avatar');
    await context.editReply('❌ Failed to update avatar. Please try again.');
  }
}

// Re-export constants for testing (from avatarUtils)
