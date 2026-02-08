/**
 * UserReferencePatterns - Constants, regex patterns, and types for user reference resolution.
 *
 * Defines the three reference formats supported:
 * 1. @[username](user:shapes_uuid) - Shapes.inc markdown format
 * 2. <@discord_id> - Discord mention format
 * 3. @username - Simple username mention
 *
 * Extracted from UserReferenceResolver to reduce file size.
 */

import type { LoadedPersonality } from '@tzurot/common-types';

/**
 * Personality text fields that may contain user references and should be resolved.
 * These are the character definition fields that could have shapes.inc format mentions.
 */
export const RESOLVABLE_PERSONALITY_FIELDS: (keyof LoadedPersonality)[] = [
  'systemPrompt',
  'characterInfo',
  'personalityTraits',
  'personalityTone',
  'personalityAge',
  'personalityAppearance',
  'personalityLikes',
  'personalityDislikes',
  'conversationalGoals',
  'conversationalExamples',
];

/**
 * Type-safe helper to set a personality field value.
 * Isolates the type assertion needed for dynamic key access.
 */
export function setPersonalityField(
  personality: LoadedPersonality,
  key: keyof LoadedPersonality,
  value: string
): void {
  // Cast to Record for dynamic key assignment - safe since key is keyof LoadedPersonality
  (personality as Record<string, unknown>)[key] = value;
}

/**
 * Resolved persona info for a user reference
 */
export interface ResolvedPersona {
  /** Persona UUID */
  personaId: string;
  /** Display name (preferredName or name) */
  personaName: string;
  /** User's preferred name (may be null if not set) */
  preferredName: string | null;
  /** User's pronouns (may be null if not set) */
  pronouns: string | null;
  /** Persona content/description for participants section */
  content: string;
}

/**
 * Result of resolving user references in text
 */
export interface UserReferenceResolutionResult {
  /** Text with all user references replaced with persona names */
  processedText: string;
  /** Personas that were resolved (for adding to participants) */
  resolvedPersonas: ResolvedPersona[];
}

/**
 * Result of resolving user references across all personality fields
 */
export interface PersonalityResolutionResult {
  /** Personality with all text fields resolved */
  resolvedPersonality: LoadedPersonality;
  /** Deduplicated personas found across all fields (for adding to participants) */
  resolvedPersonas: ResolvedPersona[];
}

/**
 * Regex patterns for user reference formats
 *
 * Discord snowflake IDs are 17-20 digit integers (64-bit, introduced 2015).
 */
export const USER_REFERENCE_PATTERNS = {
  // @[username](user:uuid) - Shapes.inc markdown format
  // Captures: [1] = username, [2] = shapes_user_id (UUID)
  SHAPES_MARKDOWN: /@\[([^\]]+)\]\(user:([a-f0-9-]{36})\)/gi,

  // <@discord_id> - Discord mention format
  // Captures: [1] = discord_id (snowflake, 17-20 digits)
  DISCORD_MENTION: /<@!?(\d{17,20})>/g,

  // @username - Simple username mention (word boundary to avoid false positives)
  // Must not be followed by [ (which would make it shapes format)
  // Must not be preceded by < (which would make it discord format)
  // Captures: [1] = username
  SIMPLE_USERNAME: /(?<!<)@(\w+)(?!\[)/g,
};

/** Context for processing a single match */
export interface MatchContext {
  currentText: string;
  seenPersonaIds: Set<string>;
  resolvedPersonas: ResolvedPersona[];
  activePersonaId: string | undefined;
}

/** Result of processing a single match */
export interface MatchResult {
  updatedText: string;
  /** Persona to add to results (null if already seen, self-reference, or not found) */
  persona: ResolvedPersona | null;
  /** Persona ID to mark as seen (null if already seen or not found) */
  markAsSeen: string | null;
}

/** Options for processing a match */
export interface ProcessMatchOptions {
  ctx: MatchContext;
  fullMatch: string;
  persona: ResolvedPersona | null;
  logContext: Record<string, unknown>;
  refType: string;
  fallbackName?: string;
}
