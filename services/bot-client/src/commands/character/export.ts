/**
 * Character Export Subcommand
 * Handles /character export - allows users to export their characters as JSON files
 * Exports both a JSON file and a separate avatar image (if one exists)
 */

import { AttachmentBuilder } from 'discord.js';
import {
  createLogger,
  type EnvConfig,
  getConfig,
  isBotOwner,
  characterExportOptions,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import type { CharacterData } from './config.js';

const logger = createLogger('character-export');

/**
 * Extended character data that includes hasAvatar flag from API
 */
interface ExportCharacterData extends Omit<CharacterData, 'avatarData'> {
  hasAvatar: boolean;
}

/**
 * API response type for personality endpoint
 */
interface PersonalityResponse {
  personality: ExportCharacterData;
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
function buildExportData(character: ExportCharacterData): Record<string, unknown> {
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
 * Fetch avatar image from public endpoint
 * Returns image buffer or null if not found
 */
async function fetchAvatarData(slug: string): Promise<Buffer | null> {
  const config = getConfig();
  const avatarUrl = `${config.GATEWAY_URL}/avatars/${slug}.png`;

  try {
    const response = await fetch(avatarUrl);
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Avatar fetch failed: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    logger.warn({ err: error, slug }, '[Character/Export] Failed to fetch avatar');
    return null;
  }
}

/**
 * Attempt to add avatar attachment if character has one
 * @returns Status message about avatar export
 */
async function addAvatarAttachment(
  slug: string,
  displayName: string,
  files: AttachmentBuilder[]
): Promise<string> {
  const avatarBuffer = await fetchAvatarData(slug);
  if (avatarBuffer !== null) {
    files.push(
      new AttachmentBuilder(avatarBuffer, {
        name: `${slug}-avatar.png`,
        description: `Avatar for ${displayName}`,
      })
    );
    return '🖼️ Avatar image included';
  }
  return '⚠️ Avatar could not be exported';
}

/**
 * Handle /character export subcommand
 * Exports character as JSON file + separate avatar image (if exists)
 */
export async function handleExport(
  context: DeferredCommandContext,
  _config: EnvConfig
): Promise<void> {
  const options = characterExportOptions(context.interaction);
  const slug = options.character();
  const userId = context.user.id;

  try {
    // Fetch character data
    const result = await callGatewayApi<PersonalityResponse>(`/user/personality/${slug}`, {
      userId,
    });

    if (!result.ok) {
      if (result.status === 404) {
        await context.editReply(`❌ Character \`${slug}\` not found.`);
        return;
      }
      if (result.status === 403) {
        await context.editReply(`❌ You don't have access to character \`${slug}\`.`);
        return;
      }
      throw new Error(`API error: ${result.status}`);
    }

    const character = result.data.personality;
    const canEdit = result.data.canEdit;
    // Cast needed - Omit with index signature loses specific property types
    const displayName = (character.displayName ?? character.name) as string;

    // Check ownership - only character owner or bot owner can export
    if (!canEdit && !isBotOwner(userId)) {
      await context.editReply(
        `❌ You don't have permission to export \`${slug}\`.\n` +
          'You can only export characters you own.'
      );
      return;
    }

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
    if (character.hasAvatar) {
      contentParts.push(await addAvatarAttachment(slug, displayName, files));
    }

    contentParts.push(
      '',
      '📝 Edit the JSON and re-import with `/character import`.\n' +
        'You can optionally include a new avatar image when importing.'
    );

    await context.editReply({
      content: contentParts.join('\n'),
      files,
    });

    logger.info(
      { slug, userId, hasAvatar: character.hasAvatar },
      '[Character/Export] Character exported successfully'
    );
  } catch (error) {
    logger.error({ err: error, slug }, '[Character/Export] Error exporting character');
    await context.editReply('❌ An unexpected error occurred while exporting the character.');
  }
}
