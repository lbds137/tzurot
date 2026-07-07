/**
 * Character Export Subcommand
 * Handles /character export - allows users to export their characters as JSON files
 * Exports both a JSON file and a separate avatar image (if one exists)
 */

import { AttachmentBuilder } from 'discord.js';
import { type EnvConfig, getConfig } from '@tzurot/common-types/config/config';
import { characterExportOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { toCharacterData } from './api.js';
import type { CharacterData } from './characterTypes.js';

const logger = createLogger('character-export');

/**
 * Character shape used by the export builder. Same as `CharacterData` minus
 * `avatarData` (avatar is exported as a separate image file) plus the
 * schema-emitted `hasAvatar` boolean for the conditional file attachment.
 */
interface ExportCharacterData extends Omit<CharacterData, 'avatarData'> {
  hasAvatar: boolean;
}

/**
 * Fields to include in exported JSON (excluding avatarData - that's exported as separate file)
 */
const EXPORT_FIELDS = [
  'name',
  'slug',
  'displayName',
  'isPublic',
  'definitionPublic',
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
  // Import accepts customFields; omitting it here silently lost the data on
  // an export → re-import round-trip.
  'customFields',
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
    logger.warn({ err: error, slug }, 'Failed to fetch avatar');
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
    const { userClient } = clientsFor(context.interaction);
    // Fetch character data
    const result = await userClient.getPersonality(slug);

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

    // Coerce schema-derived `personality` into the `ExportCharacterData` shape
    // via the shared `toCharacterData` helper. `ExportCharacterData` omits
    // `avatarData` (avatar is exported as a separate image file) — the helper
    // still sets it to `null`, which is harmlessly stripped by the
    // `EXPORT_FIELDS` allow-list during `buildExportData`. Explicit `hasAvatar`
    // narrowing keeps the type dependency on the schema field visible (rather
    // than relying on `as unknown as` to paper over the structural mismatch).
    const raw = toCharacterData(result.data.personality);
    const character: ExportCharacterData = { ...raw, hasAvatar: raw.hasAvatar };
    const canEdit = result.data.canEdit;
    // Cast string fields explicitly — CharacterData's index signature widens
    // their type to `unknown` at lookup.
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
      'Character exported successfully'
    );
  } catch (error) {
    logger.error({ err: error, slug }, 'Error exporting character');
    await context.editReply('❌ An unexpected error occurred while exporting the character.');
  }
}
