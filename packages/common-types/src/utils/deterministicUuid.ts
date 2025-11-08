/**
 * Deterministic UUID Generation
 *
 * Ensures all entities have consistent UUIDs across dev/staging/prod environments.
 * Uses UUID v5 with entity-specific namespaces and seed patterns.
 */

import { v5 as uuidv5 } from 'uuid';

// Master namespace for all Tzurot UUIDs
// CRITICAL: Never change this or all IDs will change!
const TZUROT_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // Standard DNS namespace

/**
 * Generate deterministic UUID for a User
 * Seed: discord:{discordId}
 */
export function generateUserUuid(discordId: string): string {
  return uuidv5(`discord:${discordId}`, TZUROT_NAMESPACE);
}

/**
 * Generate deterministic UUID for a Personality
 * Seed: personality:{slug}
 */
export function generatePersonalityUuid(slug: string): string {
  return uuidv5(`personality:${slug}`, TZUROT_NAMESPACE);
}

/**
 * Generate deterministic UUID for a Persona
 * Seed: persona:{ownerId || 'global'}:{name}
 */
export function generatePersonaUuid(name: string, ownerId?: string): string {
  const owner = ownerId || 'global';
  return uuidv5(`persona:${owner}:${name}`, TZUROT_NAMESPACE);
}

/**
 * Generate deterministic UUID for a SystemPrompt
 * Seed: system_prompt:{name}
 */
export function generateSystemPromptUuid(name: string): string {
  return uuidv5(`system_prompt:${name}`, TZUROT_NAMESPACE);
}

/**
 * Generate deterministic UUID for an LlmConfig
 * Seed: llm_config:{name}
 */
export function generateLlmConfigUuid(name: string): string {
  return uuidv5(`llm_config:${name}`, TZUROT_NAMESPACE);
}

/**
 * Generate deterministic UUID for UserPersonalityConfig
 * Seed: user_personality_settings:{userId}:{personalityId}
 * Note: Seed pattern kept as 'user_personality_settings' for UUID consistency (renamed from UserPersonalitySettings)
 */
export function generateUserPersonalityConfigUuid(userId: string, personalityId: string): string {
  return uuidv5(`user_personality_settings:${userId}:${personalityId}`, TZUROT_NAMESPACE);
}

/**
 * Generate deterministic UUID for ConversationHistory
 * Seed: conversation_history:{channelId}:{personalityId}:{userId}:{timestamp}
 */
export function generateConversationHistoryUuid(
  channelId: string,
  personalityId: string,
  userId: string,
  createdAt: Date
): string {
  const timestamp = createdAt.getTime();
  return uuidv5(
    `conversation_history:${channelId}:${personalityId}:${userId}:${timestamp}`,
    TZUROT_NAMESPACE
  );
}

/**
 * Generate deterministic UUID for ActivatedChannel
 * Seed: activated_channel:{channelId}:{personalityId}
 */
export function generateActivatedChannelUuid(channelId: string, personalityId: string): string {
  return uuidv5(`activated_channel:${channelId}:${personalityId}`, TZUROT_NAMESPACE);
}

/**
 * Generate deterministic UUID for memory point duplication
 * Seed: {originalPointId}:{userId}
 * (Used when duplicating memories for multi-sender conversations)
 */
export function generateMemoryDuplicateUuid(originalPointId: string, userId: string): string {
  // Use a different namespace for memory duplicates to avoid collisions
  const MEMORY_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c9';
  return uuidv5(`${originalPointId}:${userId}`, MEMORY_NAMESPACE);
}
