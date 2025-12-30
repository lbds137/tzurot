/**
 * Personality Fields Formatter
 *
 * Formats personality character fields (traits, appearance, etc.) into XML sections.
 * Extracted from PromptBuilder for better modularity.
 */

import { escapeXmlContent, type LoadedPersonality } from '@tzurot/common-types';
import { replacePromptPlaceholders } from '../../utils/promptPlaceholders.js';

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
  const personaSections: string[] = [];

  // Each personality field gets its own XML tag
  // Tag names match database column names (snake_case) for consistency

  // Identity - who they are (display name or name)
  const displayName =
    personality.displayName !== undefined && personality.displayName.length > 0
      ? personality.displayName
      : personality.name;
  personaSections.push(`<display_name>${escapeXmlContent(displayName)}</display_name>`);

  // Character info (backstory, who they are)
  if (personality.characterInfo !== undefined && personality.characterInfo.length > 0) {
    personaSections.push(
      `<character_info>${escapeXmlContent(personality.characterInfo)}</character_info>`
    );
  }

  // Personality traits
  if (personality.personalityTraits !== undefined && personality.personalityTraits.length > 0) {
    personaSections.push(
      `<personality_traits>${escapeXmlContent(personality.personalityTraits)}</personality_traits>`
    );
  }

  // Tone/style
  if (personality.personalityTone !== undefined && personality.personalityTone.length > 0) {
    personaSections.push(
      `<personality_tone>${escapeXmlContent(personality.personalityTone)}</personality_tone>`
    );
  }

  // Age
  if (personality.personalityAge !== undefined && personality.personalityAge.length > 0) {
    personaSections.push(
      `<personality_age>${escapeXmlContent(personality.personalityAge)}</personality_age>`
    );
  }

  // Appearance
  if (
    personality.personalityAppearance !== undefined &&
    personality.personalityAppearance.length > 0
  ) {
    personaSections.push(
      `<personality_appearance>${escapeXmlContent(personality.personalityAppearance)}</personality_appearance>`
    );
  }

  // Likes
  if (personality.personalityLikes !== undefined && personality.personalityLikes.length > 0) {
    personaSections.push(
      `<personality_likes>${escapeXmlContent(personality.personalityLikes)}</personality_likes>`
    );
  }

  // Dislikes
  if (personality.personalityDislikes !== undefined && personality.personalityDislikes.length > 0) {
    personaSections.push(
      `<personality_dislikes>${escapeXmlContent(personality.personalityDislikes)}</personality_dislikes>`
    );
  }

  // Conversational goals
  if (personality.conversationalGoals !== undefined && personality.conversationalGoals.length > 0) {
    personaSections.push(
      `<conversational_goals>${escapeXmlContent(personality.conversationalGoals)}</conversational_goals>`
    );
  }

  // Conversational examples
  if (
    personality.conversationalExamples !== undefined &&
    personality.conversationalExamples.length > 0
  ) {
    personaSections.push(
      `<conversational_examples>${escapeXmlContent(personality.conversationalExamples)}</conversational_examples>`
    );
  }

  // Protocol is the systemPrompt (behavior rules/jailbreak)
  // Replace {user} and {assistant} placeholders with actual names
  // discordUsername enables disambiguation when user persona name matches personality name
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
