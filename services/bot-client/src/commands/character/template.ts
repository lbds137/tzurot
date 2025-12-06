/**
 * Character Template Subcommand
 * Handles /character template - shows the JSON template for import
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import type { EnvConfig } from '@tzurot/common-types';
import { CHARACTER_JSON_TEMPLATE } from './import.js';

/**
 * Handle /character template subcommand
 * Shows the JSON template that users can copy-paste for import
 */
export async function handleTemplate(
  interaction: ChatInputCommandInteraction,
  _config: EnvConfig
): Promise<void> {
  const message =
    '**📋 Character Import Template**\n\n' +
    'Copy and paste this JSON template, fill in your values, save as a `.json` file, ' +
    'then use `/character import` to upload it.\n\n' +
    '```json\n' +
    CHARACTER_JSON_TEMPLATE +
    '\n```\n\n' +
    '**Required fields:** `name`, `slug`, `characterInfo`, `personalityTraits`\n' +
    '**Slug format:** lowercase letters, numbers, and hyphens only (e.g., `my-character`)\n' +
    '**Avatar:** Upload a separate image file when importing using the `avatar` option';

  await interaction.reply({
    content: message,
    flags: MessageFlags.Ephemeral,
  });
}
