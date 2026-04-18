/**
 * Sync Tables Configuration Tests
 *
 * These tests verify the FK-ordering constraints in SYNC_TABLE_ORDER.
 * Critical: Tables must be synced in an order that respects foreign key constraints,
 * otherwise inserts will fail with FK constraint violations.
 */

import { describe, it, expect } from 'vitest';
import { SYNC_CONFIG, SYNC_TABLE_ORDER, type SyncTableName } from './syncTables.js';

describe('syncTables Configuration', () => {
  describe('SYNC_TABLE_ORDER completeness', () => {
    it('should include all tables from SYNC_CONFIG', () => {
      const configTables = Object.keys(SYNC_CONFIG) as SyncTableName[];
      const orderTables = new Set(SYNC_TABLE_ORDER);

      // Every table in SYNC_CONFIG must be in SYNC_TABLE_ORDER
      for (const table of configTables) {
        expect(
          orderTables.has(table),
          `Table "${table}" is in SYNC_CONFIG but missing from SYNC_TABLE_ORDER`
        ).toBe(true);
      }
    });

    it('should not have duplicate tables', () => {
      const seen = new Set<string>();
      const duplicates: string[] = [];

      for (const table of SYNC_TABLE_ORDER) {
        if (seen.has(table)) {
          duplicates.push(table);
        }
        seen.add(table);
      }

      expect(duplicates, `Duplicate tables found: ${duplicates.join(', ')}`).toHaveLength(0);
    });

    it('should not include tables that are not in SYNC_CONFIG', () => {
      const configTables = new Set(Object.keys(SYNC_CONFIG));

      for (const table of SYNC_TABLE_ORDER) {
        expect(
          configTables.has(table),
          `Table "${table}" is in SYNC_TABLE_ORDER but not in SYNC_CONFIG`
        ).toBe(true);
      }
    });

    it('should have the same number of tables as SYNC_CONFIG', () => {
      expect(SYNC_TABLE_ORDER.length).toBe(Object.keys(SYNC_CONFIG).length);
    });
  });

  describe('SYNC_TABLE_ORDER foreign key ordering', () => {
    /**
     * Helper to get the index of a table in SYNC_TABLE_ORDER
     */
    function getTableIndex(table: SyncTableName): number {
      const index = SYNC_TABLE_ORDER.indexOf(table);
      expect(index, `Table "${table}" not found in SYNC_TABLE_ORDER`).toBeGreaterThanOrEqual(0);
      return index;
    }

    /**
     * Assert that parent table comes before child table in sync order
     */
    function assertParentBeforeChild(
      parent: SyncTableName,
      child: SyncTableName,
      fkColumn: string
    ): void {
      const parentIndex = getTableIndex(parent);
      const childIndex = getTableIndex(child);

      expect(
        parentIndex,
        `FK constraint violation: "${parent}" must be synced before "${child}" ` +
          `(${child}.${fkColumn} references ${parent}.id)`
      ).toBeLessThan(childIndex);
    }

    // Circular FK dependency between users and personas:
    // - users.default_persona_id -> personas.id (NULLABLE - deferred to pass 2)
    // - personas.owner_id -> users.id (NOT NULL - cannot be deferred)
    //
    // Solution: users synced BEFORE personas with default_persona_id set to NULL (pass 1),
    // then default_persona_id updated after personas exist (pass 2).
    // This test verifies personas.owner_id FK is satisfied (users first).
    it('should sync users before personas (personas.owner_id FK - NOT NULL)', () => {
      assertParentBeforeChild('users', 'personas', 'owner_id');
    });

    // Same circular-FK pattern for users.default_llm_config_id -> llm_configs.id:
    // - NULLABLE FK, deferred to pass 2
    // - llm_configs.owner_id -> users.id is NOT NULL (forces users-first ordering)
    // The users-before-llm_configs assertion below is the load-bearing check.

    // personalities.system_prompt_id -> system_prompts.id
    it('should sync system_prompts before personalities (personalities.system_prompt_id FK)', () => {
      assertParentBeforeChild('system_prompts', 'personalities', 'system_prompt_id');
    });

    // personalities.owner_id -> users.id (NOT NULL)
    it('should sync users before personalities (personalities.owner_id FK)', () => {
      assertParentBeforeChild('users', 'personalities', 'owner_id');
    });

    // llm_configs.owner_id -> users.id (NOT NULL)
    it('should sync users before llm_configs (llm_configs.owner_id FK)', () => {
      assertParentBeforeChild('users', 'llm_configs', 'owner_id');
    });

    // NOTE: personality_default_configs moved to EXCLUDED_TABLES (settings, not raw data)

    // personality_owners.personality_id -> personalities.id
    it('should sync personalities before personality_owners', () => {
      assertParentBeforeChild('personalities', 'personality_owners', 'personality_id');
    });

    // personality_owners.user_id -> users.id
    it('should sync users before personality_owners', () => {
      assertParentBeforeChild('users', 'personality_owners', 'user_id');
    });

    // personality_aliases.personality_id -> personalities.id
    it('should sync personalities before personality_aliases', () => {
      assertParentBeforeChild('personalities', 'personality_aliases', 'personality_id');
    });

    // user_personality_configs has multiple FKs
    it('should sync users before user_personality_configs', () => {
      assertParentBeforeChild('users', 'user_personality_configs', 'user_id');
    });

    it('should sync personalities before user_personality_configs', () => {
      assertParentBeforeChild('personalities', 'user_personality_configs', 'personality_id');
    });

    it('should sync personas before user_personality_configs', () => {
      assertParentBeforeChild('personas', 'user_personality_configs', 'persona_id');
    });

    it('should sync llm_configs before user_personality_configs', () => {
      assertParentBeforeChild('llm_configs', 'user_personality_configs', 'llm_config_id');
    });

    // conversation_history.persona_id -> personas.id
    it('should sync personas before conversation_history', () => {
      assertParentBeforeChild('personas', 'conversation_history', 'persona_id');
    });

    // conversation_history.personality_id -> personalities.id
    it('should sync personalities before conversation_history', () => {
      assertParentBeforeChild('personalities', 'conversation_history', 'personality_id');
    });

    // NOTE: activated_channels intentionally NOT synced (different bot instances per environment)

    // memories.persona_id -> personas.id
    it('should sync personas before memories', () => {
      assertParentBeforeChild('personas', 'memories', 'persona_id');
    });

    // memories.personality_id -> personalities.id
    it('should sync personalities before memories', () => {
      assertParentBeforeChild('personalities', 'memories', 'personality_id');
    });

    // shapes_persona_mappings.persona_id -> personas.id
    it('should sync personas before shapes_persona_mappings', () => {
      assertParentBeforeChild('personas', 'shapes_persona_mappings', 'persona_id');
    });

    // shapes_persona_mappings.mapped_by -> users.id
    it('should sync users before shapes_persona_mappings', () => {
      assertParentBeforeChild('users', 'shapes_persona_mappings', 'mapped_by');
    });
  });

  describe('SYNC_CONFIG structure', () => {
    it('should have valid primary key configuration for all tables', () => {
      for (const [tableName, config] of Object.entries(SYNC_CONFIG)) {
        expect(config.pk, `Table "${tableName}" must have a pk field`).toBeDefined();

        // pk should be string or array of strings
        if (typeof config.pk === 'string') {
          expect(
            config.pk.length,
            `Table "${tableName}" pk string cannot be empty`
          ).toBeGreaterThan(0);
        } else {
          expect(Array.isArray(config.pk), `Table "${tableName}" pk must be string or array`).toBe(
            true
          );
          expect(config.pk.length, `Table "${tableName}" pk array cannot be empty`).toBeGreaterThan(
            0
          );
        }
      }
    });

    it('should have uuidColumns array for all tables', () => {
      for (const [tableName, config] of Object.entries(SYNC_CONFIG)) {
        expect(
          Array.isArray(config.uuidColumns),
          `Table "${tableName}" must have uuidColumns array`
        ).toBe(true);
      }
    });

    it('should have timestampColumns array for all tables', () => {
      for (const [tableName, config] of Object.entries(SYNC_CONFIG)) {
        expect(
          Array.isArray(config.timestampColumns),
          `Table "${tableName}" must have timestampColumns array`
        ).toBe(true);
      }
    });

    it('should have at least createdAt or updatedAt for timestamp comparison', () => {
      for (const [tableName, config] of Object.entries(SYNC_CONFIG)) {
        const hasTimestamp = config.createdAt !== undefined || config.updatedAt !== undefined;
        expect(
          hasTimestamp,
          `Table "${tableName}" must have createdAt or updatedAt for timestamp comparison`
        ).toBe(true);
      }
    });
  });

  describe('Circular FK columns (Ouroboros Insert pattern)', () => {
    it('should include users.default_persona_id and users.default_llm_config_id in uuidColumns', () => {
      // These columns are circular FKs: users.default_persona_id → personas.id
      // and users.default_llm_config_id → llm_configs.id, with personas.owner_id
      // and llm_configs.owner_id both pointing back to users.id (all NOT NULL).
      // Previously handled via a two-pass sync (insert NULL, backfill later).
      // Now handled by migration 20260418010642 making the FKs DEFERRABLE
      // plus DatabaseSyncService issuing `SET CONSTRAINTS ALL DEFERRED`
      // inside the flush transaction. Real values flow through in a single
      // pass; uuidColumns still matters for ::uuid casting at INSERT time.
      const usersConfig = SYNC_CONFIG.users;
      expect(usersConfig.uuidColumns).toContain('default_persona_id');
      expect(usersConfig.uuidColumns).toContain('default_llm_config_id');
    });

    it('should not exclude the circular-FK columns from sync', () => {
      // Pre-Phase-5b these were in excludeColumns, which orphaned mirrored
      // users on dev (the referenced persona synced, but the FK on the
      // user row was wiped). The Ouroboros pattern keeps the invariant
      // "user with owned personas has a default persona" intact across envs.
      const usersConfig = SYNC_CONFIG.users;
      const excluded = usersConfig.excludeColumns ?? [];
      expect(excluded).not.toContain('default_persona_id');
      expect(excluded).not.toContain('default_llm_config_id');
    });

    it('should not exclude user_personality_configs preference columns', () => {
      // Same invariant for per-character overrides. personas and llm_configs
      // sync before user_personality_configs (per SYNC_TABLE_ORDER), so these
      // FKs are not circular — direct sync. Previously excluded blanket-
      // style, which wiped per-character overrides for mirrored users on
      // dev. (focus_mode_enabled column was dropped in migration
      // 20260216004720 — data moved to config_overrides JSONB.)
      const upcConfig = SYNC_CONFIG.user_personality_configs;
      const excluded = upcConfig.excludeColumns ?? [];
      expect(excluded).not.toContain('persona_id');
      expect(excluded).not.toContain('llm_config_id');
      expect(excluded).not.toContain('focus_mode_enabled');
    });
  });

  describe('Excluded columns (not synced between environments)', () => {
    it('should exclude is_default and is_free_default from llm_configs sync', () => {
      // These singleton flags should be different in dev vs prod
      // Each environment has its own system default preset
      const llmConfigsConfig = SYNC_CONFIG.llm_configs;
      expect(llmConfigsConfig.excludeColumns).toBeDefined();
      expect(llmConfigsConfig.excludeColumns).toContain('is_default');
      expect(llmConfigsConfig.excludeColumns).toContain('is_free_default');
    });

    it('should have excludeColumns as array or undefined for all tables', () => {
      for (const [tableName, config] of Object.entries(SYNC_CONFIG)) {
        if (config.excludeColumns !== undefined) {
          expect(
            Array.isArray(config.excludeColumns),
            `Table "${tableName}" excludeColumns must be an array`
          ).toBe(true);
        }
      }
    });

    it('should not exclude primary key columns', () => {
      // Excluding a PK would break sync logic
      for (const [tableName, config] of Object.entries(SYNC_CONFIG)) {
        const excludeCols = config.excludeColumns ?? [];
        const pkCols = typeof config.pk === 'string' ? [config.pk] : config.pk;

        for (const pkCol of pkCols) {
          expect(
            excludeCols,
            `Table "${tableName}" cannot exclude primary key column "${pkCol}"`
          ).not.toContain(pkCol);
        }
      }
    });
  });
});
