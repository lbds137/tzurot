/**
 * Character Import Subcommand
 * Handles /character import - allows users to import characters from JSON files
 */

import { EmbedBuilder } from 'discord.js';
import { type EnvConfig } from '@tzurot/common-types/config/config';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { characterImportOptions } from '@tzurot/common-types/generated/commandOptions';
import {
  PersonalityCreateSchema,
  SLUG_PATTERN,
  SLUG_REQUIREMENTS_MESSAGE,
} from '@tzurot/common-types/schemas/api/personality';
import { suggestSlugExample, normalizeSlugForUser } from '@tzurot/common-types/utils/slugUtils';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { UserClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import { validateJsonFile, downloadAndParseJson } from '../../utils/jsonFileUtils.js';
import { validateDiscordCdnUrl } from '../../utils/discordCdnGuard.js';
import {
  VALID_IMAGE_TYPES,
  MAX_INPUT_SIZE_MB,
  MAX_INPUT_SIZE_BYTES,
  processAvatarBuffer,
} from './avatarUtils.js';
import {
  getImportedFieldsList,
  getMissingRequiredFields,
  type ImportFieldDef,
} from '../../utils/importValidation.js';

const logger = createLogger('character-import');

// ============================================================================
// TYPES
// ============================================================================

/** Discord attachment option type (avoids repeating typeof import) */
type AttachmentOption = NonNullable<
  ReturnType<
    typeof import('discord.js').ChatInputCommandInteraction.prototype.options.getAttachment
  >
>;

/** Result of avatar processing */
interface AvatarProcessingResult {
  success: true;
  data: string;
}

/** Import field definitions for building success message */
const IMPORT_FIELD_DEFS: ImportFieldDef[] = [
  { key: 'characterInfo', label: 'Character Info' },
  { key: 'personalityTraits', label: 'Personality Traits' },
  { key: 'displayName', label: 'Display Name' },
  { key: 'personalityTone', label: 'Tone' },
  { key: 'personalityAge', label: 'Age' },
  { key: 'personalityAppearance', label: 'Appearance' },
  { key: 'personalityLikes', label: 'Likes' },
  { key: 'personalityDislikes', label: 'Dislikes' },
  { key: 'conversationalGoals', label: 'Conversational Goals' },
  { key: 'conversationalExamples', label: 'Conversational Examples' },
  { key: 'customFields', label: 'Custom Fields' },
  { key: 'avatarData', label: 'Avatar Data' },
];

// ============================================================================
// CONSTANTS
// ============================================================================

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
 * Build the template help message
 * Points users to /character template for a downloadable template file
 */
function buildTemplateMessage(): string {
  return (
    '💡 **Tip:** Use `/character template` to download a template JSON file.\n\n' +
    '**Required fields:** `name`, `slug`, `characterInfo`, `personalityTraits`\n' +
    '**Slug format:** lowercase letters, numbers, and hyphens only (e.g., `my-character`)\n' +
    '**Avatar:** Upload an image separately using the `avatar` option'
  );
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate character data has required fields and valid slug
 */
function validateCharacterData(
  data: Record<string, unknown>
): { slug: string } | { error: string } {
  const missingFields = getMissingRequiredFields(data, REQUIRED_IMPORT_FIELDS);
  if (missingFields.length > 0) {
    return {
      error: `❌ Missing required fields: ${missingFields.join(', ')}\n\n` + buildTemplateMessage(),
    };
  }

  const rawSlug = data.slug as string;
  // Same pattern the gateway enforces (leading letter) — also closes the
  // all-hyphen base that could reach fitSlugToMaxLength and emit a
  // leading-hyphen result.
  if (!SLUG_PATTERN.test(rawSlug)) {
    return {
      error:
        `❌ Invalid slug format in JSON. ${SLUG_REQUIREMENTS_MESSAGE}\n` +
        `Example: \`${suggestSlugExample(rawSlug)}\``,
    };
  }

  return { slug: rawSlug };
}

/**
 * Combined: validate JSON file, download, parse, and validate character data
 * Uses shared JSON utilities for file validation and parsing
 */
async function validateAndParseCharacterJsonFile(
  file: AttachmentOption
): Promise<{ data: Record<string, unknown>; slug: string } | { error: string }> {
  // Validate file type and size using shared utility
  const validationResult = validateJsonFile(file);
  if ('error' in validationResult) {
    return { error: validationResult.error + '\n\n' + buildTemplateMessage() };
  }

  // Download and parse using shared utility (CDN guard runs inside downloadAndParseJson)
  const jsonResult = await downloadAndParseJson(file.url, file.name);
  if ('error' in jsonResult) {
    return { error: jsonResult.error + '\n\n' + buildTemplateMessage() };
  }

  // Validate character-specific data
  const charValidation = validateCharacterData(jsonResult.data);
  if ('error' in charValidation) {
    return { error: charValidation.error };
  }

  return { data: jsonResult.data, slug: charValidation.slug };
}

/**
 * Validate avatar attachment
 */
function validateAvatarAttachment(avatar: AttachmentOption): string | null {
  if (avatar.contentType === null || !VALID_IMAGE_TYPES.includes(avatar.contentType)) {
    return (
      '❌ Avatar must be an image file (PNG, JPG, GIF, or WebP).\n' +
      `Received: ${avatar.contentType ?? 'unknown type'}`
    );
  }
  if (avatar.size > MAX_INPUT_SIZE_BYTES) {
    return `❌ Avatar image is too large. Maximum size is ${MAX_INPUT_SIZE_MB}MB.`;
  }
  return null;
}

/**
 * Process avatar attachment
 */
async function processAvatarDownload(
  avatar: AttachmentOption
): Promise<AvatarProcessingResult | { error: string }> {
  // SSRF defense-in-depth: reject non-Discord-CDN URLs before fetching.
  const cdnGuard = validateDiscordCdnUrl(avatar.url, logger);
  if (!cdnGuard.ok) {
    return { error: '❌ Invalid avatar URL.' };
  }
  try {
    const response = await fetch(avatar.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const rawBuffer = Buffer.from(await response.arrayBuffer());
    const result = await processAvatarBuffer(rawBuffer, avatar.name ?? 'import-avatar');

    if (!result.success) {
      return { error: `❌ ${result.message}` };
    }

    logger.info(
      {
        filename: avatar.name,
        originalSizeKb: (avatar.size / 1024).toFixed(2),
        finalSizeKb: (result.buffer.length / 1024).toFixed(2),
        wasResized: result.wasResized,
      },
      'Processed avatar image'
    );

    return { success: true, data: result.buffer.toString('base64') };
  } catch (error) {
    logger.error({ err: error }, 'Failed to download avatar');
    return { error: '❌ Failed to download avatar image. Please try again.' };
  }
}

/**
 * Validate and process avatar attachment (combines validation and processing)
 */
async function validateAndProcessAvatar(
  avatar: AttachmentOption
): Promise<{ data: string } | { error: string }> {
  const validationError = validateAvatarAttachment(avatar);
  if (validationError !== null) {
    return { error: validationError };
  }

  const result = await processAvatarDownload(avatar);
  if ('error' in result) {
    return { error: result.error };
  }
  return { data: result.data };
}

/**
 * Validate import payload against the API schema before sending.
 * Returns a user-friendly error message listing each field issue, or null if valid.
 */
function validatePayloadFields(payload: Record<string, unknown>): string | null {
  const result = PersonalityCreateSchema.safeParse(payload);
  if (result.success) {
    return null;
  }

  const fieldErrors = result.error.issues.map(issue => {
    const field = issue.path.join('.');
    return `• **${field}**: ${issue.message}`;
  });

  return `❌ **Validation errors in import file:**\n${fieldErrors.join('\n')}`;
}

// ============================================================================
// PAYLOAD BUILDING
// ============================================================================

/**
 * Build API payload from parsed character data
 */
function buildImportPayload(
  data: Record<string, unknown>,
  normalizedSlug: string,
  avatarData: string | undefined
): Record<string, unknown> {
  const isPublic = typeof data.isPublic === 'boolean' ? data.isPublic : false;
  const finalAvatarData =
    avatarData ?? (typeof data.avatarData === 'string' ? data.avatarData : undefined);

  return {
    name: data.name,
    slug: normalizedSlug,
    characterInfo: data.characterInfo,
    personalityTraits: data.personalityTraits,
    displayName: data.displayName ?? undefined,
    isPublic,
    personalityTone: data.personalityTone ?? undefined,
    personalityAge: data.personalityAge ?? undefined,
    personalityAppearance: data.personalityAppearance ?? undefined,
    personalityLikes: data.personalityLikes ?? undefined,
    personalityDislikes: data.personalityDislikes ?? undefined,
    conversationalGoals: data.conversationalGoals ?? undefined,
    conversationalExamples: data.conversationalExamples ?? undefined,
    customFields: data.customFields ?? undefined,
    avatarData: finalAvatarData,
    errorMessage: data.errorMessage ?? undefined,
  };
}

// ============================================================================
// API OPERATIONS
// ============================================================================

/**
 * Check if character exists and user can edit it
 * Returns: { exists: false } | { exists: true, canEdit: boolean }
 */
async function checkExistingCharacter(
  slug: string,
  userClient: UserClient
): Promise<{ exists: false } | { exists: true; canEdit: boolean }> {
  const result = await userClient.getPersonality(slug);

  if (result.ok) {
    return { exists: true, canEdit: result.data.canEdit };
  }

  // 404 means the slug genuinely isn't claimed in the caller's view —
  // either it doesn't exist or it's private and owned by someone else,
  // which the gateway represents the same way for security reasons.
  // Either way the caller proceeds to create, and the gateway's unique
  // constraint catches the slug-already-claimed-by-another-user case
  // with a 409 on the create call.
  if (result.status === 404) {
    return { exists: false };
  }

  // Any other status (500, network failure, schema-validation failure)
  // shouldn't silently look like "doesn't exist" — that would let a
  // transient gateway error masquerade as a missing record and trigger
  // a create attempt. Surface the error to the caller so the user sees
  // a clearer diagnostic than a downstream 409 unique-constraint reject.
  throw new Error(`Failed to check existing character: ${result.status} - ${result.error}`);
}

/**
 * Create or update character via API. The payload is widened to
 * `Record<string, unknown>` because the import builder produces a
 * dynamically-shaped body (only includes fields that were present in
 * the imported JSON); the gateway's Zod parser is the authoritative
 * validation gate.
 */
async function saveCharacter(
  slug: string,
  userClient: UserClient,
  payload: Record<string, unknown>,
  isUpdate: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = isUpdate
    ? await userClient.updatePersonality(slug, payload)
    : await userClient.createPersonality(payload as Parameters<UserClient['createPersonality']>[0]);

  if (!result.ok) {
    logger.error({ error: result.error, isUpdate }, 'Failed to import');
    return { ok: false, error: result.error };
  }
  return { ok: true };
}

/**
 * Build success embed for import
 */
function buildSuccessEmbed(
  payload: Record<string, unknown>,
  slug: string,
  isUpdate: boolean
): EmbedBuilder {
  const isPublic = payload.isPublic === true;
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

  const importedFields = getImportedFieldsList(payload, IMPORT_FIELD_DEFS);
  embed.addFields({ name: 'Imported Fields', value: importedFields.join(', '), inline: false });

  return embed;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Handle /character import subcommand
 * Allows any user to import a character from a JSON file
 * Optionally accepts a separate avatar image
 */
export async function handleImport(
  context: DeferredCommandContext,
  _config: EnvConfig
): Promise<void> {
  const userId = context.user.id;
  const username = context.user.username;
  const options = characterImportOptions(context.interaction);

  try {
    const fileAttachment = options.file();
    const avatarAttachment = options.avatar();

    // Step 1: Validate, download, parse, and validate JSON file
    const parseResult = await validateAndParseCharacterJsonFile(fileAttachment);
    if ('error' in parseResult) {
      await context.editReply(parseResult.error);
      return;
    }

    // Step 2: Normalize slug
    const slug = normalizeSlugForUser(parseResult.slug, userId, username);

    // Step 3: Process optional avatar
    let avatarData: string | undefined;
    if (avatarAttachment) {
      const avatarResult = await validateAndProcessAvatar(avatarAttachment);
      if ('error' in avatarResult) {
        await context.editReply(avatarResult.error);
        return;
      }
      avatarData = avatarResult.data;
    }

    // Step 4: Build payload
    const payload = buildImportPayload(parseResult.data, slug, avatarData);

    // Step 5: Validate field lengths before hitting the API
    const validationError = validatePayloadFields(payload);
    if (validationError !== null) {
      await context.editReply(validationError);
      return;
    }

    const { userClient } = clientsFor(context.interaction);

    // Step 6: Check if character already exists
    const existingCheck = await checkExistingCharacter(slug, userClient);
    if (existingCheck.exists && !existingCheck.canEdit) {
      await context.editReply(
        `❌ A character with the slug \`${slug}\` already exists and you don't own it.\n` +
          'You can only overwrite characters that you own.'
      );
      return;
    }

    // Step 7: Create or update character
    const saveResult = await saveCharacter(slug, userClient, payload, existingCheck.exists);
    if (!saveResult.ok) {
      await context.editReply(
        `❌ Failed to ${existingCheck.exists ? 'update' : 'import'} character:\n` +
          `\`\`\`\n${saveResult.error.slice(0, 1500)}\n\`\`\``
      );
      return;
    }

    // Step 8: Send success response
    const embed = buildSuccessEmbed(payload, slug, existingCheck.exists);
    await context.editReply({ embeds: [embed] });

    logger.info(
      { slug, userId, isUpdate: existingCheck.exists },
      `Character ${existingCheck.exists ? 'updated' : 'imported'} successfully`
    );
  } catch (error) {
    logger.error({ err: error }, 'Error importing character');
    await context.editReply(
      '❌ An unexpected error occurred while importing the character.\n' +
        'Check bot logs for details.'
    );
  }
}
