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
    // - users.default_persona_id -> personas.id (NULLABLE - can be deferred)
    // - personas.owner_id -> users.id (NOT NULL - cannot be deferred)
    //
    // Solution: users synced BEFORE personas with default_persona_id set to NULL (pass 1),
    // then default_persona_id updated after personas exist (pass 2).
    // This test verifies personas.owner_id FK is satisfied (users first).
    it('should sync users before personas (personas.owner_id FK - NOT NULL)', () => {
      assertParentBeforeChild('users', 'personas', 'owner_id');
    });

    // users.default_llm_config_id -> llm_configs.id
    it('should sync llm_configs before users (users.default_llm_config_id FK)', () => {
      assertParentBeforeChild('llm_configs', 'users', 'default_llm_config_id');
    });

    // personalities.system_prompt_id -> system_prompts.id
    it('should sync system_prompts before personalities (personalities.system_prompt_id FK)', () => {
      assertParentBeforeChild('system_prompts', 'personalities', 'system_prompt_id');
    });

    // personalities.owner_id -> users.id (nullable, but still needs to exist if set)
    it('should sync users before personalities (personalities.owner_id FK)', () => {
      assertParentBeforeChild('users', 'personalities', 'owner_id');
    });

    // personality_default_configs.personality_id -> personalities.id
    it('should sync personalities before personality_default_configs', () => {
      assertParentBeforeChild('personalities', 'personality_default_configs', 'personality_id');
    });

    // personality_default_configs.llm_config_id -> llm_configs.id
    it('should sync llm_configs before personality_default_configs', () => {
      assertParentBeforeChild('llm_configs', 'personality_default_configs', 'llm_config_id');
    });

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

  describe('Deferred FK columns (two-pass sync)', () => {
    it('should have users.default_persona_id as a deferred FK column', () => {
      // This is critical for the circular dependency between users and personas
      const usersConfig = SYNC_CONFIG.users;
      expect(usersConfig.deferredFkColumns).toBeDefined();
      expect(usersConfig.deferredFkColumns).toContain('default_persona_id');
    });

    it('should only defer nullable FK columns', () => {
      // Deferred FK columns must be nullable because they're set to NULL in pass 1
      // Currently only users.default_persona_id is deferred
      const usersConfig = SYNC_CONFIG.users;
      expect(usersConfig.deferredFkColumns).toEqual(['default_persona_id']);
    });

    it('should have deferredFkColumns as array or undefined for all tables', () => {
      for (const [tableName, config] of Object.entries(SYNC_CONFIG)) {
        if (config.deferredFkColumns !== undefined) {
          expect(
            Array.isArray(config.deferredFkColumns),
            `Table "${tableName}" deferredFkColumns must be an array`
          ).toBe(true);
        }
      }
    });

    it('should include deferred FK columns in uuidColumns if they reference UUIDs', () => {
      // Deferred FK columns that reference UUID primary keys should also be in uuidColumns
      // for proper UUID format handling
      const usersConfig = SYNC_CONFIG.users;
      expect(usersConfig.uuidColumns).toContain('default_persona_id');
    });

    it('should only defer known nullable FK columns (schema drift guard)', () => {
      // This test prevents accidentally deferring non-nullable FKs which would cause
      // NOT NULL constraint violations. If schema changes, update this mapping.
      const knownNullableFks: Record<string, string[]> = {
        users: ['default_persona_id', 'default_llm_config_id'], // Both nullable in schema
        // Add other tables here if they ever need deferred FKs
      };

      for (const [tableName, config] of Object.entries(SYNC_CONFIG)) {
        const deferredFks = config.deferredFkColumns ?? [];
        const allowedNullableFks = knownNullableFks[tableName] ?? [];

        for (const fkColumn of deferredFks) {
          expect(
            allowedNullableFks,
            `Table "${tableName}" defers "${fkColumn}" but it's not in knownNullableFks. ` +
              `If this FK is nullable, add it to knownNullableFks. If not, remove it from deferredFkColumns.`
          ).toContain(fkColumn);
        }
      }
    });

    it('should warn about potential issues with non-nullable FK deferral attempts', () => {
      // This documents which FKs CANNOT be deferred due to NOT NULL constraints
      const nonNullableFks: Record<string, string[]> = {
        personas: ['owner_id'], // Required FK - forces users-before-personas order
        personality_owners: ['personality_id', 'user_id'], // Composite PK, both required
        personality_aliases: ['personality_id'], // Required FK
        // Most junction tables have required FKs
      };

      // Verify none of these are in deferredFkColumns
      for (const [tableName, config] of Object.entries(SYNC_CONFIG)) {
        const deferredFks = config.deferredFkColumns ?? [];
        const notAllowed = nonNullableFks[tableName] ?? [];

        for (const fkColumn of deferredFks) {
          expect(
            notAllowed,
            `Table "${tableName}" attempts to defer "${fkColumn}" but it's NOT NULL. ` +
              `This would cause constraint violations. Remove from deferredFkColumns.`
          ).not.toContain(fkColumn);
        }
      }
    });
  });
});
