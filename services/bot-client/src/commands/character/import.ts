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
  "errorMessage": "Custom error message when AI fails (optional)",
  "avatarData": "Base64-encoded avatar image (optional)"
}`;

/**
 * Required fields for character import
 */
export const REQUIRED_IMPORT_FIELDS = ['name', 'slug', 'characterInfo', 'personalityTraits'];

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
    '**Slug format:** lowercase letters, numbers, and hyphens only (e.g., `my-character`)'
  );
}

/**
 * Handle /character import subcommand
 * Allows any user to import a character from a JSON file
 */
export async function handleImport(
  interaction: ChatInputCommandInteraction,
  _config: EnvConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const fileAttachment = interaction.options.getAttachment('file', true);

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

    // Build payload for API
    // isPublic defaults to false if not specified
    const isPublic = typeof characterData.isPublic === 'boolean' ? characterData.isPublic : false;

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
      avatarData: characterData.avatarData ?? undefined,
    };

    // Call API Gateway to create character (uses user endpoint)
    const result = await callGatewayApi<{ id: string }>('/user/personality', {
      userId: interaction.user.id,
      method: 'POST',
      body: payload,
    });

    if (result.ok === false) {
      const errorMessage = result.error;
      logger.error({ error: errorMessage }, '[Character/Import] Failed to import');

      // Check for common errors
      if (errorMessage.includes('already exists') || errorMessage.includes('409')) {
        await interaction.editReply(
          `❌ A character with the slug \`${slug}\` already exists.\n` +
            'Either change the slug in the JSON file or delete the existing character first.'
        );
        return;
      }

      await interaction.editReply(
        `❌ Failed to import character:\n` +
          `\`\`\`\n${errorMessage.slice(0, 1500)}\n\`\`\``
      );
      return;
    }

    // Build success embed
    const visibilityIcon = isPublic ? '🌐' : '🔒';
    const visibilityText = isPublic ? 'Public' : 'Private';
    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('Character Imported Successfully')
      .setDescription(
        `Imported character: **${String(payload.name)}** (\`${slug}\`)\n` +
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
      { slug, userId: interaction.user.id },
      '[Character/Import] Character imported successfully'
    );
  } catch (error) {
    logger.error({ err: error }, '[Character/Import] Error importing character');
    await interaction.editReply(
      '❌ An unexpected error occurred while importing the character.\n' +
        'Check bot logs for details.'
    );
  }
}
