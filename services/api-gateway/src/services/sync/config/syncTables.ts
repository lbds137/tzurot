/**
 * Sync Table Configurations
 *
 * Defines which tables to sync and their metadata for bidirectional sync.
 * NOTE: Column names must match database schema (snake_case), not Prisma model fields (camelCase)
 *
 * IMPORTANT: Tables must be synced in an order that respects foreign key constraints.
 * Use SYNC_TABLE_ORDER for iteration, not Object.keys(SYNC_CONFIG).
 */

/**
 * Tables explicitly excluded from sync with reasons.
 * These are documented exclusions that won't generate warnings during validation.
 * Only tables not in SYNC_CONFIG AND not in EXCLUDED_TABLES will trigger warnings.
 */
export const EXCLUDED_TABLES: Record<string, string> = {
  // Environment-specific data
  admin_settings: 'Environment-specific admin configuration (different per bot instance)',
  channel_settings: 'Environment-specific channel activations (different bot instances)',
  user_api_keys: 'User API keys should not sync between environments (security)',

  // Settings tables - user preferences that may differ between dev/prod
  personality_default_configs:
    'Character-level LLM preset defaults - dev/prod may use different models for testing',
  personality_default_tts_configs:
    'Character-level TTS preset defaults - dev/prod may use different voices for testing (mirrors personality_default_configs)',
  personality_vision_default_configs:
    'Character-level vision preset defaults - dev/prod may use different vision models for testing (mirrors personality_default_configs/tts)',

  // Transient/ephemeral data
  pending_memories: 'Transient queue data for memory processing',
  llm_diagnostic_logs: 'Ephemeral debug logs (auto-deleted after 24h)',
  usage_logs: 'Environment-specific usage tracking',
  import_jobs: 'Transient import job tracking (environment-specific, retryable)',
  export_jobs: 'Transient export job tracking (environment-specific, retryable)',
  job_results:
    'Transient per-job delivery state (PENDING_DELIVERY/DELIVERED, auto-cleaned) — environment-specific, never synced',

  // Release-notes delivery state (environment-specific: each environment
  // announces its own releases to its own users; syncing would double-blast
  // or mark prod releases as already-announced in dev)
  release_announcements: 'Environment-specific release-announcement state',
  release_delivery_log: 'Environment-specific per-user delivery outcomes',
  user_feedback: 'Owner-triage operational data; each environment keeps its own feedback',

  // Moderation data
  denylisted_entities: 'Environment-specific denylist (different moderation per bot instance)',

  // Security-sensitive data
  user_credentials: 'Encrypted session cookies for external services (security-sensitive)',

  // Operational state
  secret_rotations:
    'Environment-local secret-rotation ledger — each env rotates (and nags) on its own clock',
};

export interface TableSyncConfig {
  pk: string | string[]; // Primary key field(s)
  createdAt?: string; // Creation timestamp field (if exists)
  updatedAt?: string; // Update timestamp field (if exists)
  uuidColumns: string[]; // Columns that contain UUIDs (for validation)
  timestampColumns: string[]; // Columns that contain timestamps (for validation)
  /**
   * Columns to completely exclude from sync.
   * These columns are not copied between environments, allowing dev and prod to have
   * different values. Useful for environment-specific settings like default flags.
   *
   * Example: tts_configs.is_default should be different in dev vs prod
   */
  excludeColumns?: string[];
  // NOTE: `deferredFkColumns` was removed in the Ouroboros Insert refactor.
  // Circular NOT NULL FKs (users↔personas, users↔llm_configs) are now
  // handled via `SET CONSTRAINTS ALL DEFERRED` at the DatabaseSyncService
  // transaction boundary. Real FK values insert from the start; Postgres
  // validates them at COMMIT when all circular rows exist.
}

export type SyncTableName =
  | 'sync_tombstones'
  | 'users'
  | 'personas'
  | 'system_prompts'
  | 'llm_configs'
  | 'tts_configs'
  | 'personalities'
  // NOTE: personality_default_configs moved to EXCLUDED_TABLES - settings, not raw data
  // NOTE: personality_default_tts_configs same — environment-specific TTS preset defaults
  | 'personality_owners'
  | 'personality_aliases'
  | 'user_personality_configs'
  | 'user_persona_history_configs'
  | 'conversation_history'
  | 'conversation_history_tombstones'
  // NOTE: activated_channels intentionally NOT synced - dev/prod have different bot instances
  // and syncing would cause double-responses in channels where both bots are present
  | 'memories'
  | 'memory_facts'
  | 'shapes_persona_mappings';

