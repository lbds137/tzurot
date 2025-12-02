/**
 * Persona Modal Builder Utilities
 *
 * Shared utilities for building persona modals across commands.
 * Used by: create, edit, and override commands.
 */

import { TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types';

/**
 * Existing persona data for pre-filling modal fields
 */
export interface PersonaModalData {
  name?: string | null;
  preferredName?: string | null;
  pronouns?: string | null;
  content?: string | null;
}

/**
 * Options for customizing modal field labels and placeholders
 */
export interface PersonaModalOptions {
  /** Whether to include the persona name field (default: true) */
  includeNameField?: boolean;
  /** Custom placeholder for persona name */
  namePlaceholder?: string;
  /** Custom placeholder for preferred name */
  preferredNamePlaceholder?: string;
  /** Custom label for preferred name field */
  preferredNameLabel?: string;
  /** Custom label for content field */
  contentLabel?: string;
  /** Custom placeholder for content field */
  contentPlaceholder?: string;
}

const DEFAULT_OPTIONS: Required<PersonaModalOptions> = {
  includeNameField: true,
  namePlaceholder: 'A name for this persona (e.g., Default, Work, Creative)',
  preferredNamePlaceholder: 'What should AI call you?',
  preferredNameLabel: 'Preferred Name (what AI calls you)',
  contentLabel: 'About You',
  contentPlaceholder: 'Tell the AI about yourself: interests, personality, context...',
};

/**
 * Build persona modal input fields
 *
 * Creates standardized input fields for persona modals with optional pre-filling.
 * Ensures consistent field IDs across all persona-related modals.
 *
 * @param existingData - Existing persona data to pre-fill (optional)
 * @param options - Customization options for labels/placeholders
 * @returns Array of ActionRowBuilder components ready to add to a modal
 */
export function buildPersonaModalFields(
  existingData?: PersonaModalData | null,
  options?: PersonaModalOptions
): ActionRowBuilder<TextInputBuilder>[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const rows: ActionRowBuilder<TextInputBuilder>[] = [];

  // Persona Name input (optional, but required when included)
  if (opts.includeNameField) {
    const nameInput = new TextInputBuilder()
      .setCustomId('personaName')
      .setLabel('Persona Name')
      .setPlaceholder(opts.namePlaceholder)
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(true);

    if (
      existingData?.name !== null &&
      existingData?.name !== undefined &&
      existingData.name.length > 0
    ) {
      nameInput.setValue(existingData.name);
    }

    rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput));
  }

  // Preferred Name input
  const preferredNameInput = new TextInputBuilder()
    .setCustomId('preferredName')
    .setLabel(opts.preferredNameLabel)
    .setPlaceholder(opts.preferredNamePlaceholder)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(255)
    .setRequired(false);

  if (
    existingData?.preferredName !== null &&
    existingData?.preferredName !== undefined &&
    existingData.preferredName.length > 0
  ) {
    preferredNameInput.setValue(existingData.preferredName);
  }

  rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(preferredNameInput));

  // Pronouns input
  const pronounsInput = new TextInputBuilder()
    .setCustomId('pronouns')
    .setLabel('Pronouns')
    .setPlaceholder('e.g., she/her, he/him, they/them')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(false);

  if (
    existingData?.pronouns !== null &&
    existingData?.pronouns !== undefined &&
    existingData.pronouns.length > 0
  ) {
    pronounsInput.setValue(existingData.pronouns);
  }

  rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(pronounsInput));

  // Content input (longer text)
  const contentInput = new TextInputBuilder()
    .setCustomId('content')
    .setLabel(opts.contentLabel)
    .setPlaceholder(opts.contentPlaceholder)
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH)
    .setRequired(false);

  if (
    existingData?.content !== null &&
    existingData?.content !== undefined &&
    existingData.content.length > 0
  ) {
    // Truncate if exceeds modal limit
    const truncatedContent =
      existingData.content.length > DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH
        ? existingData.content.substring(0, DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH)
        : existingData.content;
    contentInput.setValue(truncatedContent);
  }

  rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput));

  return rows;
}
