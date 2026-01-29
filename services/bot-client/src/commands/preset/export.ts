/**
 * Preset Export Subcommand
 * Handles /preset export - allows users to export their presets as JSON files
 */

import { escapeMarkdown } from 'discord.js';
import { createLogger, isBotOwner, presetExportOptions } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { createJsonAttachment } from '../../utils/jsonFileUtils.js';
import type { PresetData } from './types.js';

const logger = createLogger('preset-export');

/**
 * API response type for preset endpoint
 * Note: API returns 'config' not 'preset' to match api.ts pattern
 */
interface PresetResponse {
  config: PresetData;
}

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
] as const;

/**
 * Extract sampling parameters from preset params
 */
function extractSamplingParams(params: PresetData['params']): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (params.temperature !== undefined) {
    result.temperature = params.temperature;
  }
  if (params.top_p !== undefined) {
    result.top_p = params.top_p;
  }
  if (params.top_k !== undefined) {
    result.top_k = params.top_k;
  }
  if (params.max_tokens !== undefined) {
    result.max_tokens = params.max_tokens;
  }
  if (params.seed !== undefined) {
    result.seed = params.seed;
  }
  if (params.frequency_penalty !== undefined) {
    result.frequency_penalty = params.frequency_penalty;
  }
  if (params.presence_penalty !== undefined) {
    result.presence_penalty = params.presence_penalty;
  }
  if (params.repetition_penalty !== undefined) {
    result.repetition_penalty = params.repetition_penalty;
  }
  if (params.min_p !== undefined) {
    result.min_p = params.min_p;
  }
  if (params.top_a !== undefined) {
    result.top_a = params.top_a;
  }

  return result;
}

/**
 * Extract reasoning parameters from preset params
 */
function extractReasoningParams(
  reasoning: NonNullable<PresetData['params']['reasoning']>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (reasoning.effort !== undefined) {
    result.effort = reasoning.effort;
  }
  if (reasoning.max_tokens !== undefined) {
    result.max_tokens = reasoning.max_tokens;
  }
  if (reasoning.exclude !== undefined) {
    result.exclude = reasoning.exclude;
  }
  if (reasoning.enabled !== undefined) {
    result.enabled = reasoning.enabled;
  }

  return result;
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
