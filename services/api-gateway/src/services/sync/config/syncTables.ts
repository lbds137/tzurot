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
  | 'conversation_history'
  | 'activated_channels'
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
    pk: 'id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    uuidColumns: ['id', 'user_id', 'personality_id', 'persona_id', 'llm_config_id'],
    timestampColumns: ['created_at', 'updated_at'],
  },
  conversation_history: {
    pk: 'id',
    createdAt: 'created_at',
    // No updatedAt - append-only
    uuidColumns: ['id', 'persona_id', 'personality_id'],
    timestampColumns: ['created_at'],
  },
  activated_channels: {
    pk: 'id',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    uuidColumns: ['id', 'personality_id', 'created_by'],
    timestampColumns: ['created_at', 'updated_at'],
  },
  memories: {
    pk: 'id',
    createdAt: 'created_at',
    // No updatedAt - append-only
    uuidColumns: ['id', 'persona_id', 'personality_id', 'legacy_shapes_user_id'],
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
 * Key dependencies:
 * - personas: no required FK deps
 * - system_prompts: no FK deps
 * - llm_configs: owner_id → users (nullable)
 * - users: default_persona_id → personas, default_llm_config_id → llm_configs
 * - personalities: system_prompt_id → system_prompts, owner_id → users (nullable)
 * - personality_default_configs: personality_id → personalities, llm_config_id → llm_configs
 * - personality_owners: personality_id → personalities, user_id → users
 * - personality_aliases: personality_id → personalities
 * - user_personality_configs: user_id → users, personality_id → personalities, etc.
 * - conversation_history: persona_id → personas, personality_id → personalities
 * - activated_channels: personality_id → personalities, created_by → users
 * - memories: persona_id → personas, personality_id → personalities
 * - shapes_persona_mappings: persona_id → personas, mapped_by → users
 *
 * CRITICAL: personas must come before users because users.default_persona_id references personas.id
 */
export const SYNC_TABLE_ORDER: SyncTableName[] = [
  // Base tables with no required FK deps
  'personas',
  'system_prompts',
  'llm_configs',
  // Users depends on personas (default_persona_id) and llm_configs (default_llm_config_id)
  'users',
  // Personalities depends on system_prompts and optionally users
  'personalities',
  // Junction/config tables that depend on the above
  'personality_default_configs',
  'personality_owners',
  'personality_aliases',
  'user_personality_configs',
  // Data tables
  'conversation_history',
  'activated_channels',
  'memories',
  'shapes_persona_mappings',
];
