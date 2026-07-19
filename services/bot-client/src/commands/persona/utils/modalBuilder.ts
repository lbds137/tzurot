/**
 * Persona Modal Builder Utilities
 *
 * Shared field definitions for persona-create modals. Used by `/persona create`
 * and the create-new-persona-for-override flow, which render them through the
 * modal toolkit (`buildToolkitModal`). The edit/dashboard path uses the generic
 * ModalFactory instead.
 */

import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import type { TextModalField } from '../../../utils/modal/types.js';

/**
 * Existing persona data for pre-filling modal fields
 */
interface PersonaModalData {
  name?: string | null;
  description?: string | null;
  preferredName?: string | null;
  pronouns?: string | null;
  content?: string | null;
}

/**
 * Options for customizing modal field labels and placeholders
 */
interface PersonaModalOptions {
  /** Whether to include the persona name field (default: true) */
  includeNameField?: boolean;
  /** Custom placeholder for persona name */
  namePlaceholder?: string;
  /** Custom label for description field */
  descriptionLabel?: string;
  /** Custom placeholder for description field */
  descriptionPlaceholder?: string;
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
  descriptionLabel: 'Description (for your reference)',
  descriptionPlaceholder: 'A short note to help you remember this persona',
  preferredNamePlaceholder: 'What should AI call you?',
  preferredNameLabel: 'Preferred Name (what AI calls you)',
  contentLabel: 'About You',
  contentPlaceholder: 'Tell the AI about yourself: interests, personality, context...',
};

/** Pass through a prefill value, mapping the null/empty cases to "no prefill". */
function prefill(value: string | null | undefined): string | undefined {
  return value !== null && value !== undefined && value.length > 0 ? value : undefined;
}

/**
 * Build persona modal field definitions
 *
 * Creates standardized text fields for persona modals with optional pre-filling.
 * Ensures consistent field IDs across all persona-related modals. Prefill
 * truncation (content can exceed the modal cap) is the toolkit's job.
 *
 * @param existingData - Existing persona data to pre-fill (optional)
 * @param options - Customization options for labels/placeholders
 * @returns Toolkit text fields ready for `buildToolkitModal`
 */
export function buildPersonaModalFields(
  existingData?: PersonaModalData | null,
  options?: PersonaModalOptions
): TextModalField[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const fields: TextModalField[] = [];

  // Persona Name input (optional, but required when included)
  if (opts.includeNameField) {
    fields.push({
      kind: 'text',
      id: 'personaName',
      label: 'Persona Name',
      style: 'short',
      placeholder: opts.namePlaceholder,
      maxLength: 100,
      required: true,
      initialValue: prefill(existingData?.name),
    });
  }

  fields.push(
    {
      kind: 'text',
      id: 'description',
      label: opts.descriptionLabel,
      style: 'short',
      placeholder: opts.descriptionPlaceholder,
      maxLength: 255,
      required: false,
      initialValue: prefill(existingData?.description),
    },
    {
      kind: 'text',
      id: 'preferredName',
      label: opts.preferredNameLabel,
      style: 'short',
      placeholder: opts.preferredNamePlaceholder,
      maxLength: 255,
      required: false,
      initialValue: prefill(existingData?.preferredName),
    },
    {
      kind: 'text',
      id: 'pronouns',
      label: 'Pronouns',
      style: 'short',
      placeholder: 'e.g., she/her, he/him, they/them',
      maxLength: 100,
      required: false,
      initialValue: prefill(existingData?.pronouns),
    },
    // Content is required because PersonaCreateSchema validates `content`
    // with `.min(1, 'Content is required')`. Without this flag, Discord
    // would accept blank submissions and the gateway would reject them with
    // an opaque 400 instead of Discord's native field-level error.
    {
      kind: 'text',
      id: 'content',
      label: opts.contentLabel,
      style: 'paragraph',
      placeholder: opts.contentPlaceholder,
      maxLength: DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH,
      required: true,
      initialValue: prefill(existingData?.content),
    }
  );

  return fields;
}
