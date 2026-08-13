/**
 * Character Export Subcommand
 * Handles /character export - allows users to export their characters as JSON files
 * Exports both a JSON file and a separate avatar image (if one exists)
 */

import { AttachmentBuilder } from 'discord.js';
import { type EnvConfig, getConfig } from '@tzurot/common-types/config/config';
import { characterExportOptions } from '@tzurot/common-types/generated/commandOptions';
import { avatarUrlPath } from '@tzurot/common-types/utils/avatarUrl';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
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
  // Import accepts customFields, but neither USER personality route (create.ts
  // buildCreateData / update.ts buildUpdateData) writes the column, so the
  // value is dropped gateway-side and the round-trip still loses it. Exported
  // anyway so the file is a faithful snapshot; TASK-590 owns the gateway gap.
  'customFields',
  // Import accepts a tag array.
  'tags',
] as const;

/**
 * Fields whose EMPTY form is a clear instruction on re-import rather than an
 * absence, so omitting them makes the export unable to restore a cleared
 * character. Each is `nullableString` (empty string → null) in both the create
 * and update schemas, except `tags`, whose clear is `[]`.
 *
 * Not here, deliberately:
 * - `displayName` — both user routes rewrite an empty displayName to the
 *   character's `name`, so it has no cleared state to restore; emitting `''`
 *   would overwrite a stored null instead of preserving it.
 * - `name` / `characterInfo` / `personalityTraits` — declared `.min(1)` in both
 *   PersonalityCreateSchema and PersonalityUpdateSchema, so no write path can
 *   store an empty one.
 * - `isPublic` / `definitionPublic` — booleans; `false` is not empty and
 *   already survives the filter below.
 * - `customFields` — its clear is `null`, which `buildImportPayload`'s
 *   `?? undefined` collapses back to "no change" (and see TASK-590 above).
 */
export const CLEARABLE_FIELDS: readonly (typeof EXPORT_FIELDS)[number][] = [
  'personalityTone',
  'personalityAge',
  'personalityAppearance',
  'personalityLikes',
  'personalityDislikes',
  'conversationalGoals',
  'conversationalExamples',
  'errorMessage',
  'tags',
];

/** Membership form of {@link CLEARABLE_FIELDS} — the list is what's exported. */
const CLEARABLE_FIELD_SET = new Set(CLEARABLE_FIELDS);

/**
 * Build exportable character data (matching import format)
 * Avatar is excluded - it's sent as a separate image file
 */
function buildExportData(character: ExportCharacterData): Record<string, unknown> {
  const exportData: Record<string, unknown> = {};

  for (const field of EXPORT_FIELDS) {
    const value = character[field];
    const isEmpty =
      value === null ||
      value === undefined ||
      value === '' ||
      (Array.isArray(value) && value.length === 0);

    if (!isEmpty) {
      exportData[field] = value;
      continue;
    }
    // An empty non-clearable field carries no information — omit it.
    if (!CLEARABLE_FIELD_SET.has(field)) {
      continue;
    }
    // Emit the explicit clear form so a re-import restores the empty state.
    // `''` and `[]` both parse to a clear AND survive the import builder's
    // `?? undefined`; `null` would parse to a clear but get collapsed there,
    // which is why this emits '' / [] and not null. Pinned by the per-field
    // `emits %s: ""` cases in export.test.ts and by the update-payload
    // survival test in import.test.ts.
    exportData[field] = field === 'tags' ? [] : '';
  }

  return exportData;
}

/**
 * Fetch avatar image from public endpoint
 * Returns image buffer or null if not found
 */
async function fetchAvatarData(slug: string): Promise<Buffer | null> {
  const config = getConfig();
  const avatarUrl = `${config.GATEWAY_URL}${avatarUrlPath(slug)}`;

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
        await context.editReply(renderSpec(CATALOG.error.notFound('Character', { name: slug })));
        return;
      }
      if (result.status === 403) {
        await context.editReply(
          renderSpec(CATALOG.error.permissionDenied(`access character \`${slug}\``))
        );
        return;
      }
      // Fail-arm carries the transport kind — classify directly (a timeout
      // must not read as a definitive export failure).
      await context.editReply(
        renderSpec(classifyGatewayFailure(result, 'character', { operation: 'read' }))
      );
      return;
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
        renderSpec(
          CATALOG.error.permissionDenied(
            `export \`${slug}\` — you can only export characters you own`
          )
        )
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
    await context.editReply(
      renderSpec(
        classifyGatewayFailure(error, 'character', {
          operation: 'read',
          failedAction: 'export the character',
        })
      )
    );
  }
}
