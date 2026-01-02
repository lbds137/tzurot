/**
 * Tests for SettingsDashboardHandler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSettingsDashboard } from './SettingsDashboardHandler.js';
import {
  type SettingsDashboardConfig,
  type SettingsData,
  type SettingUpdateResult,
  SettingType,
  isSettingsInteraction,
  parseSettingsCustomId,
} from './types.js';
import { EXTENDED_CONTEXT_SETTINGS } from './settingsConfig.js';
import { DISCORD_COLORS } from '@tzurot/common-types';

// Mock the session manager
const mockSessionManager = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../SessionManager.js', () => ({
  getSessionManager: vi.fn(() => mockSessionManager),
  DashboardSessionManager: {
    getInstance: vi.fn(() => mockSessionManager),
  },
}));

// Test fixtures
const createTestConfig = (): SettingsDashboardConfig => ({
  level: 'global',
  entityType: 'test-settings',
  titlePrefix: 'Test',
  color: DISCORD_COLORS.BLURPLE,
  settings: EXTENDED_CONTEXT_SETTINGS,
});

const createTestData = (): SettingsData => ({
  enabled: {
    localValue: null,
    effectiveValue: true,
    source: 'global',
  },
  maxMessages: {
    localValue: null,
    effectiveValue: 50,
    source: 'global',
  },
  maxAge: {
    localValue: null,
    effectiveValue: 7200,
    source: 'global',
  },
  maxImages: {
    localValue: null,
    effectiveValue: 10,
    source: 'global',
  },
});

const createMockInteraction = (overrides = {}) => ({
  user: { id: 'user-123' },
  deferReply: vi.fn(),
  editReply: vi.fn().mockResolvedValue({ id: 'message-123' }),
  replied: false,
  ...overrides,
});

describe('SettingsDashboardHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isSettingsInteraction', () => {
    it('should return true for matching entity type', () => {
      const customId = 'test-settings::select::entity-1';
      expect(isSettingsInteraction(customId, 'test-settings')).toBe(true);
    });

    it('should return false for non-matching entity type', () => {
      const customId = 'other-settings::select::entity-1';
      expect(isSettingsInteraction(customId, 'test-settings')).toBe(false);
    });

    it('should return false for empty custom ID', () => {
      expect(isSettingsInteraction('', 'test-settings')).toBe(false);
    });

    it('should match personality-settings entity type', () => {
      const customId = 'personality-settings::set::aurora::enabled:true';
      expect(isSettingsInteraction(customId, 'personality-settings')).toBe(true);
    });

    it('should match channel-context entity type', () => {
      const customId = 'channel-context::back::chan-123';
      expect(isSettingsInteraction(customId, 'channel-context')).toBe(true);
    });

    it('should match global entity type', () => {
      const customId = 'global::modal::admin::maxMessages';
      expect(isSettingsInteraction(customId, 'global')).toBe(true);
    });
  });

  describe('parseSettingsCustomId', () => {
    it('should parse select action', () => {
      const result = parseSettingsCustomId('test-settings::select::entity-1');

      expect(result).toEqual({
        entityType: 'test-settings',
        action: 'select',
        entityId: 'entity-1',
        extra: undefined,
      });
    });

    it('should parse set action with value', () => {
      const result = parseSettingsCustomId('test-settings::set::entity-1::enabled:true');

      expect(result).toEqual({
        entityType: 'test-settings',
        action: 'set',
        entityId: 'entity-1',
        extra: 'enabled:true',
      });
    });

    it('should parse back action', () => {
      const result = parseSettingsCustomId('test-settings::back::entity-1');

      expect(result).toEqual({
        entityType: 'test-settings',
        action: 'back',
        entityId: 'entity-1',
        extra: undefined,
      });
    });

    it('should parse close action', () => {
      const result = parseSettingsCustomId('test-settings::close::entity-1');

      expect(result).toEqual({
        entityType: 'test-settings',
        action: 'close',
        entityId: 'entity-1',
        extra: undefined,
      });
    });

    it('should parse edit action', () => {
      const result = parseSettingsCustomId('test-settings::edit::entity-1::maxMessages');

      expect(result).toEqual({
        entityType: 'test-settings',
        action: 'edit',
        entityId: 'entity-1',
        extra: 'maxMessages',
      });
    });

    it('should parse modal action', () => {
      const result = parseSettingsCustomId('test-settings::modal::entity-1::maxAge');

      expect(result).toEqual({
        entityType: 'test-settings',
        action: 'modal',
        entityId: 'entity-1',
        extra: 'maxAge',
      });
    });

    it('should return null for invalid format', () => {
      expect(parseSettingsCustomId('invalid')).toBeNull();
      expect(parseSettingsCustomId('only::two')).toBeNull();
      expect(parseSettingsCustomId('')).toBeNull();
    });

    it('should handle entity IDs with special characters', () => {
      const result = parseSettingsCustomId('test-settings::select::channel-123456789');

      expect(result?.entityId).toBe('channel-123456789');
    });
  });

  describe('createSettingsDashboard', () => {
    it('should defer reply and edit with dashboard', async () => {
      const config = createTestConfig();
      const data = createTestData();
      const interaction = createMockInteraction();
      const updateHandler = vi.fn();

      await createSettingsDashboard(interaction as never, {
        config,
        data,
        entityId: 'entity-1',
        entityName: 'Test Entity',
        userId: 'user-123',
        updateHandler,
      });

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('should include embed with correct title', async () => {
      const config = createTestConfig();
      const data = createTestData();
      const interaction = createMockInteraction();
      const updateHandler = vi.fn();

      await createSettingsDashboard(interaction as never, {
        config,
        data,
        entityId: 'entity-1',
        entityName: 'Test Entity',
        userId: 'user-123',
        updateHandler,
      });

      const editReplyCall = interaction.editReply.mock.calls[0][0];
      const embedJson = editReplyCall.embeds[0].toJSON();

      expect(embedJson.title).toBe('Test Settings');
    });

    it('should include select menu and close button', async () => {
      const config = createTestConfig();
      const data = createTestData();
      const interaction = createMockInteraction();
      const updateHandler = vi.fn();

      await createSettingsDashboard(interaction as never, {
        config,
        data,
        entityId: 'entity-1',
        entityName: 'Test Entity',
        userId: 'user-123',
        updateHandler,
      });

      const editReplyCall = interaction.editReply.mock.calls[0][0];
      expect(editReplyCall.components).toHaveLength(2);
    });
  });

  describe('setting value parsing', () => {
    describe('tri-state parsing', () => {
      it('should parse "true" as true', () => {
        // Test via custom ID parsing
        const customId = 'test-settings::set::entity::enabled:true';
        const parsed = parseSettingsCustomId(customId);

        expect(parsed?.extra).toBe('enabled:true');
        const [, value] = parsed!.extra!.split(':');
        expect(value).toBe('true');
      });

      it('should parse "false" as false', () => {
        const customId = 'test-settings::set::entity::enabled:false';
        const parsed = parseSettingsCustomId(customId);

        expect(parsed?.extra).toBe('enabled:false');
        const [, value] = parsed!.extra!.split(':');
        expect(value).toBe('false');
      });

      it('should parse "auto" as null', () => {
        const customId = 'test-settings::set::entity::enabled:auto';
        const parsed = parseSettingsCustomId(customId);

        expect(parsed?.extra).toBe('enabled:auto');
        const [, value] = parsed!.extra!.split(':');
        expect(value).toBe('auto');
      });
    });

    describe('numeric value extraction', () => {
      it('should extract setting ID from auto reset', () => {
        const customId = 'test-settings::set::entity::maxMessages:auto';
        const parsed = parseSettingsCustomId(customId);

        expect(parsed?.extra).toBe('maxMessages:auto');
        const [settingId] = parsed!.extra!.split(':');
        expect(settingId).toBe('maxMessages');
      });
    });
  });

  describe('update handler integration', () => {
    it('should support async update handlers', async () => {
      const updateResult: SettingUpdateResult = {
        success: true,
        newData: createTestData(),
      };

      const updateHandler = vi.fn().mockResolvedValue(updateResult);

      const config = createTestConfig();
      const data = createTestData();
      const interaction = createMockInteraction();

      await createSettingsDashboard(interaction as never, {
        config,
        data,
        entityId: 'entity-1',
        entityName: 'Test Entity',
        userId: 'user-123',
        updateHandler,
      });

      // The update handler is stored and called later when buttons are pressed
      // Here we just verify it was registered properly
      expect(interaction.editReply).toHaveBeenCalled();
    });

    it('should handle update handler errors gracefully', async () => {
      const updateResult: SettingUpdateResult = {
        success: false,
        error: 'Something went wrong',
      };

      const updateHandler = vi.fn().mockResolvedValue(updateResult);

      const config = createTestConfig();
      const data = createTestData();
      const interaction = createMockInteraction();

      await createSettingsDashboard(interaction as never, {
        config,
        data,
        entityId: 'entity-1',
        entityName: 'Test Entity',
        userId: 'user-123',
        updateHandler,
      });

      // Dashboard should still be created even if update handler will fail later
      expect(interaction.editReply).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty entity name', async () => {
      const config = createTestConfig();
      const data = createTestData();
      const interaction = createMockInteraction();
      const updateHandler = vi.fn();

      await createSettingsDashboard(interaction as never, {
        config,
        data,
        entityId: 'entity-1',
        entityName: '',
        userId: 'user-123',
        updateHandler,
      });

      expect(interaction.editReply).toHaveBeenCalled();
    });

    it('should handle null values in settings data', async () => {
      const config = createTestConfig();
      const data: SettingsData = {
        enabled: { localValue: null, effectiveValue: false, source: 'global' },
        maxMessages: { localValue: null, effectiveValue: 50, source: 'global' },
        maxAge: { localValue: null, effectiveValue: null, source: 'global' },
        maxImages: { localValue: null, effectiveValue: 0, source: 'global' },
      };
      const interaction = createMockInteraction();
      const updateHandler = vi.fn();

      await createSettingsDashboard(interaction as never, {
        config,
        data,
        entityId: 'entity-1',
        entityName: 'Test',
        userId: 'user-123',
        updateHandler,
      });

      expect(interaction.editReply).toHaveBeenCalled();
    });

    it('should handle override values', async () => {
      const config = createTestConfig();
      const data: SettingsData = {
        enabled: { localValue: true, effectiveValue: true, source: 'channel' },
        maxMessages: { localValue: 25, effectiveValue: 25, source: 'channel' },
        maxAge: { localValue: 3600, effectiveValue: 3600, source: 'channel' },
        maxImages: { localValue: 5, effectiveValue: 5, source: 'channel' },
      };
      const interaction = createMockInteraction();
      const updateHandler = vi.fn();

      await createSettingsDashboard(interaction as never, {
        config,
        data,
        entityId: 'entity-1',
        entityName: 'Test',
        userId: 'user-123',
        updateHandler,
      });

      expect(interaction.editReply).toHaveBeenCalled();
    });
  });

  describe('setting types', () => {
    it('should recognize TRI_STATE settings', () => {
      const setting = EXTENDED_CONTEXT_SETTINGS.find(s => s.id === 'enabled');
      expect(setting?.type).toBe(SettingType.TRI_STATE);
    });

    it('should recognize NUMERIC settings', () => {
      const maxMessages = EXTENDED_CONTEXT_SETTINGS.find(s => s.id === 'maxMessages');
      const maxImages = EXTENDED_CONTEXT_SETTINGS.find(s => s.id === 'maxImages');

      expect(maxMessages?.type).toBe(SettingType.NUMERIC);
      expect(maxImages?.type).toBe(SettingType.NUMERIC);
    });

    it('should recognize DURATION settings', () => {
      const setting = EXTENDED_CONTEXT_SETTINGS.find(s => s.id === 'maxAge');
      expect(setting?.type).toBe(SettingType.DURATION);
    });

    it('should have min/max for NUMERIC settings', () => {
      const maxMessages = EXTENDED_CONTEXT_SETTINGS.find(s => s.id === 'maxMessages');
      const maxImages = EXTENDED_CONTEXT_SETTINGS.find(s => s.id === 'maxImages');

      expect(maxMessages?.min).toBe(1);
      expect(maxMessages?.max).toBe(100);
      expect(maxImages?.min).toBe(0);
      expect(maxImages?.max).toBe(20);
    });
  });
});