/**
 * Tables to sync with their primary key field(s), timestamp fields, and UUID columns
 */
export const SYNC_CONFIG: Record<SyncTableName, TableSyncConfig> = {
  sync_tombstones: {
    // The generalized deletion ledger (trigger-written — see migration
    // 20260710230428). Synced FIRST so both sides converge on the same
    // deletion knowledge before any table's rows are classified; the
    // trigger's ON CONFLICT keeps the LATEST deleted_at, and last-write-wins
    // on deleted_at resolves cross-env divergence the same way.
    pk: ['table_name', 'row_pk'],
    createdAt: 'deleted_at',
    uuidColumns: [],
    timestampColumns: ['deleted_at'],
  },
  users: {
    pk: 'id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    uuidColumns: [
      'id',
      'default_llm_config_id',
      'default_persona_id',
      'default_tts_config_id',
      'default_vision_config_id',
    ],
    timestampColumns: ['created_at', 'updated_at'],
    // Four FK columns on users reference rows in tables that come AFTER
    // users in SYNC_TABLE_ORDER (personas, llm_configs, tts_configs are
    // all synced after users so their owner_id NOT-NULL FKs back to users
    // can be satisfied). All four FKs are made DEFERRABLE so the sync
    // transaction can issue SET CONSTRAINTS … DEFERRED and let Postgres
    // validate the references at COMMIT time, when every cross-table
    // referenced row exists:
    //   - default_persona_id (NOT NULL), default_llm_config_id (nullable):
    //     DEFERRABLE since migration 20260418010642 (the original circular-FK fix).
    //   - default_tts_config_id (nullable): DEFERRABLE since migration
    //     20260504065151 (added when the TTS feature shipped).
    //   - default_vision_config_id (nullable, → llm_configs row):
    //     DEFERRABLE since migration 20260627040007 (the vision_config_kind migration).
    // Nullability is orthogonal to DEFERRABLE: deferral controls *when* the FK
    // reference is validated (at COMMIT, after the referenced row is synced),
    // not whether the column may be NULL. A non-NULL FK still needs deferral
    // here because its target row is inserted later in SYNC_TABLE_ORDER; a
    // nullable column simply skips the check when its value is NULL.
    // Last-write-wins on users.updated_at resolves cross-env conflicts.
  },
  personas: {
    pk: 'id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    uuidColumns: ['id', 'owner_id'],
    timestampColumns: ['created_at', 'updated_at'],
  },
  system_prompts: {
    pk: 'id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    uuidColumns: ['id'],
    timestampColumns: ['created_at', 'updated_at'],
  },
  llm_configs: {
    pk: 'id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    uuidColumns: ['id', 'owner_id'],
    timestampColumns: ['created_at', 'updated_at'],
  },
  tts_configs: {
    pk: 'id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    uuidColumns: ['id', 'owner_id'],
    timestampColumns: ['created_at', 'updated_at'],
    // The stale is_default/is_free_default columns (pending their own DROP,
    // mirroring the llm_configs retirement) stay excluded so the partial
    // unique index tts_configs_free_default_unique can never collide during
    // sync. TTS default-ness lives on the AdminSettings pointers, and
    // admin_settings is excluded from sync (env-specific) — so no singleton
    // pre-resolution is needed.
    excludeColumns: ['is_default', 'is_free_default'],
  },
  personalities: {
    pk: 'id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    uuidColumns: ['id', 'system_prompt_id', 'owner_id'],
    timestampColumns: ['created_at', 'updated_at'],
  },
  // NOTE: personality_default_configs moved to EXCLUDED_TABLES - settings table, not raw data
  personality_owners: {
    // Composite key — ORDER IS FROZEN: the sync_tombstone_personality_owners
    // trigger's TG_ARGV (migration 20260710230428) joins OLD values in this
    // exact order to build row_pk; reordering here silently mismatches every
    // tombstone key. validateTombstoneTriggers enforces the parity at sync time.
    pk: ['personality_id', 'user_id'],
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    uuidColumns: ['personality_id', 'user_id'],
    timestampColumns: ['created_at', 'updated_at'],
  },
  personality_aliases: {
    pk: 'id',
    createdAt: 'created_at',
    // No updatedAt - aliases are immutable
    uuidColumns: ['id', 'personality_id', 'user_id'],
    timestampColumns: ['created_at'],
  },
  user_personality_configs: {
    // Use composite unique key for sync - the business key is (user_id, personality_id),
    // not the surrogate id. This prevents duplicate key errors when dev and prod have
    // different UUIDs for the same user+personality combination.
    // ORDER IS FROZEN: the sync_tombstone_user_personality_configs trigger's
    // TG_ARGV (migration 20260710230428) joins OLD values in this exact order;
    // validateTombstoneTriggers enforces the parity at sync time.
    pk: ['user_id', 'personality_id'],
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    uuidColumns: [
      'id',
      'user_id',
      'personality_id',
      'persona_id',
      'llm_config_id',
      'tts_config_id',
      'vision_config_id',
    ],
    timestampColumns: ['created_at', 'updated_at'],
    // persona_id, llm_config_id, tts_config_id, and vision_config_id are synced
    // directly (not deferred) — personas, llm_configs, and tts_configs all come
    // before user_personality_configs in SYNC_TABLE_ORDER (vision_config_id also
    // points to llm_configs), so their rows exist by the time this table is
    // synced; no circular-FK deferral needed.
    // Previously excluded as "user preferences" but that orphaned per-character
    // persona/llm overrides for mirrored users on dev. Same trade-off as on users:
    // the dev user's own overrides will bleed across envs via last-write-wins.
    // (Note: focus_mode_enabled was previously in excludeColumns but that column was
    // dropped in migration 20260216004720 — data moved to config_overrides JSONB.)
  },
  user_persona_history_configs: {
    pk: 'id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    uuidColumns: ['id', 'user_id', 'personality_id', 'persona_id'],
    timestampColumns: ['created_at', 'updated_at', 'last_context_reset', 'previous_context_reset'],
    // Exclude context reset timestamps - settings, not raw data
    // Dev may have different reset points than prod (frequent resets during testing)
    excludeColumns: ['last_context_reset', 'previous_context_reset'],
  },
  conversation_history: {
    pk: 'id',
    createdAt: 'created_at',
    // No updatedAt - append-only
    uuidColumns: ['id', 'persona_id', 'personality_id'],
    timestampColumns: ['created_at'],
  },
  conversation_history_tombstones: {
    pk: 'id',
    createdAt: 'deleted_at', // Use deleted_at as the timestamp for sync
    // No updatedAt - tombstones are immutable
    uuidColumns: ['id', 'persona_id', 'personality_id'],
    timestampColumns: ['deleted_at'],
  },
  // NOTE: activated_channels intentionally NOT synced - see SyncTableName comment
  memories: {
    pk: 'id',
    createdAt: 'created_at',
    // updated_at is genuinely mutated (lock toggles, deletion propagation,
    // content edits) — last-write-wins needs it, not the created_at fallback.
    updatedAt: 'updated_at',
    uuidColumns: [
      'id',
      'persona_id',
      'personality_id',
      'legacy_shapes_user_id',
      'chunk_group_id',
      'canon_group_id',
    ],
    timestampColumns: ['created_at', 'updated_at', 'summarized_at'],
  },
  memory_facts: {
    pk: 'id',
    createdAt: 'created_at',
    // updated_at is genuinely mutated (corrections, /memory forget, lock
    // toggles, supersession flips) — last-write-wins needs it, so every
    // user-facing removal/edit verb propagates as column values. Hard row
    // deletes ALSO propagate via the sync_tombstones ledger (the
    // sync_tombstone_memory_facts trigger), like every synced table.
    updatedAt: 'updated_at',
    uuidColumns: ['id', 'personality_id', 'persona_id', 'canon_group_id', 'superseded_by_id'],
    timestampColumns: ['valid_from', 'superseded_at', 'created_at', 'updated_at'],
    // superseded_by_id is a self-FK whose pointers are NOT creation-ordered
    // (the revive path points newer→older), so rows sync in arbitrary order
    // under the DEFERRABLE constraint named in DatabaseSyncService's
    // SET CONSTRAINTS list (migration 20260710183055). Content-hash fact ids
    // mean the same fact extracted independently in both envs converges to
    // one row on conflict instead of duplicating.
  },
  shapes_persona_mappings: {
    pk: 'id',
    createdAt: 'mapped_at',
    // No updatedAt - mapping records are immutable once created
    uuidColumns: ['id', 'shapes_user_id', 'persona_id', 'mapped_by'],
    timestampColumns: ['mapped_at'],
  },
  // NOTE: pending_memories is skipped - transient queue data doesn't need syncing
} as const;

