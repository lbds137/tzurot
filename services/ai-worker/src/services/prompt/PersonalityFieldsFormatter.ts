/**
 * Personality Fields Formatter
 *
 * Formats personality character fields (traits, appearance, etc.) into XML sections.
 * Extracted from PromptBuilder for better modularity.
 */

import { escapeXmlContent, type LoadedPersonality } from '@tzurot/common-types';
import { replacePromptPlaceholders } from '../../utils/promptPlaceholders.js';

/** Field definition for personality XML formatting */
interface FieldDef {
  key: keyof LoadedPersonality;
  tag: string;
}

/** Personality fields to format as XML sections (in order) */
const PERSONALITY_FIELDS: FieldDef[] = [
  { key: 'characterInfo', tag: 'character_info' },
  { key: 'personalityTraits', tag: 'personality_traits' },
  { key: 'personalityTone', tag: 'personality_tone' },
  { key: 'personalityAge', tag: 'personality_age' },
  { key: 'personalityAppearance', tag: 'personality_appearance' },
  { key: 'personalityLikes', tag: 'personality_likes' },
  { key: 'personalityDislikes', tag: 'personality_dislikes' },
  { key: 'conversationalGoals', tag: 'conversational_goals' },
  { key: 'conversationalExamples', tag: 'conversational_examples' },
];

/**
 * Format a single personality field as XML if it has content
 */
function formatField(personality: LoadedPersonality, field: FieldDef): string | null {
  const value = personality[field.key];
  if (typeof value === 'string' && value.length > 0) {
    return `<${field.tag}>${escapeXmlContent(value)}</${field.tag}>`;
  }
  return null;
}

/**
 * Build persona and protocol sections from personality character fields.
 *
 * Returns separate persona and protocol sections:
 * - persona: Identity, character info, traits, etc. (who you are)
 * - protocol: Behavior rules from systemPrompt (how to respond)
 *
 * This separation enables U-shaped attention optimization:
 * persona goes at the START, protocol goes at the END of the full prompt.
 */
export function formatPersonalityFields(
  personality: LoadedPersonality,
  userName: string,
  assistantName: string,
  discordUsername?: string
): { persona: string; protocol: string } {
  // Identity - who they are (display name or name)
  const displayName =
    personality.displayName !== undefined && personality.displayName.length > 0
      ? personality.displayName
      : personality.name;

  // Build persona sections from all defined fields
  const personaSections: string[] = [
    `<display_name>${escapeXmlContent(displayName)}</display_name>`,
  ];

  for (const field of PERSONALITY_FIELDS) {
    const formatted = formatField(personality, field);
    if (formatted !== null) {
      personaSections.push(formatted);
    }
  }

  // Protocol is the systemPrompt (behavior rules/jailbreak)
  // Replace {user} and {assistant} placeholders with actual names
  let protocol = '';
  if (personality.systemPrompt !== undefined && personality.systemPrompt.length > 0) {
    protocol = replacePromptPlaceholders(
      personality.systemPrompt,
      userName,
      assistantName,
      discordUsername
    );
  }

  return {
    persona: personaSections.join('\n'),
    protocol,
  };
}
