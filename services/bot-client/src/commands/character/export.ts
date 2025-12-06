/**
 * Character Export Subcommand
 * Handles /character export - allows users to export their characters as JSON files
 * Exports both a JSON file and a separate avatar image (if one exists)
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags, AttachmentBuilder } from 'discord.js';
import { createLogger, type EnvConfig } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import type { CharacterData } from './config.js';

const logger = createLogger('character-export');

/**
 * API response type for personality endpoint
 */
interface PersonalityResponse {
  personality: CharacterData;
  canEdit: boolean;
}

/**
 * Fields to include in exported JSON (excluding avatarData - that's exported as separate file)
 */
const EXPORT_FIELDS = [
  'name',
  'slug',
  'displayName',
  'isPublic',
  'characterInfo',
  'personalityTraits',
  'personalityTone',
  'personalityAge',
  'personalityAppearance',
  'personalityLikes',
  'personalityDislikes',
  'conversationalGoals',
  'conversationalExamples',
  'errorMessage',
] as const;

/**
 * Build exportable character data (matching import format)
 * Avatar is excluded - it's sent as a separate image file
 */
function buildExportData(character: CharacterData): Record<string, unknown> {
  const exportData: Record<string, unknown> = {};

  for (const field of EXPORT_FIELDS) {
    const value = character[field];
    // Only include non-null values
    if (value !== null && value !== undefined && value !== '') {
      exportData[field] = value;
    }
  }

  return exportData;
}

/**
 * Detect image format from base64 data
 * Returns file extension and MIME type
 */
function detectImageFormat(base64Data: string): { extension: string; mimeType: string } {
  // Check for common image format magic bytes in base64
  if (base64Data.startsWith('/9j/')) {
    return { extension: 'jpg', mimeType: 'image/jpeg' };
  }
  if (base64Data.startsWith('iVBORw0KGgo')) {
    return { extension: 'png', mimeType: 'image/png' };
  }
  if (base64Data.startsWith('R0lGOD')) {
    return { extension: 'gif', mimeType: 'image/gif' };
  }
  if (base64Data.startsWith('UklGR')) {
    return { extension: 'webp', mimeType: 'image/webp' };
  }
  // Default to PNG if unknown
  return { extension: 'png', mimeType: 'image/png' };
}

/**
 * Handle /character export subcommand
 * Exports character as JSON file + separate avatar image (if exists)
 */
export async function handleExport(
  interaction: ChatInputCommandInteraction,
  _config: EnvConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const slug = interaction.options.getString('character', true);

  try {
    // Fetch character data
    const result = await callGatewayApi<PersonalityResponse>(`/user/personality/${slug}`, {
      userId: interaction.user.id,
    });

    if (!result.ok) {
      if (result.status === 404) {
        await interaction.editReply(`❌ Character \`${slug}\` not found.`);
        return;
      }
      if (result.status === 403) {
        await interaction.editReply(`❌ You don't have access to character \`${slug}\`.`);
        return;
      }
      throw new Error(`API error: ${result.status}`);
    }

    const character = result.data.personality;
    const displayName = character.displayName ?? character.name;

    // Build export data (excludes avatar)
    const exportData = buildExportData(character);

    // Convert to pretty JSON
    const jsonContent = JSON.stringify(exportData, null, 2);

    // Create JSON attachment
    const jsonBuffer = Buffer.from(jsonContent, 'utf-8');
    const jsonAttachment = new AttachmentBuilder(jsonBuffer, {
      name: `${slug}.json`,
      description: `Character data: ${displayName}`,
    });

    const files: AttachmentBuilder[] = [jsonAttachment];
    const contentParts: string[] = [`✅ Exported **${displayName}** (\`${slug}\`)`];

    // Add avatar as separate image file if it exists
    if (character.avatarData) {
      try {
        const { extension } = detectImageFormat(character.avatarData);
        const avatarBuffer = Buffer.from(character.avatarData, 'base64');
        const avatarAttachment = new AttachmentBuilder(avatarBuffer, {
          name: `${slug}-avatar.${extension}`,
          description: `Avatar for ${displayName}`,
        });
        files.push(avatarAttachment);
        contentParts.push('🖼️ Avatar image included');
      } catch (avatarError) {
        logger.warn({ err: avatarError, slug }, '[Character/Export] Failed to export avatar');
        contentParts.push('⚠️ Avatar could not be exported');
      }
    }

    contentParts.push('');
    contentParts.push(
      '📝 Edit the JSON and re-import with `/character import`.\n' +
        'You can optionally include a new avatar image when importing.'
    );

    await interaction.editReply({
      content: contentParts.join('\n'),
      files,
    });

    logger.info(
      { slug, userId: interaction.user.id, hasAvatar: !!character.avatarData },
      '[Character/Export] Character exported successfully'
    );
  } catch (error) {
    logger.error({ err: error, slug }, '[Character/Export] Error exporting character');
    await interaction.editReply('❌ An unexpected error occurred while exporting the character.');
  }
}
