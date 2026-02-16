/**
 * Deterministic UUID Generation
 *
 * 🚨 CRITICAL: ALL database entities MUST use these generators, not Prisma's @default(uuid()).
 *
 * WHY: This project syncs data between dev and prod. Random UUIDs cause sync failures
 * because the same logical entity (e.g., user X's config for personality Y) gets
 * different IDs in each environment, violating unique constraints during sync.
 *
 * HOW: Each generator creates a v5 UUID from a deterministic seed based on the
 * entity's natural/business key (e.g., discordId for users, slug for personalities).
 *
 * WHEN ADDING NEW ENTITIES:
 * 1. Add a generator function here with a unique seed prefix
 * 2. Update CLAUDE.md's "Deterministic UUIDs Required" section
 * 3. Always pass the `id` field explicitly in Prisma create/upsert calls
 *
 * @see CLAUDE.md for the full list of generators and usage patterns
 */

import { v5 as uuidv5 } from 'uuid';
import crypto from 'crypto';

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
  const owner = ownerId !== undefined && ownerId.length > 0 ? ownerId : 'global';
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
 * Generate deterministic UUID for ChannelSettings
 * Seed: channel_settings:{channelId}
 * Note: channelId is unique per channel (not per channel+personality like old ActivatedChannel)
 */
export function generateChannelSettingsUuid(channelId: string): string {
  return uuidv5(`channel_settings:${channelId}`, TZUROT_NAMESPACE);
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

/**
 * Generate deterministic UUID for memory chunk groups
 * Seed: memory_chunk_group:{personaId}:{personalityId}:{contentHash}
 *
 * Used when splitting oversized memories into chunks for embedding.
 * The contentHash is a SHA-256 hash of the original text to ensure
 * retrying the same memory produces the same chunk group ID.
 */
export function generateMemoryChunkGroupUuid(
  personaId: string,
  personalityId: string,
  originalText: string
): string {
  // Create a SHA-256 hash of the content for deterministic, collision-resistant grouping
  const contentHash = crypto.createHash('sha256').update(originalText).digest('hex').slice(0, 32);
  return uuidv5(
    `memory_chunk_group:${personaId}:${personalityId}:${contentHash}`,
    TZUROT_NAMESPACE
  );
}

/**
 * Generate deterministic UUID for BotSetting
 * Seed: bot_setting:{key}
 */
export function generateBotSettingUuid(key: string): string {
  return uuidv5(`bot_setting:${key}`, TZUROT_NAMESPACE);
}

/**
 * Generate deterministic UUID for UserPersonaHistoryConfig
 * Seed: user_persona_history_config:{userId}:{personalityId}:{personaId}
 */
export function generateUserPersonaHistoryConfigUuid(
  userId: string,
  personalityId: string,
  personaId: string
): string {
  return uuidv5(
    `user_persona_history_config:${userId}:${personalityId}:${personaId}`,
    TZUROT_NAMESPACE
  );
}

/**
 * Generate deterministic UUID for ImageDescriptionCache
 * Seed: image_description_cache:{attachmentId}
 *
 * The attachmentId is the Discord snowflake ID which is already stable/deterministic.
 * This generator ensures the primary key is also deterministic for sync purposes.
 */
export function generateImageDescriptionCacheUuid(attachmentId: string): string {
  return uuidv5(`image_description_cache:${attachmentId}`, TZUROT_NAMESPACE);
}

/**
 * Generate deterministic UUID for UsageLog
 * Seed: usage_log:{userId}:{model}:{timestamp}
 *
 * Usage logs are time-series data. The timestamp ensures uniqueness while
 * keeping the same request reproducible if retried within the same millisecond.
 */
export function generateUsageLogUuid(userId: string, model: string, createdAt: Date): string {
  const timestamp = createdAt.getTime();
  return uuidv5(`usage_log:${userId}:${model}:${timestamp}`, TZUROT_NAMESPACE);
}

/**
 * Generate deterministic UUID for PendingMemory
 * Seed: pending_memory:{personaId}:{personalityId}:{contentHash}
 *
 * Pending memories are a safety net before vector storage. Using content hash
 * ensures the same memory text produces the same UUID if retried.
 */
export function generatePendingMemoryUuid(
  personaId: string,
  personalityId: string,
  text: string
): string {
  const contentHash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
  return uuidv5(`pending_memory:${personaId}:${personalityId}:${contentHash}`, TZUROT_NAMESPACE);
}

/**
 * Generate deterministic UUID for UserApiKey
 * Seed: user_api_key:{userId}:{provider}
 *
 * User API keys are unique per user+provider combination.
 */
export function generateUserApiKeyUuid(userId: string, provider: string): string {
  return uuidv5(`user_api_key:${userId}:${provider}`, TZUROT_NAMESPACE);
}

/**
 * Generate deterministic UUID for UserCredential
 * Seed: user_credential:{userId}:{service}:{credentialType}
 *
 * User credentials are unique per user+service+type combination.
 */
export function generateUserCredentialUuid(
  userId: string,
  service: string,
  credentialType: string
): string {
  return uuidv5(`user_credential:${userId}:${service}:${credentialType}`, TZUROT_NAMESPACE);
}

/**
 * Generate deterministic UUID for ImportJob
 * Seed: import_job:{userId}:{sourceSlug}:{sourceService}
 *
 * Import jobs are unique per user+source slug+service combination.
 */
export function generateImportJobUuid(
  userId: string,
  sourceSlug: string,
  sourceService: string
): string {
  return uuidv5(`import_job:${userId}:${sourceSlug}:${sourceService}`, TZUROT_NAMESPACE);
}

/**
 * UUID v4 format regex pattern
 * Matches standard UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Check if a string is in valid UUID format
 * Used to distinguish between UUID and name/slug in lookup scenarios
 */
export function isUuidFormat(value: string): boolean {
  return UUID_REGEX.test(value);
}
