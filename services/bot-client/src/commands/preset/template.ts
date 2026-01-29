/**
 * Preset Template Subcommand
 * Handles /preset template - provides a downloadable JSON template for import
 */

import { AttachmentBuilder } from 'discord.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { PRESET_JSON_TEMPLATE } from './import.js';

/**
 * Handle /preset template subcommand
 * Provides a downloadable JSON template file for preset import
 */
export async function handleTemplate(context: DeferredCommandContext): Promise<void> {
  // Create JSON attachment
  const jsonBuffer = Buffer.from(PRESET_JSON_TEMPLATE, 'utf-8');
  const jsonAttachment = new AttachmentBuilder(jsonBuffer, {
    name: 'preset_template.json',
    description: 'Template JSON file for preset import',
  });

  const message =
    '**📋 Preset Import Template**\n\n' +
    'Fill in your values in the downloaded template, then use `/preset import` to upload it.\n\n' +
    '**Required fields:** `name`, `model`\n' +
    '**Model format:** `provider/model-name` (e.g., `anthropic/claude-sonnet-4`)\n\n' +
    '**Optional sections:**\n' +
    '• `description` - What this preset is for\n' +
    '• `visionModel` - Model for image analysis\n' +
    '• `maxReferencedMessages` - Context message limit\n' +
    '• `advancedParameters` - Temperature, reasoning settings, etc.';

  await context.editReply({
    content: message,
    files: [jsonAttachment],
  });
}
