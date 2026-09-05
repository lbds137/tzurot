/**
 * Voice Anchor Formatter
 *
 * Formats the `<voice_anchor>` V-tier block: a restatement of the character's
 * card register (traits / tone / conversational examples) nearest the
 * generation point. It renders LAST in the volatile prefix, right before the
 * live user turn.
 *
 * The duplication with the system prompt's copies of these same fields
 * (`PersonalityFieldsFormatter`) is deliberate — the V tier is uncached every
 * turn, so re-stating the register here is cache-neutral, and proximity to
 * the generation point counters voice drift accumulated over a long chat_log.
 */

import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { escapeXmlContent } from '@tzurot/common-types/utils/promptSanitizer';
import {
  PERSONALITY_FIELDS,
  formatField,
  resolveDisplayName,
} from './PersonalityFieldsFormatter.js';

/** The three fields re-stated in the voice anchor, in card order. */
const VOICE_ANCHOR_FIELD_KEYS = [
  'personalityTraits',
  'personalityTone',
  'conversationalExamples',
] as const;

/**
 * Lead-in sentence for the `<voice_anchor>` block. Takes the ALREADY-ESCAPED
 * display name — {@link formatVoiceAnchor} escapes it once and passes it in
 * here and to {@link voiceAnchorDriftNote}.
 */
export function voiceAnchorLeadIn(name: string): string {
  return `This is who ${name} is right now. It outranks every earlier turn above it.`;
}

/**
 * Drift-warning sentence for the `<voice_anchor>` block, naming pet names,
 * running metaphors, sign-offs, and habitual structure the conversation
 * history may have accumulated but the card fields above do not describe.
 * Takes the ALREADY-ESCAPED display name (see {@link voiceAnchorLeadIn}).
 */
export function voiceAnchorDriftNote(name: string): string {
  return (
    `The conversation above and the memory archive record what ${name} said and did, not how ` +
    `${name} sounds now. Pet names, running metaphors, sign-offs, and habitual structure that ` +
    `appear in that history but not in the fields above are drift: do not carry them forward. ` +
    `Match the register, energy, and reply length these fields describe.`
  );
}

/**
 * Format the `<voice_anchor>` block, or `''` when none of the three fields
 * (traits/tone/conversational examples) render. Individually empty/absent
 * fields are omitted (no empty tags).
 */
export function formatVoiceAnchor(personality: LoadedPersonality): string {
  const fields = PERSONALITY_FIELDS.filter(field =>
    VOICE_ANCHOR_FIELD_KEYS.some(key => key === field.key)
  )
    .map(field => formatField(personality, field))
    .filter((rendered): rendered is string => rendered !== null);

  if (fields.length === 0) {
    return '';
  }

  const name = escapeXmlContent(resolveDisplayName(personality));

  return [
    '<voice_anchor>',
    voiceAnchorLeadIn(name),
    ...fields,
    voiceAnchorDriftNote(name),
    '</voice_anchor>',
  ].join('\n');
}
