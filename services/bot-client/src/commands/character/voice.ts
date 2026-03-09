/**
 * Character Voice Handler
 *
 * Handles voice reference upload and clear for characters.
 * Mirrors the avatar handler pattern — upload downloads from Discord CDN,
 * base64-encodes, and sends to the gateway API. Clear nulls the reference.
 *
 * Auto-toggles voiceEnabled: upload sets true, clear sets false.
 */

import { createLogger, type EnvConfig, VOICE_REFERENCE_LIMITS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { fetchCharacter, updateCharacter } from './api.js';

const logger = createLogger('character-voice');

/** Content types accepted for voice reference upload (broader than the server-side
 * ALLOWED_TYPES — we accept any `audio/*` to give a friendlier Discord UX, and
 * let the gateway validate the specific MIME type). */
const VALID_AUDIO_PREFIX = 'audio/';

/** Max upload size accepted client-side (same as server limit) */
const MAX_UPLOAD_BYTES = VOICE_REFERENCE_LIMITS.MAX_SIZE;
const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);

/** Allowed Discord CDN hostnames for SSRF defense-in-depth */
const DISCORD_CDN_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];

/**
 * Handle /character voice upload
 */
async function handleVoiceUpload(
  context: DeferredCommandContext,
  config: EnvConfig
): Promise<void> {
  const interaction = context.interaction;
  const slug = interaction.options.getString('character', true);
  const attachment = interaction.options.getAttachment('audio', true);
  const userId = context.user.id;

  // Validate attachment type (optional chain satisfies both prefer-optional-chain
  // and strict-boolean-expressions lint rules; === true handles null contentType).
  // Narrow contentType to string after the guard for use in the data URI below.
  const isAudio = attachment.contentType?.startsWith(VALID_AUDIO_PREFIX) === true;
  if (!isAudio) {
    await context.editReply(
      `❌ Invalid file type. Please upload an audio file (WAV, MP3, OGG, or FLAC).\n` +
        `Allowed types: ${VOICE_REFERENCE_LIMITS.ALLOWED_TYPES.join(', ')}`
    );
    return;
  }
  // After isAudio guard, contentType is guaranteed non-null at runtime.

  // Validate size
  if (attachment.size > MAX_UPLOAD_BYTES) {
    await context.editReply(
      `❌ Audio file too large. Please upload a file under ${MAX_UPLOAD_MB}MB.`
    );
    return;
  }

  // Validate attachment URL is from Discord CDN (SSRF defense-in-depth)
  let attachmentHost: string;
  try {
    attachmentHost = new URL(attachment.url).hostname;
  } catch {
    await context.editReply('❌ Invalid attachment URL.');
    return;
  }
  if (!DISCORD_CDN_HOSTS.includes(attachmentHost)) {
    logger.warn({ url: attachment.url, host: attachmentHost }, 'Unexpected attachment URL host');
    await context.editReply('❌ Invalid attachment URL.');
    return;
  }

  try {
    // Check permissions
    const character = await fetchCharacter(slug, config, userId);
    if (!character) {
      await context.editReply(`❌ Character \`${slug}\` not found or not accessible.`);
      return;
    }
    if (!character.canEdit) {
      await context.editReply(
        `❌ You don't have permission to edit \`${slug}\`.\n` +
          'You can only edit characters you own.'
      );
      return;
    }

    // Download audio from Discord CDN (30s timeout to avoid holding the deferred interaction)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let audioResponse: Response;
    try {
      audioResponse = await fetch(attachment.url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!audioResponse.ok) {
      await context.editReply('❌ Failed to download the audio file. Please try again.');
      return;
    }

    const rawBuffer = Buffer.from(await audioResponse.arrayBuffer());
    const base64Audio = `data:${attachment.contentType};base64,${rawBuffer.toString('base64')}`;

    // Update character with voice reference and auto-enable voice
    await updateCharacter(
      slug,
      { voiceReferenceData: base64Audio, voiceEnabled: true },
      userId,
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
  const userId = context.user.id;

  try {
    // Check permissions
    const character = await fetchCharacter(slug, config, userId);
    if (!character) {
      await context.editReply(`❌ Character \`${slug}\` not found or not accessible.`);
      return;
    }
    if (!character.canEdit) {
      await context.editReply(
        `❌ You don't have permission to edit \`${slug}\`.\n` +
          'You can only edit characters you own.'
      );
      return;
    }

    // Clear voice reference and disable voice
    await updateCharacter(slug, { voiceReferenceData: null, voiceEnabled: false }, userId, config);

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
 * Handle /character voice subcommand group
 * Routes to upload or clear based on sub-subcommand
 */
export async function handleVoice(
  context: DeferredCommandContext,
  config: EnvConfig
): Promise<void> {
  const subcommand = context.interaction.options.getSubcommand();

  // Subcommands are registered flat: 'voice-upload', 'voice-clear'
  if (subcommand === 'voice-upload') {
    await handleVoiceUpload(context, config);
  } else if (subcommand === 'voice-clear') {
    await handleVoiceClear(context, config);
  } else {
    logger.warn({ subcommand }, 'Unexpected voice subcommand');
    await context.editReply('❌ Unknown voice command.');
  }
}
