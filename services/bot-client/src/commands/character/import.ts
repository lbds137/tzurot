/**
 * Character Import Subcommand
 * Handles /character import - allows users to import characters from JSON files
 */

import { EmbedBuilder } from 'discord.js';
import {
  createLogger,
  DISCORD_LIMITS,
  DISCORD_COLORS,
  type EnvConfig,
  characterImportOptions,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { normalizeSlugForUser } from '../../utils/slugUtils.js';
import {
  VALID_IMAGE_TYPES,
  MAX_INPUT_SIZE_MB,
  MAX_INPUT_SIZE_BYTES,
  processAvatarBuffer,
} from './avatarUtils.js';

const logger = createLogger('character-import');

// ============================================================================
// TYPES
// ============================================================================

/** Result of avatar processing */
interface AvatarProcessingResult {
  success: true;
  data: string;
}

/** Field definition for import field list */
interface ImportFieldDef {
  key: string;
  label: string;
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
 * Validate JSON file attachment
 */
function validateJsonFile(
  file: NonNullable<
    ReturnType<
      typeof import('discord.js').ChatInputCommandInteraction.prototype.options.getAttachment
    >
  >
): string | null {
  if ((file.contentType?.includes('json') ?? false) === false && !file.name.endsWith('.json')) {
    return '❌ File must be a JSON file (.json)';
  }
  if (file.size > DISCORD_LIMITS.AVATAR_SIZE) {
    return '❌ File is too large (max 10MB)';
  }
  return null;
}

/**
 * Download and parse JSON file
 */
async function downloadAndParseJson(
  url: string,
  filename: string
): Promise<{ data: Record<string, unknown> } | { error: string }> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    const data = JSON.parse(text) as Record<string, unknown>;
    logger.info(
      { filename, sizeKb: (text.length / 1024).toFixed(2) },
      '[Character/Import] Downloaded JSON'
    );
    return { data };
  } catch (error) {
    logger.error({ err: error }, '[Character/Import] Failed to download or parse JSON');
    return {
      error:
        '❌ Failed to parse JSON file.\n' +
        'Make sure the file is valid JSON format.\n\n' +
        buildTemplateMessage(),
    };
  }
}

/**
 * Validate character data has required fields and valid slug
 */
function validateCharacterData(
  data: Record<string, unknown>
): { slug: string } | { error: string } {
  const missingFields = REQUIRED_IMPORT_FIELDS.filter(
    field => data[field] === undefined || data[field] === null || data[field] === ''
  );
  if (missingFields.length > 0) {
    return {
      error: `❌ Missing required fields: ${missingFields.join(', ')}\n\n` + buildTemplateMessage(),
    };
  }

  const rawSlug = data.slug as string;
  if (!/^[a-z0-9-]+$/.test(rawSlug)) {
    return {
      error:
        '❌ Invalid slug format in JSON. Use only lowercase letters, numbers, and hyphens.\n' +
        `Example: \`${rawSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-')}\``,
    };
  }

  return { slug: rawSlug };
}

/**
 * Combined: validate JSON file, download, parse, and validate character data
 */
async function validateAndParseJsonFile(
  file: NonNullable<
    ReturnType<
      typeof import('discord.js').ChatInputCommandInteraction.prototype.options.getAttachment
    >
  >
): Promise<{ data: Record<string, unknown>; slug: string } | { error: string }> {
  // Validate file type and size
  const fileError = validateJsonFile(file);
  if (fileError !== null) {
    return { error: fileError };
  }

  // Download and parse
  const jsonResult = await downloadAndParseJson(file.url, file.name);
  if ('error' in jsonResult) {
    return { error: jsonResult.error };
  }

  // Validate character data
  const validationResult = validateCharacterData(jsonResult.data);
  if ('error' in validationResult) {
    return { error: validationResult.error };
  }

  return { data: jsonResult.data, slug: validationResult.slug };
}

/**
 * Validate avatar attachment
 */
function validateAvatarAttachment(
  avatar: NonNullable<
    ReturnType<
      typeof import('discord.js').ChatInputCommandInteraction.prototype.options.getAttachment
    >
  >
): string | null {
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
  avatar: NonNullable<
    ReturnType<
      typeof import('discord.js').ChatInputCommandInteraction.prototype.options.getAttachment
    >
  >
): Promise<AvatarProcessingResult | { error: string }> {
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
      '[Character/Import] Processed avatar image'
    );

    return { success: true, data: result.buffer.toString('base64') };
  } catch (error) {
    logger.error({ err: error }, '[Character/Import] Failed to download avatar');
    return { error: '❌ Failed to download avatar image. Please try again.' };
  }
}

/**
 * Validate and process avatar attachment (combines validation and processing)
 */
async function validateAndProcessAvatar(
  avatar: NonNullable<
    ReturnType<
      typeof import('discord.js').ChatInputCommandInteraction.prototype.options.getAttachment
    >
  >
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

/**
 * Get list of imported field labels from payload
 */
function getImportedFieldsList(payload: Record<string, unknown>): string[] {
  return IMPORT_FIELD_DEFS.filter(
    ({ key }) => payload[key] !== undefined && payload[key] !== null
  ).map(({ label }) => label);
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
  userId: string
): Promise<{ exists: false } | { exists: true; canEdit: boolean }> {
  const result = await callGatewayApi<{
    personality: { id: string };
    canEdit: boolean;
  }>(`/user/personality/${slug}`, {
    userId,
    method: 'GET',
  });

  if (!result.ok) {
    return { exists: false };
  }
  return { exists: true, canEdit: result.data.canEdit };
}

/**
 * Create or update character via API
 */
async function saveCharacter(
  slug: string,
  userId: string,
  payload: Record<string, unknown>,
  isUpdate: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await callGatewayApi<{ id: string }>(
    isUpdate ? `/user/personality/${slug}` : '/user/personality',
    {
      userId,
      method: isUpdate ? 'PUT' : 'POST',
      body: payload,
    }
  );

  if (!result.ok) {
    logger.error({ error: result.error, isUpdate }, '[Character/Import] Failed to import');
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

  const importedFields = getImportedFieldsList(payload);
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
    const parseResult = await validateAndParseJsonFile(fileAttachment);
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

    // Step 5: Check if character already exists
    const existingCheck = await checkExistingCharacter(slug, userId);
    if (existingCheck.exists && !existingCheck.canEdit) {
      await context.editReply(
        `❌ A character with the slug \`${slug}\` already exists and you don't own it.\n` +
          'You can only overwrite characters that you own.'
      );
      return;
    }

    // Step 6: Create or update character
    const saveResult = await saveCharacter(slug, userId, payload, existingCheck.exists);
    if (!saveResult.ok) {
      await context.editReply(
        `❌ Failed to ${existingCheck.exists ? 'update' : 'import'} character:\n` +
          `\`\`\`\n${saveResult.error.slice(0, 1500)}\n\`\`\``
      );
      return;
    }

    // Step 7: Send success response
    const embed = buildSuccessEmbed(payload, slug, existingCheck.exists);
    await context.editReply({ embeds: [embed] });

    logger.info(
      { slug, userId, isUpdate: existingCheck.exists },
      `[Character/Import] Character ${existingCheck.exists ? 'updated' : 'imported'} successfully`
    );
  } catch (error) {
    logger.error({ err: error }, '[Character/Import] Error importing character');
    await context.editReply(
      '❌ An unexpected error occurred while importing the character.\n' +
        'Check bot logs for details.'
    );
  }
}
