/**
 * Preset Import Subcommand
 * Handles /preset import - allows users to import presets from JSON files
 */

import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { presetImportOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { UserClient } from '@tzurot/clients';
import { clientsFor } from '../../utils/gatewayClients.js';
import { validateAndParseJsonFile } from '../../utils/jsonFileUtils.js';
import { updatePreset } from './api.js';
import {
  getImportedFieldsList,
  getMissingRequiredFields,
  type ImportFieldDef,
} from '../../utils/importValidation.js';

const logger = createLogger('preset-import');

// ============================================================================
// TYPES
// ============================================================================

/** Parsed preset data from JSON file */
interface ImportedPresetData {
  name?: string;
  description?: string;
  provider?: string;
  model?: string;
  contextWindowTokens?: number;
  /** Visibility round-trip: exports carry it; import applies it post-create. */
  isGlobal?: boolean;
  advancedParameters?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    max_tokens?: number;
    seed?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    repetition_penalty?: number;
    min_p?: number;
    top_a?: number;
    reasoning?: {
      effort?: string;
      max_tokens?: number;
      exclude?: boolean;
      enabled?: boolean;
    };
    show_thinking?: boolean;
  };
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * JSON template for preset import
 */
export const PRESET_JSON_TEMPLATE = `{
  "name": "My Custom Preset",
  "description": "A description of what this preset is for (optional)",
  "provider": "anthropic",
  "model": "anthropic/claude-sonnet-4",
  "contextWindowTokens": 131072,
  "isGlobal": false,
  "advancedParameters": {
    "temperature": 0.7,
    "top_p": 0.9,
    "max_tokens": 4096,
    "reasoning": {
      "effort": "medium",
      "enabled": true
    },
    "show_thinking": false
  }
}`;

/**
 * Required fields for preset import
 */
export const REQUIRED_IMPORT_FIELDS = ['name', 'model'];

/** Import field definitions for building success message */
const IMPORT_FIELD_DEFS: ImportFieldDef[] = [
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'provider', label: 'Provider' },
  { key: 'model', label: 'Model' },
  { key: 'contextWindowTokens', label: 'Context Window Tokens' },
  { key: 'isGlobal', label: 'Visibility' },
  { key: 'advancedParameters', label: 'Advanced Parameters' },
];

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Build the template help message
 */
function buildTemplateMessage(): string {
  return (
    '💡 **Tip:** Use `/preset template` to download a template JSON file.\n\n' +
    '**Required fields:** `name`, `model`\n' +
    '**Model format:** `provider/model-name` (e.g., `anthropic/claude-sonnet-4`)'
  );
}

/**
 * Validate preset data has required fields
 */
function validatePresetData(data: Record<string, unknown>): { valid: true } | { error: string } {
  const missingFields = getMissingRequiredFields(data, REQUIRED_IMPORT_FIELDS);

  if (missingFields.length > 0) {
    return {
      error: `❌ Missing required fields: ${missingFields.join(', ')}\n\n` + buildTemplateMessage(),
    };
  }

  // Validate model format (should contain a slash for provider/model)
  const model = data.model as string;
  if (!model.includes('/')) {
    return {
      error:
        '❌ Invalid model format. Use `provider/model-name` format.\n' +
        `Example: \`anthropic/claude-sonnet-4\`\n\n` +
        buildTemplateMessage(),
    };
  }

  return { valid: true };
}

// ============================================================================
// PAYLOAD BUILDING
// ============================================================================

/**
 * Build API payload from parsed preset data
 */
function buildImportPayload(data: ImportedPresetData): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: data.name,
    model: data.model,
  };

  // Optional fields - use explicit checks for strict boolean expressions
  if (data.description !== undefined && data.description !== '') {
    payload.description = data.description;
  }
  if (data.provider !== undefined && data.provider !== '') {
    payload.provider = data.provider;
  }
  if (data.contextWindowTokens !== undefined) {
    payload.contextWindowTokens = data.contextWindowTokens;
  }
  if (data.advancedParameters !== undefined && Object.keys(data.advancedParameters).length > 0) {
    payload.advancedParameters = data.advancedParameters;
  }
  if (typeof data.isGlobal === 'boolean') {
    payload.isGlobal = data.isGlobal;
  }

  return payload;
}

