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
        expect(orderTables.has(table), `Table "${table}" is in SYNC_CONFIG but missing from SYNC_TABLE_ORDER`).toBe(true);
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
        expect(configTables.has(table), `Table "${table}" is in SYNC_TABLE_ORDER but not in SYNC_CONFIG`).toBe(true);
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
    function assertParentBeforeChild(parent: SyncTableName, child: SyncTableName, fkColumn: string): void {
      const parentIndex = getTableIndex(parent);
      const childIndex = getTableIndex(child);

      expect(
        parentIndex,
        `FK constraint violation: "${parent}" must be synced before "${child}" ` +
        `(${child}.${fkColumn} references ${parent}.id)`
      ).toBeLessThan(childIndex);
    }

    // Critical FK constraint that caused the original bug:
    // users.default_persona_id -> personas.id
    it('should sync personas before users (users.default_persona_id FK)', () => {
      assertParentBeforeChild('personas', 'users', 'default_persona_id');
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

    // activated_channels.personality_id -> personalities.id
    it('should sync personalities before activated_channels', () => {
      assertParentBeforeChild('personalities', 'activated_channels', 'personality_id');
    });

    // activated_channels.created_by -> users.id
    it('should sync users before activated_channels', () => {
      assertParentBeforeChild('users', 'activated_channels', 'created_by');
    });

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
          expect(config.pk.length, `Table "${tableName}" pk string cannot be empty`).toBeGreaterThan(0);
        } else {
          expect(Array.isArray(config.pk), `Table "${tableName}" pk must be string or array`).toBe(true);
          expect(config.pk.length, `Table "${tableName}" pk array cannot be empty`).toBeGreaterThan(0);
        }
      }
    });

    it('should have uuidColumns array for all tables', () => {
      for (const [tableName, config] of Object.entries(SYNC_CONFIG)) {
        expect(Array.isArray(config.uuidColumns), `Table "${tableName}" must have uuidColumns array`).toBe(true);
      }
    });

    it('should have timestampColumns array for all tables', () => {
      for (const [tableName, config] of Object.entries(SYNC_CONFIG)) {
        expect(Array.isArray(config.timestampColumns), `Table "${tableName}" must have timestampColumns array`).toBe(true);
      }
    });

    it('should have at least createdAt or updatedAt for timestamp comparison', () => {
      for (const [tableName, config] of Object.entries(SYNC_CONFIG)) {
        const hasTimestamp = config.createdAt !== undefined || config.updatedAt !== undefined;
        expect(hasTimestamp, `Table "${tableName}" must have createdAt or updatedAt for timestamp comparison`).toBe(true);
      }
    });
  });
});
