/**
 * Truncation Gate primitives — entity-agnostic detection + display building
 * blocks for the "warn before silent truncate" UX. Entity-specific button
 * handlers live alongside their entity-specific data resolvers (see
 * `commands/character/truncationWarning.ts` and
 * `commands/persona/truncationWarning.ts`).
 */

export { detectOverLengthFields, type OverLengthField } from './detection.js';
export {
  buildTruncationWarningEmbed,
  buildReadyToEditEmbed,
  stripLeadingEmoji,
  toSafeFilename,
} from './embeds.js';
export { buildTruncationButtons, buildOpenEditorButtonRow } from './buttons.js';
