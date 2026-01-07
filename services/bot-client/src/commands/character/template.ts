/**
 * Character Template Subcommand
 * Handles /character template - provides a downloadable JSON template for import
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { AttachmentBuilder } from 'discord.js';
import type { EnvConfig } from '@tzurot/common-types';
import { CHARACTER_JSON_TEMPLATE } from './import.js';

/**
 * Handle /character template subcommand
 * Provides a downloadable JSON template file for character import
 */
export async function handleTemplate(
  interaction: ChatInputCommandInteraction,
  _config: EnvConfig
): Promise<void> {
  // Create JSON attachment
  const jsonBuffer = Buffer.from(CHARACTER_JSON_TEMPLATE, 'utf-8');
  const jsonAttachment = new AttachmentBuilder(jsonBuffer, {
    name: 'character_card_template.json',
    description: 'Template JSON file for character import',
  });

  const message =
    '**📋 Character Import Template**\n\n' +
    'Fill in your values in the downloaded template, then use `/character import` to upload it.\n\n' +
    '**Required fields:** `name`, `slug`, `characterInfo`, `personalityTraits`\n' +
    '**Slug format:** lowercase letters, numbers, and hyphens only (e.g., `my-character`)\n' +
    '**Avatar:** Upload a separate image file when importing using the `avatar` option';

  await interaction.editReply({
    content: message,
    files: [jsonAttachment],
  });
}
