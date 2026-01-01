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
  generateUserPersonalityConfigUuid,
  generateConversationHistoryUuid,
  generateChannelSettingsUuid,
  generateMemoryDuplicateUuid,
  generateMemoryChunkGroupUuid,
  generateBotSettingUuid,
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
});
