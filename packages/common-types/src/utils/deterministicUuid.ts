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

import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';
import crypto from 'crypto';

/**
 * Standard DNS namespace UUID (RFC 4122).
 * Used as the base namespace for all Tzurot deterministic UUIDs.
 * CRITICAL: Never change this or all IDs will change!
 */
export const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

// Local alias for readability in existing code
const TZUROT_NAMESPACE = DNS_NAMESPACE;

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
/**
 * Generate deterministic UUID for a PersonalityAlias.
 * Seeded from the lowercased alias alone — aliases are globally unique, so
 * the same alias independently created in both environments converges to one
 * row id under db-sync (the memory_facts content-hash pattern).
 */
export function generatePersonalityAliasUuid(alias: string): string {
  return uuidv5(`personality-alias:${alias.toLowerCase()}`, TZUROT_NAMESPACE);
}

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
 *
 * @deprecated Deriving LlmConfig IDs from a user-editable name caused phantom
 * PK collisions when users cloned → renamed → re-cloned (bug observed
 * 2026-04-19). Prod LlmConfig creates now use {@link newLlmConfigId} (UUIDv7)
 * with DB-level `@@unique([ownerId, name])` enforcing name uniqueness via a
 * proper constraint instead of indirectly via the PK. This function is
 * retained for test fixtures that seed rows with stable IDs; do NOT add new
 * production callers.
 */
export function generateLlmConfigUuid(name: string): string {
  return uuidv5(`llm_config:${name}`, TZUROT_NAMESPACE);
}

/**
 * Generate a time-ordered random UUID (UUIDv7) for a new LlmConfig row.
 *
 * Replaces {@link generateLlmConfigUuid} in the production create path. Time
 * ordering gives natural chronological sort without needing a separate
 * `createdAt` index for most queries, and random tail bytes guarantee
 * uniqueness without any dependency on user-editable fields — which was the
 * root cause of the 2026-04-19 clone-after-rename phantom-PK bug.
 */
export function newLlmConfigId(): string {
  return uuidv7();
}

/**
 * Generate a time-ordered random UUID (UUIDv7) for a new TtsConfig row.
 *
 * Mirrors {@link newLlmConfigId} — both config types use UUIDv7 for the same
 * reasons: chronological sort by id, no dependency on user-editable fields
 * for the PK. DB-level `@@unique([ownerId, name])` enforces the ergonomic
 * "user can't have two configs with the same name" constraint independently.
 */
export function newTtsConfigId(): string {
  return uuidv7();
}

/**
 * Deterministic UUID for a system-global TtsConfig row.
 *
 * Used by both the migration seed (paste-in literal computed via this helper)
 * and `TtsConfigService.bootstrapSystemGlobalsIfNeeded` so dev and prod always
 * assign the same UUID for the same well-known name. Without this, `/admin
 * db-sync` fails with `tts_configs_owner_id_name_key` collisions because each
 * env independently generated random UUIDs for the same logical row.
 *
 * Scoped to system-globals only (names are code-defined, stable, never
 * renamed by users). Do NOT use for user-created configs — see
 * {@link generateLlmConfigUuid}'s deprecation notice for the rename-collision
 * rationale that drove user-created configs to UUIDv7.
 */
export function generateSystemGlobalTtsConfigUuid(name: string): string {
  return uuidv5(`tts_config_global:${name}`, TZUROT_NAMESPACE);
}

/**
 * Deterministic UUID for a system-global LlmConfig row.
 *
 * Mirrors {@link generateSystemGlobalTtsConfigUuid}. Used by `VisionConfigBootstrap`
 * to seed the vision system globals (LlmConfig rows) with stable IDs,
 * so dev and prod assign the same UUID for the same well-known name. Without this,
 * `/admin db-sync` fails with `llm_configs_owner_id_name_key` collisions because each
 * env would generate its own random UUID for the same logical row.
 *
 * Scoped to system-globals only (names are code-defined, stable, never renamed by
 * users). Do NOT use for user-created configs — see {@link generateLlmConfigUuid}'s
 * deprecation notice for the rename-collision rationale that drove user-created configs
 * to UUIDv7. A pinned-value test in `deterministicUuid.test.ts` asserts the exact UUIDs
 * for the seeded names; that cross-pinning (helper test + bootstrap) prevents drift — if
 * rows already exist in any env with non-deterministic IDs, write a recovery migration
 * mirroring `20260504140720_align_tts_globals_to_deterministic_ids`.
 */
export function generateSystemGlobalLlmConfigUuid(name: string): string {
  return uuidv5(`llm_config_global:${name}`, TZUROT_NAMESPACE);
}

/**
 * Set of TTS providers eligible for migration-seeded BYOK rows. Narrowed
 * from `string` to catch typos like `'eleven_labs'` at the call site
 * instead of producing an unrecoverable UUID for a never-existed config.
 * Add to the union when a new BYOK provider lands.
 */
export type ByokTtsProvider = 'elevenlabs' | 'mistral';

/**
 * Deterministic UUID for a per-user BYOK-style TtsConfig row.
 *
 * Aligns `tts-byok-*` rows (created by migration 20260502185237's
 * one-shot data seed for users with legacy `elevenlabsTtsModel` JSONB)
 * to deterministic UUIDs. Without this helper, dev and prod each generate
 * their own random UUIDs for the same logical row → /admin db-sync
 * collision on the `tts_configs_owner_id_name_key` composite-unique
 * constraint.
 *
 * Scoped to migration-seeded BYOK rows. Do NOT use for user-created configs
 * via `/settings tts create` — those have user-editable names and should
 * keep UUIDv7 to avoid the rename-collision bug documented on
 * {@link generateLlmConfigUuid}'s `@deprecated` notice.
 *
 * Why `(ownerId, provider)` not `(ownerId, name)`: name is mutable (the
 * UPDATE route at `services/api-gateway/src/routes/user/tts-config.ts` has
 * no guard preventing rename of `tts-byok-*` rows). Provider is fixed for
 * the row's lifetime.
 */
