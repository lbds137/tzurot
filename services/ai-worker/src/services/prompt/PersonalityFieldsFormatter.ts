/**
 * Personality Fields Formatter
 *
 * Formats personality character fields (traits, appearance, etc.) into XML sections.
 * Extracted from PromptBuilder for better modularity.
 *
 * Supports two systemPrompt formats:
 * 1. JSON format (new): { permissions: [], characterDirectives: [], formattingRules: [] }
 * 2. Legacy XML format: Raw XML string passed through after placeholder replacement
 */

import { createLogger, escapeXmlContent, type LoadedPersonality } from '@tzurot/common-types';
import { replacePromptPlaceholders } from '../../utils/promptPlaceholders.js';

const logger = createLogger('PersonalityFieldsFormatter');

/**
 * JSON structure for protocol content stored in database.
 * JSON is preferred over XML in database to prevent prompt injection via XML tag breaking.
 */
interface ProtocolContent {
  permissions: string[];
  characterDirectives: string[];
  formattingRules: string[];
}

/**
 * Try to parse systemPrompt as JSON protocol content.
 * Returns null if the content is not valid JSON or doesn't match the expected schema.
 */
function parseProtocolJson(raw: string): ProtocolContent | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    // Validate structure
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;

    // Check that required fields are arrays of strings
    const permissions = obj.permissions;
    const characterDirectives = obj.characterDirectives;
    const formattingRules = obj.formattingRules;

    if (!Array.isArray(permissions) || !permissions.every(p => typeof p === 'string')) {
      return null;
    }
    if (
      !Array.isArray(characterDirectives) ||
      !characterDirectives.every(d => typeof d === 'string')
    ) {
      return null;
    }
    if (!Array.isArray(formattingRules) || !formattingRules.every(r => typeof r === 'string')) {
      return null;
    }

    return {
      permissions: permissions,
      characterDirectives: characterDirectives,
      formattingRules: formattingRules,
    };
  } catch {
    // Not valid JSON - this is expected for legacy XML format
    return null;
  }
}

/**
 * Format JSON protocol content as XML sections.
 * Escapes all content to prevent prompt injection.
 */
function formatProtocolAsXml(content: ProtocolContent): string {
  const sections: string[] = [];

  if (content.permissions.length > 0) {
    const items = content.permissions.map(p => `<permitted>${escapeXmlContent(p)}</permitted>`);
    sections.push(`<permissions>\n${items.join('\n')}\n</permissions>`);
  }

  if (content.characterDirectives.length > 0) {
    const items = content.characterDirectives.map(
      d => `<directive>${escapeXmlContent(d)}</directive>`
    );
    sections.push(`<character_directives>\n${items.join('\n')}\n</character_directives>`);
  }

  if (content.formattingRules.length > 0) {
    const items = content.formattingRules.map(r => `<rule>${escapeXmlContent(r)}</rule>`);
    sections.push(`<formatting_rules>\n${items.join('\n')}\n</formatting_rules>`);
  }

  return sections.join('\n\n');
}

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

  // Protocol is the systemPrompt (behavior rules)
  // Try JSON format first (new), fall back to legacy XML string
  let protocol = '';
  if (personality.systemPrompt !== undefined && personality.systemPrompt.length > 0) {
    const jsonContent = parseProtocolJson(personality.systemPrompt);

    if (jsonContent !== null) {
      // New JSON format - convert to XML
      protocol = formatProtocolAsXml(jsonContent);
      logger.debug('Parsed systemPrompt as JSON protocol format');
    } else {
      // Legacy XML format - pass through with placeholder replacement
      protocol = replacePromptPlaceholders(
        personality.systemPrompt,
        userName,
        assistantName,
        discordUsername
      );
      logger.debug('Using legacy XML systemPrompt format');
    }
  }

  return {
    persona: personaSections.join('\n'),
    protocol,
  };
}
