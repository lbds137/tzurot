/**
 * Sync Table Configurations
 *
 * Defines which tables to sync and their metadata for bidirectional sync.
 * NOTE: Column names must match database schema (snake_case), not Prisma model fields (camelCase)
 *
 * IMPORTANT: Tables must be synced in an order that respects foreign key constraints.
 * Use SYNC_TABLE_ORDER for iteration, not Object.keys(SYNC_CONFIG).
 */

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
}

export type SyncTableName =
  | 'users'
  | 'personas'
  | 'system_prompts'
  | 'llm_configs'
  | 'personalities'
  | 'personality_default_configs'
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
    // default_persona_id creates circular dependency: users ↔ personas
    // Deferred: sync users first with NULL, then update after personas sync
    deferredFkColumns: ['default_persona_id'],
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
  personalities: {
    pk: 'id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    uuidColumns: ['id', 'system_prompt_id', 'owner_id'],
    timestampColumns: ['created_at', 'updated_at'],
  },
  personality_default_configs: {
    pk: 'personality_id',
    updatedAt: 'updated_at',
    uuidColumns: ['personality_id', 'llm_config_id'],
    timestampColumns: ['updated_at'],
  },
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
  },
  user_persona_history_configs: {
    pk: 'id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    uuidColumns: ['id', 'user_id', 'personality_id', 'persona_id'],
    timestampColumns: ['created_at', 'updated_at', 'last_context_reset', 'previous_context_reset'],
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
 * CIRCULAR DEPENDENCY: users ↔ personas
 * - personas.owner_id → users.id (REQUIRED, NOT NULL)
 * - users.default_persona_id → personas.id (NULLABLE)
 *
 * Solution: Two-pass sync
 * 1. Users synced first with default_persona_id deferred (set to NULL)
 * 2. Personas synced (can now reference users via owner_id)
 * 3. Deferred FK columns updated after all tables synced
 *
 * Other dependencies:
 * - system_prompts: no FK deps
 * - llm_configs: owner_id → users (nullable)
 * - personalities: system_prompt_id → system_prompts, owner_id → users (nullable)
 * - personality_default_configs: personality_id → personalities, llm_config_id → llm_configs
 * - personality_owners: personality_id → personalities, user_id → users
 * - personality_aliases: personality_id → personalities
 * - user_personality_configs: user_id → users, personality_id → personalities, etc.
 * - user_persona_history_configs: user_id → users, personality_id → personalities, persona_id → personas
 * - conversation_history: persona_id → personas, personality_id → personalities
 * - memories: persona_id → personas, personality_id → personalities
 * NOTE: activated_channels intentionally NOT synced (different bot instances per environment)
 * - shapes_persona_mappings: persona_id → personas, mapped_by → users
 */
/**
 * CRITICAL: users MUST come before personas because:
 * - personas.owner_id -> users.id is NOT NULL (required FK, cannot defer)
 * - users.default_persona_id -> personas.id is NULLABLE (can defer to pass 2)
 *
 * If you change this order, sync will fail with FK constraint violations!
 */
export const SYNC_TABLE_ORDER: SyncTableName[] = [
  // Base tables - users first because personas.owner_id is REQUIRED
  'system_prompts',
  'llm_configs',
  'users', // Synced with default_persona_id=NULL (deferred)
  'personas', // Can now reference users via owner_id
  // Personalities depends on system_prompts and optionally users
  'personalities',
  // Junction/config tables that depend on the above
  'personality_default_configs',
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
