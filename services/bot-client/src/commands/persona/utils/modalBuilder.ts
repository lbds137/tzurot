/**
 * Persona Modal Builder Utilities
 *
 * Shared utilities for building persona edit modals.
 * Used by both the default persona edit and personality-specific overrides.
 */

import { TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types';

/**
 * Persona data for pre-filling modal fields
 */
export interface PersonaModalData {
  preferredName?: string | null;
  pronouns?: string | null;
  content?: string | null;
}

/**
 * Options for building persona input fields
 */
export interface PersonaInputOptions {
  /** Name placeholder (e.g., "What should AI call you?" or "What should Lilith call you?") */
  namePlaceholder?: string;
  /** Content label (e.g., "About You" or "About You (for Lilith)") */
  contentLabel?: string;
  /** Content placeholder */
  contentPlaceholder?: string;
}

const DEFAULT_OPTIONS: Required<PersonaInputOptions> = {
  namePlaceholder: 'What should AI call you?',
  contentLabel: 'About You',
  contentPlaceholder:
    'Tell the AI about yourself: interests, personality, context it should know...',
};

/**
 * Build persona input fields with optional pre-filled values
 *
 * @param existingData - Existing persona data to pre-fill (optional)
 * @param options - Customization options for labels/placeholders
 * @returns Array of ActionRowBuilder components ready to add to a modal
 */
export function buildPersonaInputFields(
  existingData?: PersonaModalData | null,
  options?: PersonaInputOptions
): ActionRowBuilder<TextInputBuilder>[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Preferred Name input
  const nameInput = new TextInputBuilder()
    .setCustomId('preferredName')
    .setLabel('Preferred Name')
    .setPlaceholder(opts.namePlaceholder)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(255)
    .setRequired(false);

  if (existingData?.preferredName !== null && existingData?.preferredName !== undefined && existingData.preferredName.length > 0) {
    nameInput.setValue(existingData.preferredName);
  }

  // Pronouns input
  const pronounsInput = new TextInputBuilder()
    .setCustomId('pronouns')
    .setLabel('Pronouns')
    .setPlaceholder('e.g., she/her, he/him, they/them')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(false);

  if (existingData?.pronouns !== null && existingData?.pronouns !== undefined && existingData.pronouns.length > 0) {
    pronounsInput.setValue(existingData.pronouns);
  }

  // Content input (longer text)
  const contentInput = new TextInputBuilder()
    .setCustomId('content')
    .setLabel(opts.contentLabel)
    .setPlaceholder(opts.contentPlaceholder)
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH)
    .setRequired(false);

  if (existingData?.content !== null && existingData?.content !== undefined && existingData.content.length > 0) {
    // Discord modals have a max length for pre-filled values - truncate if needed
    const truncatedContent =
      existingData.content.length > DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH
        ? existingData.content.substring(0, DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH)
        : existingData.content;
    contentInput.setValue(truncatedContent);
  }

  // Build action rows (one input per row for modals)
  return [
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(pronounsInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput),
  ];
}
