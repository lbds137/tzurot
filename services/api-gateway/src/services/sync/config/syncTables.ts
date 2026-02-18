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

  // Transient/ephemeral data
  pending_memories: 'Transient queue data for memory processing',
  image_description_cache: 'Cache data that can be regenerated',
  llm_diagnostic_logs: 'Ephemeral debug logs (auto-deleted after 24h)',
  usage_logs: 'Environment-specific usage tracking',
  import_jobs: 'Transient import job tracking (environment-specific, retryable)',
  export_jobs: 'Transient export job tracking (environment-specific, retryable)',

  // Moderation data
  denylisted_entities: 'Environment-specific denylist (different moderation per bot instance)',

  // Security-sensitive data
  user_credentials: 'Encrypted session cookies for external services (security-sensitive)',
};

export interface TableSyncConfig {
  pk: string | string[]; // Primary key field(s)
  createdAt?: string; // Creation timestamp field (if exists)
  updatedAt?: string; // Update timestamp field (if exists)
  uuidColumns: string[]; // Columns that contain UUIDs (for validation)
  timestampColumns: string[]; // Columns that contain timestamps (for validation)
  /**
   * FK columns that participate in circular dependencies.
   * These columns are set to NULL during initial sync, then updated in a second pass
   * after all referenced tables have been synced.
   *
   * Example: users.default_persona_id creates a circular dependency with personas.owner_id
   * Solution: Sync users with default_persona_id=NULL first, then update after personas sync
   */
  deferredFkColumns?: string[];
  /**
   * Columns to completely exclude from sync.
   * These columns are not copied between environments, allowing dev and prod to have
   * different values. Useful for environment-specific settings like default flags.
   *
   * Example: llm_configs.is_default should be different in dev vs prod
   */
  excludeColumns?: string[];
}

export type SyncTableName =
  | 'users'
  | 'personas'
  | 'system_prompts'
  | 'llm_configs'
  | 'personalities'
  // NOTE: personality_default_configs moved to EXCLUDED_TABLES - settings, not raw data
  | 'personality_owners'
  | 'personality_aliases'
  | 'user_personality_configs'
  | 'user_persona_history_configs'
  | 'conversation_history'
  | 'conversation_history_tombstones'
  // NOTE: activated_channels intentionally NOT synced - dev/prod have different bot instances
  // and syncing would cause double-responses in channels where both bots are present
  | 'memories'
  | 'shapes_persona_mappings';

/**
 * Tables to sync with their primary key field(s), timestamp fields, and UUID columns
 */
export const SYNC_CONFIG: Record<SyncTableName, TableSyncConfig> = {
  users: {
    pk: 'id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    uuidColumns: ['id', 'default_llm_config_id', 'default_persona_id'],
    timestampColumns: ['created_at', 'updated_at'],
    // Exclude user preference columns - settings, not raw data
    // - default_llm_config_id: user's global LLM preset default
    // - default_persona_id: user's default persona across all characters
    excludeColumns: ['default_llm_config_id', 'default_persona_id'],
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
    // Exclude singleton flags from sync - dev and prod should have independent defaults
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
    pk: ['personality_id', 'user_id'], // Composite key
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    uuidColumns: ['personality_id', 'user_id'],
    timestampColumns: ['created_at', 'updated_at'],
  },
  personality_aliases: {
    pk: 'id',
    createdAt: 'created_at',
    // No updatedAt - aliases are immutable
    uuidColumns: ['id', 'personality_id'],
    timestampColumns: ['created_at'],
  },
  user_personality_configs: {
    // Use composite unique key for sync - the business key is (user_id, personality_id),
    // not the surrogate id. This prevents duplicate key errors when dev and prod have
    // different UUIDs for the same user+personality combination.
    pk: ['user_id', 'personality_id'],
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    uuidColumns: ['id', 'user_id', 'personality_id', 'persona_id', 'llm_config_id'],
    timestampColumns: ['created_at', 'updated_at'],
    // Exclude user preference columns - settings, not raw data
    // - llm_config_id: user's LLM preset override for this character
    // - persona_id: user's active persona for this character
    // - focus_mode_enabled: user's focus mode setting (disables LTM retrieval)
    excludeColumns: ['llm_config_id', 'persona_id', 'focus_mode_enabled'],
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
    // No updatedAt - append-only
    uuidColumns: ['id', 'persona_id', 'personality_id', 'legacy_shapes_user_id', 'chunk_group_id'],
    timestampColumns: ['created_at'],
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
 * - users: no synced FK deps (default_persona_id and default_llm_config_id are excluded)
 * - llm_configs: owner_id → users (NOT NULL)
 * - personas: owner_id → users (NOT NULL)
 * - personalities: system_prompt_id → system_prompts, owner_id → users (NOT NULL)
 * - personality_owners: personality_id → personalities, user_id → users
 * - personality_aliases: personality_id → personalities
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
  // Base tables - users first because llm_configs/personas/personalities.owner_id is REQUIRED
  'system_prompts',
  'users',
  'llm_configs', // Requires users.id via owner_id (NOT NULL)
  'personas', // Can now reference users via owner_id
  // Personalities depends on system_prompts and users (owner_id NOT NULL)
  'personalities',
  // Junction/config tables that depend on the above
  // NOTE: personality_default_configs excluded - settings table, not raw data
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
  'shapes_persona_mappings',
];
