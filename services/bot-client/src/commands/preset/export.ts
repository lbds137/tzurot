/**
 * Preset Export Subcommand
 * Handles /preset export - allows users to export their presets as JSON files
 */

import { escapeMarkdown } from 'discord.js';
import { createLogger, isBotOwner, presetExportOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { createJsonAttachment } from '../../utils/jsonFileUtils.js';
import type { PresetData, PresetResponse } from './types.js';

const logger = createLogger('preset-export');

/**
 * Fields to include in exported JSON
 * Excludes: id (generated on import), isGlobal (toggle in dashboard),
 * isOwned/permissions (computed server-side)
 */
const EXPORT_FIELDS = [
  'name',
  'description',
  'provider',
  'model',
  'visionModel',
  'maxReferencedMessages',
  'memoryScoreThreshold',
  'memoryLimit',
  'contextWindowTokens',
] as const;

/** Sampling parameter keys to extract from preset params */
const SAMPLING_PARAMS = [
  'temperature',
  'top_p',
  'top_k',
  'max_tokens',
  'seed',
  'frequency_penalty',
  'presence_penalty',
  'repetition_penalty',
  'min_p',
  'top_a',
] as const;

/** Reasoning parameter keys to extract from reasoning config */
const REASONING_PARAMS = ['effort', 'max_tokens', 'exclude', 'enabled'] as const;

/**
 * Extract defined parameters from an object using a list of keys
 */
function extractDefinedParams<T extends Record<string, unknown>>(
  source: T,
  keys: readonly string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Extract sampling parameters from preset params
 */
function extractSamplingParams(params: PresetData['params']): Record<string, unknown> {
  return extractDefinedParams(params, SAMPLING_PARAMS);
}

/**
 * Extract reasoning parameters from preset params
 */
function extractReasoningParams(
  reasoning: NonNullable<PresetData['params']['reasoning']>
): Record<string, unknown> {
  return extractDefinedParams(reasoning, REASONING_PARAMS);
}

/**
 * Build exportable preset data including advanced parameters
 */
function buildPresetExportData(preset: PresetData): Record<string, unknown> {
  // Build basic fields
  const exportData: Record<string, unknown> = {};

  for (const field of EXPORT_FIELDS) {
    const value = preset[field as keyof PresetData];
    if (value !== null && value !== undefined && value !== '') {
      exportData[field] = value;
    }
  }

  // Build advanced parameters
  const advancedParams = extractSamplingParams(preset.params);

  // Add reasoning if present
  if (preset.params.reasoning !== undefined) {
    const reasoning = extractReasoningParams(preset.params.reasoning);
    if (Object.keys(reasoning).length > 0) {
      advancedParams.reasoning = reasoning;
    }
  }

  // Add show_thinking
  if (preset.params.show_thinking !== undefined) {
    advancedParams.show_thinking = preset.params.show_thinking;
  }

  // Only add advancedParameters if we have any
  if (Object.keys(advancedParams).length > 0) {
    exportData.advancedParameters = advancedParams;
  }

  return exportData;
}

/**
 * Handle /preset export subcommand
 * Exports preset as JSON file
 */
export async function handleExport(context: DeferredCommandContext): Promise<void> {
  const options = presetExportOptions(context.interaction);
  const presetId = options.preset();
  const userId = context.user.id;

  try {
    // Fetch preset data
    const result = await callGatewayApi<PresetResponse>(`/user/llm-config/${presetId}`, {
      userId,
    });

    if (!result.ok) {
      if (result.status === 404) {
        await context.editReply(`❌ Preset not found.`);
        return;
      }
      if (result.status === 403) {
        await context.editReply(`❌ You don't have access to this preset.`);
        return;
      }
      throw new Error(`API error: ${result.status}`);
    }

    const preset = result.data.config;

    // Check ownership - only preset owner or bot owner can export
    if (!preset.permissions.canEdit && !isBotOwner(userId)) {
      await context.editReply(
        `❌ You don't have permission to export this preset.\n` +
          'You can only export presets you own.'
      );
      return;
    }

    // Build export data
    const exportData = buildPresetExportData(preset);

    // Create JSON attachment
    const safeName = preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const attachment = createJsonAttachment(exportData, safeName, `Preset data: ${preset.name}`);

    const contentParts: string[] = [
      `✅ Exported **${escapeMarkdown(preset.name)}**`,
      '',
      '📝 Edit the JSON and re-import with `/preset import`.',
    ];

    await context.editReply({
      content: contentParts.join('\n'),
      files: [attachment],
    });

    logger.info({ presetId, userId, presetName: preset.name }, '[Preset/Export] Preset exported');
  } catch (error) {
    logger.error({ err: error, presetId }, '[Preset/Export] Error exporting preset');
    await context.editReply('❌ An unexpected error occurred while exporting the preset.');
  }
}
