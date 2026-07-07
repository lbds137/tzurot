/**
 * Tests for Deterministic UUID Generation
 */

import { describe, it, expect } from 'vitest';
import {
  generateUserUuid,
  generatePersonalityUuid,
  generatePersonaUuid,
  generateSystemPromptUuid,
  generateLlmConfigUuid,
  newLlmConfigId,
  newTtsConfigId,
  generateSystemGlobalTtsConfigUuid,
  generateSystemGlobalLlmConfigUuid,
  generateByokTtsConfigUuid,
  generateByokLlmConfigUuid,
  generateUserPersonalityConfigUuid,
  generateConversationHistoryUuid,
  generateChannelSettingsUuid,
  generateMemoryDuplicateUuid,
  generateMemoryChunkGroupUuid,
  generateBotSettingUuid,
  generateUserPersonaHistoryConfigUuid,
  generateImageDescriptionCacheUuid,
  generateUsageLogUuid,
  generateFactExtractionJobUuid,
  generateMemoryFactUuid,
  generatePendingMemoryUuid,
  generateUserApiKeyUuid,
  generateExportJobUuid,
  isUuidFormat,
} from './deterministicUuid.js';

describe('Deterministic UUID Generation', () => {
  describe('generateUserUuid', () => {
    it('should generate consistent UUIDs for the same discordId', () => {
      const uuid1 = generateUserUuid('123456789');
      const uuid2 = generateUserUuid('123456789');
      expect(uuid1).toBe(uuid2);
    });

    it('should generate different UUIDs for different discordIds', () => {
      const uuid1 = generateUserUuid('123456789');
      const uuid2 = generateUserUuid('987654321');
      expect(uuid1).not.toBe(uuid2);
    });

    it('should generate valid v5 UUIDs', () => {
      const uuid = generateUserUuid('test-id');
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });

  describe('generatePersonalityUuid', () => {
    it('should generate consistent UUIDs for the same slug', () => {
      const uuid1 = generatePersonalityUuid('my-personality');
      const uuid2 = generatePersonalityUuid('my-personality');
      expect(uuid1).toBe(uuid2);
    });

    it('should generate different UUIDs for different slugs', () => {
      const uuid1 = generatePersonalityUuid('personality-a');
      const uuid2 = generatePersonalityUuid('personality-b');
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('generatePersonaUuid', () => {
    it('should generate consistent UUIDs for the same name and owner', () => {
      const uuid1 = generatePersonaUuid('persona-name', 'owner-id');
      const uuid2 = generatePersonaUuid('persona-name', 'owner-id');
      expect(uuid1).toBe(uuid2);
    });

    it('should use "global" when ownerId is undefined', () => {
      const uuid1 = generatePersonaUuid('persona-name');
      const uuid2 = generatePersonaUuid('persona-name', undefined);
      expect(uuid1).toBe(uuid2);
    });

    it('should use "global" when ownerId is empty string', () => {
      const uuid1 = generatePersonaUuid('persona-name');
      const uuid2 = generatePersonaUuid('persona-name', '');
      expect(uuid1).toBe(uuid2);
    });

    it('should generate different UUIDs for same name but different owners', () => {
      const uuid1 = generatePersonaUuid('persona-name', 'owner-a');
      const uuid2 = generatePersonaUuid('persona-name', 'owner-b');
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('generateSystemPromptUuid', () => {
    it('should generate consistent UUIDs for the same name', () => {
      const uuid1 = generateSystemPromptUuid('my-prompt');
      const uuid2 = generateSystemPromptUuid('my-prompt');
      expect(uuid1).toBe(uuid2);
    });
  });

  describe('generateLlmConfigUuid', () => {
    it('should generate consistent UUIDs for the same name', () => {
      const uuid1 = generateLlmConfigUuid('my-config');
      const uuid2 = generateLlmConfigUuid('my-config');
      expect(uuid1).toBe(uuid2);
    });
  });

  describe('generateUserPersonalityConfigUuid', () => {
    it('should generate consistent UUIDs for the same userId and personalityId', () => {
      const uuid1 = generateUserPersonalityConfigUuid('user-1', 'personality-1');
      const uuid2 = generateUserPersonalityConfigUuid('user-1', 'personality-1');
      expect(uuid1).toBe(uuid2);
    });

    it('should generate different UUIDs for different combinations', () => {
      const uuid1 = generateUserPersonalityConfigUuid('user-1', 'personality-1');
      const uuid2 = generateUserPersonalityConfigUuid('user-1', 'personality-2');
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('generateConversationHistoryUuid', () => {
    it('should generate consistent UUIDs for the same inputs', () => {
      const date = new Date('2025-01-01T00:00:00Z');
      const uuid1 = generateConversationHistoryUuid('channel-1', 'personality-1', 'user-1', date);
      const uuid2 = generateConversationHistoryUuid('channel-1', 'personality-1', 'user-1', date);
      expect(uuid1).toBe(uuid2);
    });

    it('should generate different UUIDs for different timestamps', () => {
      const date1 = new Date('2025-01-01T00:00:00Z');
      const date2 = new Date('2025-01-01T00:00:01Z');
      const uuid1 = generateConversationHistoryUuid('channel-1', 'personality-1', 'user-1', date1);
      const uuid2 = generateConversationHistoryUuid('channel-1', 'personality-1', 'user-1', date2);
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('generateChannelSettingsUuid', () => {
    it('should generate consistent UUIDs for the same channelId', () => {
      const uuid1 = generateChannelSettingsUuid('channel-123');
      const uuid2 = generateChannelSettingsUuid('channel-123');
      expect(uuid1).toBe(uuid2);
    });

    it('should generate different UUIDs for different channelIds', () => {
      const uuid1 = generateChannelSettingsUuid('channel-123');
      const uuid2 = generateChannelSettingsUuid('channel-456');
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('generateMemoryDuplicateUuid', () => {
    it('should generate consistent UUIDs for the same inputs', () => {
      const uuid1 = generateMemoryDuplicateUuid('original-point-id', 'user-id');
      const uuid2 = generateMemoryDuplicateUuid('original-point-id', 'user-id');
      expect(uuid1).toBe(uuid2);
    });

    it('should generate different UUIDs for different inputs', () => {
      const uuid1 = generateMemoryDuplicateUuid('original-point-id', 'user-a');
      const uuid2 = generateMemoryDuplicateUuid('original-point-id', 'user-b');
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('generateMemoryChunkGroupUuid', () => {
    it('should generate consistent UUIDs for the same inputs', () => {
      const uuid1 = generateMemoryChunkGroupUuid(
        'persona-1',
        'personality-1',
        'This is the original text'
      );
      const uuid2 = generateMemoryChunkGroupUuid(
        'persona-1',
        'personality-1',
        'This is the original text'
      );
      expect(uuid1).toBe(uuid2);
    });

    it('should generate different UUIDs for different text content', () => {
      const uuid1 = generateMemoryChunkGroupUuid('persona-1', 'personality-1', 'Text A');
      const uuid2 = generateMemoryChunkGroupUuid('persona-1', 'personality-1', 'Text B');
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('generateBotSettingUuid', () => {
    it('should generate consistent UUIDs for the same key', () => {
      const uuid1 = generateBotSettingUuid('extended_context_default');
      const uuid2 = generateBotSettingUuid('extended_context_default');
      expect(uuid1).toBe(uuid2);
    });

    it('should generate different UUIDs for different keys', () => {
      const uuid1 = generateBotSettingUuid('setting_a');
      const uuid2 = generateBotSettingUuid('setting_b');
      expect(uuid1).not.toBe(uuid2);
    });

    it('should match the hardcoded UUID in migration for extended_context_default', () => {
      // This ensures the migration uses the correct deterministic UUID
      const uuid = generateBotSettingUuid('extended_context_default');
      expect(uuid).toBe('d3ba618d-42e0-5a62-9fdf-31c10da1a7a7');
    });
  });

  describe('generateUserPersonaHistoryConfigUuid', () => {
    it('should generate consistent UUIDs for the same inputs', () => {
      const uuid1 = generateUserPersonaHistoryConfigUuid('user-1', 'personality-1', 'persona-1');
      const uuid2 = generateUserPersonaHistoryConfigUuid('user-1', 'personality-1', 'persona-1');
      expect(uuid1).toBe(uuid2);
    });

    it('should generate different UUIDs for different inputs', () => {
      const uuid1 = generateUserPersonaHistoryConfigUuid('user-1', 'personality-1', 'persona-1');
      const uuid2 = generateUserPersonaHistoryConfigUuid('user-1', 'personality-1', 'persona-2');
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('generateImageDescriptionCacheUuid', () => {
    it('should generate consistent UUIDs for the same attachmentId', () => {
      const uuid1 = generateImageDescriptionCacheUuid('attachment-123');
      const uuid2 = generateImageDescriptionCacheUuid('attachment-123');
      expect(uuid1).toBe(uuid2);
    });

    it('should generate different UUIDs for different attachmentIds', () => {
      const uuid1 = generateImageDescriptionCacheUuid('attachment-123');
      const uuid2 = generateImageDescriptionCacheUuid('attachment-456');
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('generateUsageLogUuid', () => {
    it('should generate consistent UUIDs for the same inputs', () => {
      const date = new Date('2025-01-01T00:00:00Z');
      const uuid1 = generateUsageLogUuid('user-1', 'gpt-4', date);
      const uuid2 = generateUsageLogUuid('user-1', 'gpt-4', date);
      expect(uuid1).toBe(uuid2);
    });

    it('should generate different UUIDs for different timestamps', () => {
      const date1 = new Date('2025-01-01T00:00:00Z');
      const date2 = new Date('2025-01-01T00:00:01Z');
      const uuid1 = generateUsageLogUuid('user-1', 'gpt-4', date1);
      const uuid2 = generateUsageLogUuid('user-1', 'gpt-4', date2);
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('generatePendingMemoryUuid', () => {
    it('should generate consistent UUIDs for the same inputs', () => {
      const uuid1 = generatePendingMemoryUuid('persona-1', 'personality-1', 'hello world');
      const uuid2 = generatePendingMemoryUuid('persona-1', 'personality-1', 'hello world');
      expect(uuid1).toBe(uuid2);
    });

    it('should generate different UUIDs for different text content', () => {
      const uuid1 = generatePendingMemoryUuid('persona-1', 'personality-1', 'hello world');
      const uuid2 = generatePendingMemoryUuid('persona-1', 'personality-1', 'goodbye world');
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('generateMemoryFactUuid', () => {
    it('should generate consistent UUIDs for the same statement in the same scope', () => {
      const uuid1 = generateMemoryFactUuid('personality-1', 'persona-1', 'Alice likes tea');
      const uuid2 = generateMemoryFactUuid('personality-1', 'persona-1', 'Alice likes tea');
      expect(uuid1).toBe(uuid2);
    });

    it('should distinguish persona-scoped from world facts', () => {
      const scoped = generateMemoryFactUuid('personality-1', 'persona-1', 'Alice likes tea');
      const world = generateMemoryFactUuid('personality-1', null, 'Alice likes tea');
      expect(scoped).not.toBe(world);
    });

    it('should generate different UUIDs for different statements', () => {
      const uuid1 = generateMemoryFactUuid('personality-1', 'persona-1', 'Alice likes tea');
      const uuid2 = generateMemoryFactUuid('personality-1', 'persona-1', 'Alice likes coffee');
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('generateFactExtractionJobUuid', () => {
    it('should generate consistent UUIDs for the same batch window', () => {
      const uuid1 = generateFactExtractionJobUuid('chan-1', 'personality-1', 'mem-1');
      const uuid2 = generateFactExtractionJobUuid('chan-1', 'personality-1', 'mem-1');
      expect(uuid1).toBe(uuid2);
    });

    it('should generate different UUIDs for different window anchors', () => {
      const uuid1 = generateFactExtractionJobUuid('chan-1', 'personality-1', 'mem-1');
      const uuid2 = generateFactExtractionJobUuid('chan-1', 'personality-1', 'mem-2');
      expect(uuid1).not.toBe(uuid2);
    });

    it('should generate different UUIDs across channels', () => {
      const uuid1 = generateFactExtractionJobUuid('chan-1', 'personality-1', 'mem-1');
      const uuid2 = generateFactExtractionJobUuid('chan-2', 'personality-1', 'mem-1');
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('generateUserApiKeyUuid', () => {
    it('should generate consistent UUIDs for the same inputs', () => {
      const uuid1 = generateUserApiKeyUuid('user-1', 'openrouter');
      const uuid2 = generateUserApiKeyUuid('user-1', 'openrouter');
      expect(uuid1).toBe(uuid2);
    });

    it('should generate different UUIDs for different providers', () => {
      const uuid1 = generateUserApiKeyUuid('user-1', 'openrouter');
      const uuid2 = generateUserApiKeyUuid('user-1', 'openai');
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('generateExportJobUuid', () => {
    it('should generate consistent UUIDs for the same inputs', () => {
      const uuid1 = generateExportJobUuid('user-1', 'my-shape', 'shapes_inc', 'json');
      const uuid2 = generateExportJobUuid('user-1', 'my-shape', 'shapes_inc', 'json');
      expect(uuid1).toBe(uuid2);
    });

    it('should generate different UUIDs for different formats', () => {
      const jsonId = generateExportJobUuid('user-1', 'my-shape', 'shapes_inc', 'json');
      const mdId = generateExportJobUuid('user-1', 'my-shape', 'shapes_inc', 'markdown');
      expect(jsonId).not.toBe(mdId);
    });

    it('should generate different UUIDs for different slugs', () => {
      const uuid1 = generateExportJobUuid('user-1', 'shape-a', 'shapes_inc', 'json');
      const uuid2 = generateExportJobUuid('user-1', 'shape-b', 'shapes_inc', 'json');
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('isUuidFormat', () => {
    it('should return true for valid UUIDs', () => {
      expect(isUuidFormat('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isUuidFormat('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
      expect(isUuidFormat('d3ba618d-42e0-5a62-9fdf-31c10da1a7a7')).toBe(true);
    });

    it('should return true for uppercase UUIDs', () => {
      expect(isUuidFormat('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
    });

    it('should return false for non-UUID strings', () => {
      expect(isUuidFormat('not-a-uuid')).toBe(false);
      expect(isUuidFormat('personality-name')).toBe(false);
      expect(isUuidFormat('')).toBe(false);
      expect(isUuidFormat('123456')).toBe(false);
    });

    it('should return false for malformed UUIDs', () => {
      // Missing segment
      expect(isUuidFormat('550e8400-e29b-41d4-a716')).toBe(false);
      // Wrong separator
      expect(isUuidFormat('550e8400_e29b_41d4_a716_446655440000')).toBe(false);
      // Wrong length
      expect(isUuidFormat('550e8400-e29b-41d4-a716-44665544000')).toBe(false);
      // Extra characters
      expect(isUuidFormat('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false);
    });

    it('should correctly identify generated UUIDs', () => {
      const uuid = generateUserUuid('test-user');
      expect(isUuidFormat(uuid)).toBe(true);
    });
  });

  describe('newLlmConfigId / newTtsConfigId (UUIDv7 generators)', () => {
    it('produces valid RFC 4122 UUID strings', () => {
      expect(isUuidFormat(newLlmConfigId())).toBe(true);
      expect(isUuidFormat(newTtsConfigId())).toBe(true);
    });

    it('returns a different UUID on each call (random tail)', () => {
      const a = newLlmConfigId();
      const b = newLlmConfigId();
      expect(a).not.toBe(b);

      const c = newTtsConfigId();
      const d = newTtsConfigId();
      expect(c).not.toBe(d);
    });

    it('encodes version 7 in the version nibble', () => {
      // UUIDv7 puts `7` in the version slot (13th hex char, after the 3rd dash):
      // xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
      const id = newTtsConfigId();
      expect(id[14]).toBe('7');
      const id2 = newLlmConfigId();
      expect(id2[14]).toBe('7');
    });

    it('newTtsConfigId and newLlmConfigId produce non-overlapping ids', () => {
      // Same v7 spec, but they should never collide because they're random
      // — sanity check that they're distinct generator instances rather
      // than aliases to the same memoized value.
      const ttsIds = new Set(Array.from({ length: 100 }, () => newTtsConfigId()));
      const llmIds = new Set(Array.from({ length: 100 }, () => newLlmConfigId()));
      const intersection = [...ttsIds].filter(id => llmIds.has(id));
      expect(intersection).toHaveLength(0);
      expect(ttsIds.size).toBe(100); // all unique
      expect(llmIds.size).toBe(100);
    });
  });

  describe('generateSystemGlobalTtsConfigUuid', () => {
    it('returns the same UUID for the same name (deterministic)', () => {
      const id1 = generateSystemGlobalTtsConfigUuid('kyutai-self-hosted');
      const id2 = generateSystemGlobalTtsConfigUuid('kyutai-self-hosted');
      expect(id1).toBe(id2);
    });

    it('returns different UUIDs for different names', () => {
      const id1 = generateSystemGlobalTtsConfigUuid('kyutai-self-hosted');
      const id2 = generateSystemGlobalTtsConfigUuid('elevenlabs-multilingual-v2');
      expect(id1).not.toBe(id2);
    });

    it('returns a valid v5 UUID format', () => {
      const id = generateSystemGlobalTtsConfigUuid('kyutai-self-hosted');
      // v5 UUIDs have version=5 in the 13th character (0-indexed position 14)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('returns the documented stable UUIDs for the 3 well-known names', () => {
      // These literals are pasted into the recovery migration SQL — assert
      // they don't drift. If this test fails, either the namespace or the
      // seed format changed; investigate before regenerating the migration.
      expect(generateSystemGlobalTtsConfigUuid('kyutai-self-hosted')).toBe(
        '50411d3c-cc98-5f39-839e-abd4fb84b0c8'
      );
      expect(generateSystemGlobalTtsConfigUuid('elevenlabs-multilingual-v2')).toBe(
        '845d224f-ad28-5ce1-8b27-f5588d3ae2d1'
      );
      expect(generateSystemGlobalTtsConfigUuid('mistral-voxtral-mini')).toBe(
        '8aa02cad-2c39-5b5b-9d37-482aacb7788d'
      );
    });
  });

  describe('generateSystemGlobalLlmConfigUuid', () => {
    it('returns the same UUID for the same name (deterministic)', () => {
      const id1 = generateSystemGlobalLlmConfigUuid('claude-sonnet-default');
      const id2 = generateSystemGlobalLlmConfigUuid('claude-sonnet-default');
      expect(id1).toBe(id2);
    });

    it('returns a valid v5 UUID format', () => {
      const id = generateSystemGlobalLlmConfigUuid('claude-sonnet-default');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('uses a different name-seed prefix than TTS — same name produces a different UUID', () => {
      // Both helpers use TZUROT_NAMESPACE (shared); separation comes from
      // the name-seed prefix (`tts_config_global:` vs `llm_config_global:`)
      // passed to uuidv5 alongside the shared namespace.
      const ttsId = generateSystemGlobalTtsConfigUuid('shared-name');
      const llmId = generateSystemGlobalLlmConfigUuid('shared-name');
      expect(ttsId).not.toBe(llmId);
    });

    it('pins the exact UUIDs for the seeded vision system-global names (drift guard)', () => {
      // These IDs are baked into VisionConfigBootstrap's createMany seed. If this helper
      // ever changes, the seeded rows would orphan (db-sync `llm_configs_owner_id_name_key`
      // collisions) — this test fails loudly so the change is caught before it ships.
      // Recompute + re-pin ONLY alongside a recovery migration that realigns existing rows.
      expect(generateSystemGlobalLlmConfigUuid('vision-default')).toBe(
        '56af57f3-7446-560b-858e-8c1c672df9c0'
      );
      expect(generateSystemGlobalLlmConfigUuid('vision-free-default')).toBe(
        'b0bdc63b-e081-5ed7-a2cf-276e4f959f70'
      );
    });
  });

  describe('generateByokTtsConfigUuid', () => {
    const TEST_OWNER = '00000000-0000-0000-0000-000000000001';

    it('returns the same UUID for the same (ownerId, provider) tuple (deterministic)', () => {
      const id1 = generateByokTtsConfigUuid(TEST_OWNER, 'elevenlabs');
      const id2 = generateByokTtsConfigUuid(TEST_OWNER, 'elevenlabs');
      expect(id1).toBe(id2);
    });

    it('different ownerId produces different UUID', () => {
      const id1 = generateByokTtsConfigUuid(TEST_OWNER, 'elevenlabs');
      const id2 = generateByokTtsConfigUuid('00000000-0000-0000-0000-000000000002', 'elevenlabs');
      expect(id1).not.toBe(id2);
    });

    it('different provider produces different UUID', () => {
      const id1 = generateByokTtsConfigUuid(TEST_OWNER, 'elevenlabs');
      const id2 = generateByokTtsConfigUuid(TEST_OWNER, 'mistral');
      expect(id1).not.toBe(id2);
    });

    it('returns a valid v5 UUID format', () => {
      const id = generateByokTtsConfigUuid(TEST_OWNER, 'elevenlabs');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('returns the documented stable UUID for a known (ownerId, provider) pair', () => {
      // Pinned values for the test owner. If this test fails, either the
      // namespace or seed-prefix format changed; investigate before the
      // recovery script runs against any data. Same cross-pinning pattern
      // as PR #969's system-global UUIDs.
      expect(generateByokTtsConfigUuid(TEST_OWNER, 'elevenlabs')).toBe(
        '888c58ff-d8f4-5f82-9c75-33aa39b7b905'
      );
      expect(generateByokTtsConfigUuid(TEST_OWNER, 'mistral')).toBe(
        '65fa408e-bd23-5f2e-baa0-8e2b0ca7a944'
      );
    });
  });

  describe('generateByokLlmConfigUuid', () => {
    const TEST_OWNER = '00000000-0000-0000-0000-000000000001';

    it('returns the same UUID for the same (ownerId, provider) tuple (deterministic)', () => {
      const id1 = generateByokLlmConfigUuid(TEST_OWNER, 'openrouter');
      const id2 = generateByokLlmConfigUuid(TEST_OWNER, 'openrouter');
      expect(id1).toBe(id2);
    });

    it('different ownerId produces different UUID', () => {
      const id1 = generateByokLlmConfigUuid(TEST_OWNER, 'openrouter');
      const id2 = generateByokLlmConfigUuid('00000000-0000-0000-0000-000000000002', 'openrouter');
      expect(id1).not.toBe(id2);
    });

    // No "different provider produces different UUID" test for LLM today —
    // `ByokLlmProvider` has only one member ('openrouter') currently. Add
    // back when the union widens (e.g., when a 2nd BYOK LLM provider lands).

    it('returns a valid v5 UUID format', () => {
      const id = generateByokLlmConfigUuid(TEST_OWNER, 'openrouter');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('uses a different name-seed prefix than TTS — produces different UUIDs even with overlapping inputs', () => {
      // `tts_config_byok:` vs `llm_config_byok:` — separation by name-seed
      // prefix (TZUROT_NAMESPACE is shared across all helpers). Each side
      // uses its respective union's first member; the namespace prefix is
      // what makes the UUIDs differ regardless of the literal input.
      const ttsId = generateByokTtsConfigUuid(TEST_OWNER, 'elevenlabs');
      const llmId = generateByokLlmConfigUuid(TEST_OWNER, 'openrouter');
      expect(ttsId).not.toBe(llmId);
    });

    it('returns the documented stable UUID for a known (ownerId, provider) pair', () => {
      expect(generateByokLlmConfigUuid(TEST_OWNER, 'openrouter')).toBe(
        '287bae65-55ef-591a-9cd1-c567b5d3e2e1'
      );
    });
  });
});