export function generateByokTtsConfigUuid(ownerId: string, provider: ByokTtsProvider): string {
  return uuidv5(`tts_config_byok:${ownerId}:${provider}`, TZUROT_NAMESPACE);
}

/**
 * Set of LLM providers eligible for migration-seeded BYOK rows. Mirrors
 * {@link ByokTtsProvider} for the LLM side. The union has only one
 * member today because OpenRouter is the sole BYOK LLM provider; adding
 * z.ai or anthropic-direct as future BYOK providers means widening this
 * union and updating the helper's deterministic-UUID coverage tests.
 */
export type ByokLlmProvider = 'openrouter';

/**
 * Deterministic UUID for a per-user BYOK-style LlmConfig row.
 *
 * Mirrors {@link generateByokTtsConfigUuid}. Currently unused — LLM has no
 * equivalent BYOK auto-migration today. Exported for symmetry and to
 * reserve the namespace for future use.
 *
 * **Knip note**: same as {@link generateSystemGlobalLlmConfigUuid} — no
 * production callers by design. The pinned-value test in
 * `deterministicUuid.test.ts` plus the barrel `export *` from common-types
 * keep this reachable. If a future knip configuration starts flagging
 * future-reserved exports, suppress with a `knip-ignore` directive
 * pointing at this JSDoc rather than removing the helper.
 */
export function generateByokLlmConfigUuid(ownerId: string, provider: ByokLlmProvider): string {
  return uuidv5(`llm_config_byok:${ownerId}:${provider}`, TZUROT_NAMESPACE);
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
 * Generate deterministic UUID for a MemoryFact row (memory Phase 2)
 * Seed: memory_fact:{personalityId}:{personaId|world}:{statementHash}
 *
 * Content-hash dedup: re-extracting an identical statement in the same scope
 * produces the same id, so a retried batch can't write exact duplicates.
 */
export function generateMemoryFactUuid(
  personalityId: string,
  personaId: string | null,
  statement: string
): string {
  const statementHash = crypto.createHash('sha256').update(statement).digest('hex').slice(0, 32);
  return uuidv5(
    `memory_fact:${personalityId}:${personaId ?? 'world'}:${statementHash}`,
    TZUROT_NAMESPACE
  );
}

/**
 * Generate deterministic UUID for a fact-extraction BullMQ job (memory Phase 2)
 * Seed: fact_extraction:{channelId}:{personalityId}:{windowStartMemoryId}
 *
 * The window-start episode id anchors the batch: a crash between enqueue and
 * counter-reset re-enqueues the SAME job id, which BullMQ dedups — the trigger
 * is idempotent by construction.
 */
export function generateFactExtractionJobUuid(
  channelId: string,
  personalityId: string,
  windowStartMemoryId: string
): string {
  return uuidv5(
    `fact_extraction:${channelId}:${personalityId}:${windowStartMemoryId}`,
    TZUROT_NAMESPACE
  );
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
 * Generate deterministic UUID for ReleaseAnnouncement
 * Seed: release_announcement:{version}
 *
 * Version is the table's natural unique key — a webhook retry or a
 * double-triggered broadcast for the same version derives the same id.
 */
export function generateReleaseAnnouncementUuid(version: string): string {
  return uuidv5(`release_announcement:${version}`, TZUROT_NAMESPACE);
}

/**
 * Generate deterministic UUID for ReleaseDeliveryLog
 * Seed: release_delivery_log:{releaseId}:{userId}
 *
 * Mirrors the table's @@unique([releaseId, userId]) — re-resolving the same
 * blast's recipients derives the same row ids (createMany skipDuplicates
 * makes the enqueue path idempotent by construction).
 */
export function generateReleaseDeliveryLogUuid(releaseId: string, userId: string): string {
  return uuidv5(`release_delivery_log:${releaseId}:${userId}`, TZUROT_NAMESPACE);
}

/**
 * Generate deterministic UUID for a UserFeedback row.
 * Seed: user_feedback:{userId}:{contentHash}:{submittedAtIso}
 *
 * The timestamp component keeps legitimate re-submissions of the same
 * content (after the dedupe window expires) unique; within the window the
 * intake gate rejects the duplicate before an id is ever minted.
 */
export function generateUserFeedbackUuid(
  userId: string,
  contentHash: string,
  submittedAtIso: string
): string {
  return uuidv5(`user_feedback:${userId}:${contentHash}:${submittedAtIso}`, TZUROT_NAMESPACE);
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
 * Generate deterministic UUID for ExportJob
 * Seed: export_job:{userId}:{sourceSlug}:{sourceService}:{format}
 *
 * Export jobs are unique per user+source slug+service+format combination.
 * Re-exports for the same shape AND format overwrite the previous ExportJob record.
 * Different formats (json vs markdown) get distinct UUIDs and can run concurrently.
 */
export function generateExportJobUuid(
  userId: string,
  sourceSlug: string,
  sourceService: string,
  format: string
): string {
  return uuidv5(`export_job:${userId}:${sourceSlug}:${sourceService}:${format}`, TZUROT_NAMESPACE);
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