// ============================================================================
// API OPERATIONS
// ============================================================================

/**
 * Create preset via API
 */
async function createPresetFromImport(
  userClient: UserClient,
  payload: Record<string, unknown>
): Promise<{ ok: true; id: string; globalApplied?: boolean } | { ok: false; error: string }> {
  // Create preset with all fields - API supports all fields in create endpoint
  const createResult = await userClient.createUserLlmConfig({
    name: payload.name,
    model: payload.model,
    provider: payload.provider,
    description: payload.description,
    contextWindowTokens: payload.contextWindowTokens,
    advancedParameters: payload.advancedParameters,
  } as Parameters<UserClient['createUserLlmConfig']>[0]);

  if (!createResult.ok) {
    logger.error({ error: createResult.error }, 'Failed to create preset');
    return { ok: false, error: createResult.error };
  }
  const id = createResult.data.config.id;

  // Visibility round-trip: create lands private; apply isGlobal afterwards via the
  // same update the dashboard toggle uses. A failure here must NOT fail the import —
  // the preset exists; the caller surfaces "stayed private" in the result embed.
  if (payload.isGlobal !== true) {
    return { ok: true, id };
  }
  try {
    await updatePreset(id, { isGlobal: true }, userClient);
    return { ok: true, id, globalApplied: true };
  } catch (error) {
    logger.warn(
      { err: error, presetId: id },
      'Imported preset created but applying isGlobal failed — left private'
    );
    return { ok: true, id, globalApplied: false };
  }
}

/**
 * Build success embed for import
 */
function buildSuccessEmbed(
  payload: Record<string, unknown>,
  presetName: string,
  globalApplied?: boolean
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.SUCCESS)
    .setTitle('Preset Imported Successfully')
    .setDescription(`Imported preset: **${escapeMarkdown(presetName)}**`)
    .setTimestamp();

  const importedFields = getImportedFieldsList(payload, IMPORT_FIELD_DEFS);
  embed.addFields({ name: 'Imported Fields', value: importedFields.join(', '), inline: false });

  // Visibility outcome — only shown when the file requested isGlobal:true. The apply
  // is a separate post-create step, so its failure leaves a working PRIVATE preset;
  // the user must see which of the two outcomes they got.
  if (globalApplied !== undefined) {
    embed.addFields({
      name: 'Visibility',
      value: globalApplied
        ? '🌐 Global (visible to everyone)'
        : '⚠️ Could not apply global visibility — imported as private. Toggle it in the dashboard.',
      inline: false,
    });
  }

  return embed;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Handle /preset import subcommand
 * Allows any user to import a preset from a JSON file
 */
export async function handleImport(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = presetImportOptions(context.interaction);

  try {
    const fileAttachment = options.file();

    // Step 1: Validate, download, and parse JSON file
    const parseResult = await validateAndParseJsonFile<ImportedPresetData>(fileAttachment);
    if ('error' in parseResult) {
      await context.editReply(parseResult.error + '\n\n' + buildTemplateMessage());
      return;
    }

    // Step 2: Validate required fields
    const validationResult = validatePresetData(parseResult.data as Record<string, unknown>);
    if ('error' in validationResult) {
      await context.editReply(validationResult.error);
      return;
    }

    // Step 3: Build payload
    const payload = buildImportPayload(parseResult.data);

    // Step 4: Create preset
    const { userClient } = clientsFor(context.interaction);
    const createResult = await createPresetFromImport(userClient, payload);
    if (!createResult.ok) {
      await context.editReply(
        `❌ Failed to import preset:\n\`\`\`\n${createResult.error.slice(0, 1500)}\n\`\`\``
      );
      return;
    }

    // Step 5: Send success response
    const presetName = payload.name as string;
    const embed = buildSuccessEmbed(payload, presetName, createResult.globalApplied);
    await context.editReply({ embeds: [embed] });

    logger.info({ presetId: createResult.id, userId, presetName }, 'Preset imported successfully');
  } catch (error) {
    logger.error({ err: error }, 'Error importing preset');
    await context.editReply(
      '❌ An unexpected error occurred while importing the preset.\n' +
        'Check bot logs for details.'
    );
  }
}