/**
 * Sync order that respects foreign key dependencies.
 *
 * Dependencies:
 * - system_prompts: no FK deps
 * - users: default_persona_id → personas.id (NOT NULL) AND
 *   default_llm_config_id → llm_configs.id (nullable), both circular. The
 *   enclosing sync transaction uses DEFERRABLE constraints + SET CONSTRAINTS
 *   ALL DEFERRED (see migration 20260418010642) so users inserts can carry
 *   real FK values; Postgres validates at COMMIT.
 * - llm_configs: owner_id → users (NOT NULL, also circular; same deferred handling)
 * - tts_configs: owner_id → users (NOT NULL); users.default_tts_config_id is
 *   NULLABLE (like default_llm_config_id; only default_persona_id is NOT NULL),
 *   but the FK users_default_tts_config_id_fkey is still DEFERRABLE (migration
 *   20260504065151). Nullability only governs whether the column may be NULL,
 *   not the FK reference check: a user with a non-NULL default_tts_config_id
 *   would fail an immediate FK validation during users-sync without DEFERRABLE.
 *   Same deferred handling as the original four FKs.
 * - personas: owner_id → users (NOT NULL, also circular; same deferred handling)
 * - personalities: system_prompt_id → system_prompts, owner_id → users (NOT NULL)
 * - personality_owners: personality_id → personalities, user_id → users
 * - personality_aliases: personality_id → personalities, user_id → users (NULLABLE — global rows carry NULL)
 * - user_personality_configs: user_id → users, personality_id → personalities
 * - user_persona_history_configs: user_id → users, personality_id → personalities, persona_id → personas
 * - conversation_history: persona_id → personas, personality_id → personalities
 * - memories: persona_id → personas, personality_id → personalities
 * - shapes_persona_mappings: persona_id → personas, mapped_by → users
 *
 * NOTE: personality_default_configs moved to EXCLUDED_TABLES (settings, not raw data)
 * NOTE: activated_channels/channel_settings in EXCLUDED_TABLES (different bot instances)
 */
