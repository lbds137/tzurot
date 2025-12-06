/**
 * Character Import Subcommand
 * Handles /character import - allows users to import characters from JSON files
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags, EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_LIMITS, DISCORD_COLORS, type EnvConfig } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('character-import');

/**
 * JSON template for character import
 * This is shown to users when they need help with the format
 * Note: Avatar is uploaded separately as an image file, not in JSON
 */
export const CHARACTER_JSON_TEMPLATE = `{
  "name": "Character Name",
  "slug": "character-slug",
  "displayName": "Display Name (optional)",
  "isPublic": false,
  "characterInfo": "Background, history, and description of the character...",
  "personalityTraits": "Key personality traits and behaviors...",
  "personalityTone": "friendly, sarcastic, professional, etc. (optional)",
  "personalityAge": "Apparent age or age range (optional)",
  "personalityAppearance": "Physical description... (optional)",
  "personalityLikes": "Things the character enjoys... (optional)",
  "personalityDislikes": "Things the character avoids... (optional)",
  "conversationalGoals": "What conversations should achieve... (optional)",
  "conversationalExamples": "Example dialogues to guide AI... (optional)",
  "errorMessage": "Custom error message when AI fails (optional)"
}`;

/**
 * Required fields for character import
 */
export const REQUIRED_IMPORT_FIELDS = ['name', 'slug', 'characterInfo', 'personalityTraits'];

/**
 * Valid image MIME types for avatar upload
 */
const VALID_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * Build the template help message
 */
function buildTemplateMessage(): string {
  return (
    '**Expected JSON Structure:**\n' +
    '```json\n' +
    CHARACTER_JSON_TEMPLATE +
    '\n```\n' +
    '**Required fields:** `name`, `slug`, `characterInfo`, `personalityTraits`\n' +
    '**Slug format:** lowercase letters, numbers, and hyphens only (e.g., `my-character`)\n' +
    '**Avatar:** Upload an image separately using the `avatar` option'
  );
}

/**
 * Handle /character import subcommand
 * Allows any user to import a character from a JSON file
 * Optionally accepts a separate avatar image
 */
