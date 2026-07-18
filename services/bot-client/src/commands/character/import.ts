/**
 * Character Import Subcommand
 * Handles /character import - allows users to import characters from JSON files
 */

import { EmbedBuilder } from 'discord.js';
import { type EnvConfig } from '@tzurot/common-types/config/config';
import { DISCORD_COLORS, DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { characterImportOptions } from '@tzurot/common-types/generated/commandOptions';
import {
  PersonalityCreateSchema,
  SLUG_PATTERN,
  SLUG_REQUIREMENTS_MESSAGE,
  SLUG_MIN_LENGTH,
} from '@tzurot/common-types/schemas/api/personality';
import { suggestSlugExample, normalizeSlugForUser } from '@tzurot/common-types/utils/slugUtils';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { UserClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { validateJsonFile, downloadAndParseJson } from '../../utils/jsonFileUtils.js';
import { validateDiscordCdnUrl } from '../../utils/discordCdnGuard.js';
import { sendShadowedAliasFollowUp } from './api.js';
import { processAvatarBuffer } from './avatarUtils.js';
import { validateImageAttachment, validateAudioAttachment } from './mediaValidation.js';
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
  { key: 'voiceReferenceData', label: 'Voice Reference' },
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
  "definitionPublic": false,
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
    '**Slug format:** starts with a letter; lowercase letters, numbers, and hyphens (e.g., `my-character`)\n' +
    '**Avatar & voice:** attach an image to the `image` option and/or a voice reference to the `audio` option'
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
      error: renderSpec(
        CATALOG.error.validation(
          `Missing required fields: ${missingFields.join(', ')}\n\n` + buildTemplateMessage()
        )
      ),
    };
  }

  const rawSlug = data.slug as string;
  // Same pattern the gateway enforces (leading letter) — also closes the
  // all-hyphen base that could reach fitSlugToMaxLength and emit a
  // leading-hyphen result.
  if (!SLUG_PATTERN.test(rawSlug)) {
    return {
      error: renderSpec(
        CATALOG.error.validation(
          `Invalid slug format in JSON. ${SLUG_REQUIREMENTS_MESSAGE}\nExample: \`${suggestSlugExample(rawSlug)}\``
        )
      ),
    };
  }
  if (rawSlug.length < SLUG_MIN_LENGTH || rawSlug.length > DISCORD_LIMITS.SLUG_MAX_LENGTH) {
    return {
      error: renderSpec(
        CATALOG.error.validation(
          `Slug must be ${SLUG_MIN_LENGTH}–${DISCORD_LIMITS.SLUG_MAX_LENGTH} characters (yours is ${rawSlug.length}).`
        )
      ),
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
 * Download a Discord CDN attachment with a 30s timeout (matches avatar.ts /
 * voice.ts — a slow CDN must not hold the deferred interaction open).
 */
async function downloadCdnAttachment(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Validate + download + process the optional avatar attachment.
 * Returns base64 (no data-URI prefix — the avatar column stores raw base64).
 */
async function validateAndProcessAvatar(
  avatar: AttachmentOption
): Promise<{ data: string } | { error: string }> {
  const validationError = validateImageAttachment(avatar);
  if (validationError !== null) {
    return { error: validationError };
  }
  const cdnGuard = validateDiscordCdnUrl(avatar.url, logger);
  if (!cdnGuard.ok) {
    return { error: renderSpec(CATALOG.error.validation('Invalid attachment URL.')) };
  }
  try {
    const rawBuffer = await downloadCdnAttachment(avatar.url);
    const result = await processAvatarBuffer(rawBuffer, avatar.name ?? 'import-avatar');
    if (!result.success) {
      return { error: renderSpec(CATALOG.error.validation(result.message)) };
    }
    return { data: result.buffer.toString('base64') };
  } catch (error) {
    logger.error({ err: error }, 'Failed to download avatar');
    return { error: renderSpec(CATALOG.error.operationFailed('download the image')) };
  }
}

/**
 * Validate + download the optional voice attachment.
 * Returns a base64 data URI (the voice column stores a data URI, matching the
 * /character voice upload path).
 */
async function validateAndProcessVoice(
  audio: AttachmentOption
): Promise<{ data: string } | { error: string }> {
  const validationError = validateAudioAttachment(audio);
  if (validationError !== null) {
    return { error: validationError };
  }
  const cdnGuard = validateDiscordCdnUrl(audio.url, logger);
  if (!cdnGuard.ok) {
    return { error: renderSpec(CATALOG.error.validation('Invalid attachment URL.')) };
  }
  try {
    const rawBuffer = await downloadCdnAttachment(audio.url);
    return { data: `data:${audio.contentType};base64,${rawBuffer.toString('base64')}` };
  } catch (error) {
    logger.error({ err: error }, 'Failed to download voice reference');
    return { error: renderSpec(CATALOG.error.operationFailed('download the audio file')) };
  }
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

  return renderSpec(
    CATALOG.error.validation(`**Validation errors in import file:**\n${fieldErrors.join('\n')}`)
  );
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
  avatarData: string | undefined,
  voiceReferenceData: string | undefined
): Record<string, unknown> {
  const isPublic = typeof data.isPublic === 'boolean' ? data.isPublic : false;
  // Absent in the JSON → private internals (the safe default for a shared file).
  const definitionPublic =
    typeof data.definitionPublic === 'boolean' ? data.definitionPublic : false;
  // Attachment wins over the JSON field; fall back to the JSON payload's own
  // embedded data if the user didn't attach one. Same precedence for both media.
  const finalAvatarData =
    avatarData ?? (typeof data.avatarData === 'string' ? data.avatarData : undefined);
  const finalVoiceData =
    voiceReferenceData ??
    (typeof data.voiceReferenceData === 'string' ? data.voiceReferenceData : undefined);

  return {
    name: data.name,
    slug: normalizedSlug,
    characterInfo: data.characterInfo,
    personalityTraits: data.personalityTraits,
    displayName: data.displayName ?? undefined,
    isPublic,
    definitionPublic,
    personalityTone: data.personalityTone ?? undefined,
    personalityAge: data.personalityAge ?? undefined,
    personalityAppearance: data.personalityAppearance ?? undefined,
    personalityLikes: data.personalityLikes ?? undefined,
    personalityDislikes: data.personalityDislikes ?? undefined,
    conversationalGoals: data.conversationalGoals ?? undefined,
    conversationalExamples: data.conversationalExamples ?? undefined,
    customFields: data.customFields ?? undefined,
    avatarData: finalAvatarData,
    voiceReferenceData: finalVoiceData,
    // Enable voice whenever a reference is present. On CREATE this is stripped
    // (not in the create schema) and derived from the reference server-side; on
    // UPDATE (re-import into an existing slug) it's honored — without it, the
    // re-import would store the reference but leave voice disabled.
    voiceEnabled: finalVoiceData !== undefined ? true : undefined,
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
): Promise<{ ok: true; shadowedAliases: string[] } | { ok: false; failure: unknown }> {
  const result = isUpdate
    ? await userClient.updatePersonality(slug, payload)
    : await userClient.createPersonality(payload as Parameters<UserClient['createPersonality']>[0]);

  if (!result.ok) {
    logger.error({ error: result.error, isUpdate }, 'Failed to import');
    // Return the fail-arm itself so the caller can classify honestly (kind
    // preserved — an import timeout is outcome-uncertain, not "failed").
    return { ok: false, failure: result };
  }
  // Warn-don't-block ride-along: GLOBAL aliases the imported name/slug shadows.
  return { ok: true, shadowedAliases: result.data.shadowedAliases ?? [] };
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
    const avatarAttachment = options.image();
    const voiceAttachment = options.audio();

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

    // Step 3b: Process optional voice reference (auto-enables voice server-side)
    let voiceReferenceData: string | undefined;
    if (voiceAttachment) {
      const voiceResult = await validateAndProcessVoice(voiceAttachment);
      if ('error' in voiceResult) {
        await context.editReply(voiceResult.error);
        return;
      }
      voiceReferenceData = voiceResult.data;
    }

    // Step 4: Build payload
    const payload = buildImportPayload(parseResult.data, slug, avatarData, voiceReferenceData);

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
        renderSpec(
          CATALOG.error.validation(
            `A character with the slug \`${slug}\` already exists and you don't own it.\nYou can only overwrite characters that you own.`
          )
        )
      );
      return;
    }

    // Step 7: Create or update character
    const saveResult = await saveCharacter(slug, userClient, payload, existingCheck.exists);
    if (!saveResult.ok) {
      await context.editReply(
        renderSpec(
          classifyGatewayFailure(saveResult.failure, 'character', {
            failedAction: existingCheck.exists ? 'update the character' : 'import the character',
          })
        )
      );
      return;
    }

    // Step 8: Send success response
    const embed = buildSuccessEmbed(payload, slug, existingCheck.exists);
    await context.editReply({ embeds: [embed] });

    // Reverse-shadow advisory (warn-don't-block): the imported name/slug
    // shadows existing global aliases at resolution time.
    await sendShadowedAliasFollowUp(context, saveResult.shadowedAliases);

    logger.info(
      { slug, userId, isUpdate: existingCheck.exists },
      `Character ${existingCheck.exists ? 'updated' : 'imported'} successfully`
    );
  } catch (error) {
    logger.error({ err: error }, 'Error importing character');
    await context.editReply(
      renderSpec(
        classifyGatewayFailure(error, 'character', { failedAction: 'import the character' })
      )
    );
  }
}