/**
 * CRITICAL: users MUST come before personas because:
 * - personas.owner_id -> users.id is NOT NULL (required FK, cannot defer)
 *
 * If you change this order, sync will fail with FK constraint violations!
 */
export const SYNC_TABLE_ORDER: SyncTableName[] = [
  // Deletion ledger first — every later table's classification consults it
  'sync_tombstones',
  // Base tables - users first because llm_configs/personas/personalities.owner_id is REQUIRED
  'system_prompts',
  'users',
  'llm_configs', // Requires users.id via owner_id (NOT NULL)
  'tts_configs', // Requires users.id via owner_id (NOT NULL); parallel to llm_configs
  'personas', // Can now reference users via owner_id
  // Personalities depends on system_prompts and users (owner_id NOT NULL)
  'personalities',
  // Junction/config tables that depend on the above
  // NOTE: personality_default_configs excluded - settings table, not raw data
  // NOTE: personality_default_tts_configs excluded for the same reason
  'personality_owners',
  'personality_aliases',
  'user_personality_configs',
  'user_persona_history_configs',
  // Tombstones MUST be synced BEFORE conversation_history
  // so sync can check tombstones and skip/delete tombstoned messages
  'conversation_history_tombstones',
  // Data tables
  'conversation_history',
  // NOTE: activated_channels intentionally NOT synced (different bot instances per environment)
  'memories',
  // memory_facts references personalities + personas (both earlier) and
  // itself (superseded_by_id — deferred; see the config entry note)
  'memory_facts',
  'shapes_persona_mappings',
];