export async function handleImport(
  interaction: ChatInputCommandInteraction,
  _config: EnvConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const fileAttachment = interaction.options.getAttachment('file', true);
    const avatarAttachment = interaction.options.getAttachment('avatar', false);

    // Validate file type
    if (
      (fileAttachment.contentType?.includes('json') ?? false) === false &&
      !fileAttachment.name.endsWith('.json')
    ) {
      await interaction.editReply('❌ File must be a JSON file (.json)');
      return;
    }

    // Validate file size (Discord limit)
    if (fileAttachment.size > DISCORD_LIMITS.AVATAR_SIZE) {
      await interaction.editReply('❌ File is too large (max 10MB)');
      return;
    }

    // Download and parse JSON
    let characterData: Record<string, unknown>;
    try {
      const response = await fetch(fileAttachment.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      characterData = JSON.parse(text) as Record<string, unknown>;

      logger.info(
        { filename: fileAttachment.name, sizeKb: (text.length / 1024).toFixed(2) },
        '[Character/Import] Downloaded JSON'
      );
    } catch (error) {
      logger.error({ err: error }, '[Character/Import] Failed to download or parse JSON');
      await interaction.editReply(
        '❌ Failed to parse JSON file.\n' +
          'Make sure the file is valid JSON format.\n\n' +
          buildTemplateMessage()
      );
      return;
    }

    // Validate required fields
    const missingFields = REQUIRED_IMPORT_FIELDS.filter(
      field =>
        characterData[field] === undefined ||
        characterData[field] === null ||
        characterData[field] === ''
    );

    if (missingFields.length > 0) {
      await interaction.editReply(
        `❌ Missing required fields: ${missingFields.join(', ')}\n\n` + buildTemplateMessage()
      );
      return;
    }

    // Validate slug format
    const slug = characterData.slug as string;
    if (!/^[a-z0-9-]+$/.test(slug)) {
      await interaction.editReply(
        '❌ Invalid slug format in JSON. Use only lowercase letters, numbers, and hyphens.\n' +
          `Example: \`${slug.toLowerCase().replace(/[^a-z0-9-]/g, '-')}\``
      );
      return;
    }

    // Process optional avatar attachment
    let avatarData: string | undefined;
    if (avatarAttachment) {
      // Validate avatar is an image
      if (
        avatarAttachment.contentType === null ||
        !VALID_IMAGE_TYPES.includes(avatarAttachment.contentType)
      ) {
        await interaction.editReply(
          '❌ Avatar must be an image file (PNG, JPG, GIF, or WebP).\n' +
            `Received: ${avatarAttachment.contentType ?? 'unknown type'}`
        );
        return;
      }

      // Validate avatar size (max 8MB)
      const MAX_AVATAR_SIZE = 8 * 1024 * 1024;
      if (avatarAttachment.size > MAX_AVATAR_SIZE) {
        await interaction.editReply('❌ Avatar image is too large. Maximum size is 8MB.');
        return;
      }

      // Download and convert to base64
      try {
        const avatarResponse = await fetch(avatarAttachment.url);
        if (!avatarResponse.ok) {
          throw new Error(`HTTP ${avatarResponse.status}`);
        }
        const avatarBuffer = Buffer.from(await avatarResponse.arrayBuffer());
        avatarData = avatarBuffer.toString('base64');

        logger.info(
          { filename: avatarAttachment.name, sizeKb: (avatarAttachment.size / 1024).toFixed(2) },
          '[Character/Import] Downloaded avatar image'
        );
      } catch (avatarError) {
        logger.error({ err: avatarError }, '[Character/Import] Failed to download avatar');
        await interaction.editReply('❌ Failed to download avatar image. Please try again.');
        return;
      }
    }

    // Build payload for API
    // isPublic defaults to false if not specified
    const isPublic = typeof characterData.isPublic === 'boolean' ? characterData.isPublic : false;

    // Use separate avatar attachment if provided, otherwise fall back to JSON's avatarData
    const finalAvatarData =
      avatarData ??
      (typeof characterData.avatarData === 'string' ? characterData.avatarData : undefined);

    const payload = {
      name: characterData.name,
      slug: characterData.slug,
      characterInfo: characterData.characterInfo,
      personalityTraits: characterData.personalityTraits,
      displayName: characterData.displayName ?? undefined,
      isPublic,
      personalityTone: characterData.personalityTone ?? undefined,
      personalityAge: characterData.personalityAge ?? undefined,
      personalityAppearance: characterData.personalityAppearance ?? undefined,
      personalityLikes: characterData.personalityLikes ?? undefined,
      personalityDislikes: characterData.personalityDislikes ?? undefined,
      conversationalGoals: characterData.conversationalGoals ?? undefined,
      conversationalExamples: characterData.conversationalExamples ?? undefined,
      customFields: characterData.customFields ?? undefined,
      avatarData: finalAvatarData,
      errorMessage: characterData.errorMessage ?? undefined,
    };

    // Check if character already exists
    const existingResult = await callGatewayApi<{
      personality: { id: string };
      canEdit: boolean;
    }>(`/user/personality/${slug}`, {
      userId: interaction.user.id,
      method: 'GET',
    });

    let isUpdate = false;

    if (existingResult.ok) {
      // Character exists - check if user can edit it
      if (!existingResult.data.canEdit) {
        await interaction.editReply(
          `❌ A character with the slug \`${slug}\` already exists and you don't own it.\n` +
            'You can only overwrite characters that you own.'
        );
        return;
      }
      isUpdate = true;
    }

    // Call API Gateway to create or update character
    const result = await callGatewayApi<{ id: string }>(
      isUpdate ? `/user/personality/${slug}` : '/user/personality',
      {
        userId: interaction.user.id,
        method: isUpdate ? 'PUT' : 'POST',
        body: payload,
      }
    );

    if (result.ok === false) {
      const errorMessage = result.error;
      logger.error({ error: errorMessage, isUpdate }, '[Character/Import] Failed to import');

      await interaction.editReply(
        `❌ Failed to ${isUpdate ? 'update' : 'import'} character:\n` +
          `\`\`\`\n${errorMessage.slice(0, 1500)}\n\`\`\``
      );
      return;
    }

    // Build success embed
    const visibilityIcon = isPublic ? '🌐' : '🔒';
    const visibilityText = isPublic ? 'Public' : 'Private';
    const actionWord = isUpdate ? 'Updated' : 'Imported';
    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle(`Character ${actionWord} Successfully`)
      .setDescription(
        `${actionWord} character: **${String(payload.name)}** (\`${slug}\`)\n` +
          `${visibilityIcon} ${visibilityText}`
      )
      .setTimestamp();

    // Show what was imported
    const importedFields: string[] = [];
    if (payload.characterInfo !== undefined && payload.characterInfo !== null) {
      importedFields.push('Character Info');
    }
    if (payload.personalityTraits !== undefined && payload.personalityTraits !== null) {
      importedFields.push('Personality Traits');
    }
    if (payload.displayName !== undefined && payload.displayName !== null) {
      importedFields.push('Display Name');
    }
    if (payload.personalityTone !== undefined && payload.personalityTone !== null) {
      importedFields.push('Tone');
    }
    if (payload.personalityAge !== undefined && payload.personalityAge !== null) {
      importedFields.push('Age');
    }
    if (payload.personalityAppearance !== undefined && payload.personalityAppearance !== null) {
      importedFields.push('Appearance');
    }
    if (payload.personalityLikes !== undefined && payload.personalityLikes !== null) {
      importedFields.push('Likes');
    }
    if (payload.personalityDislikes !== undefined && payload.personalityDislikes !== null) {
      importedFields.push('Dislikes');
    }
    if (payload.conversationalGoals !== undefined && payload.conversationalGoals !== null) {
      importedFields.push('Conversational Goals');
    }
    if (payload.conversationalExamples !== undefined && payload.conversationalExamples !== null) {
      importedFields.push('Conversational Examples');
    }
    if (payload.customFields !== undefined && payload.customFields !== null) {
      importedFields.push('Custom Fields');
    }
    if (payload.avatarData !== undefined && payload.avatarData !== null) {
      importedFields.push('Avatar Data');
    }

    embed.addFields({ name: 'Imported Fields', value: importedFields.join(', '), inline: false });

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      { slug, userId: interaction.user.id, isUpdate },
      `[Character/Import] Character ${isUpdate ? 'updated' : 'imported'} successfully`
    );
  } catch (error) {
    logger.error({ err: error }, '[Character/Import] Error importing character');
    await interaction.editReply(
      '❌ An unexpected error occurred while importing the character.\n' +
        'Check bot logs for details.'
    );
  }
}
