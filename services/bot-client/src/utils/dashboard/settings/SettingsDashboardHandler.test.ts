/**
 * Tests for SettingsDashboardHandler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSettingsDashboard,
  handleSettingsSelectMenu,
  handleSettingsButton,
  handleSettingsModal,
  getUpdateHandler,
} from './SettingsDashboardHandler.js';
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

  describe('handleSettingsSelectMenu', () => {
    const createSelectInteraction = (
      customId: string,
      selectedValue: string,
      userId = 'user-123'
    ) => ({
      customId,
      user: { id: userId },
      values: [selectedValue],
      reply: vi.fn(),
      update: vi.fn(),
    });

    it('should return early for invalid customId', async () => {
      const interaction = createSelectInteraction('invalid', 'maxMessages');
      const config = createTestConfig();
      const updateHandler = vi.fn();

      await handleSettingsSelectMenu(interaction as never, config, updateHandler);

      expect(interaction.reply).not.toHaveBeenCalled();
      expect(interaction.update).not.toHaveBeenCalled();
    });

    it('should reply with expired message when session not found', async () => {
      mockSessionManager.get.mockReturnValue(null);

      const interaction = createSelectInteraction('test-settings::select::entity-1', 'maxMessages');
      const config = createTestConfig();
      const updateHandler = vi.fn();

      await handleSettingsSelectMenu(interaction as never, config, updateHandler);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('expired'),
        })
      );
    });

    it('should reject when session belongs to another user', async () => {
      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'other-user',
          entityId: 'entity-1',
          data: createTestData(),
          view: 'overview',
        },
      });

      const interaction = createSelectInteraction(
        'test-settings::select::entity-1',
        'maxMessages',
        'user-123'
      );
      const config = createTestConfig();
      const updateHandler = vi.fn();

      await handleSettingsSelectMenu(interaction as never, config, updateHandler);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('another user'),
        })
      );
    });

    it('should reply with unknown setting for invalid setting ID', async () => {
      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-123',
          entityId: 'entity-1',
          data: createTestData(),
          view: 'overview',
        },
      });

      const interaction = createSelectInteraction(
        'test-settings::select::entity-1',
        'nonexistent-setting'
      );
      const config = createTestConfig();
      const updateHandler = vi.fn();

      await handleSettingsSelectMenu(interaction as never, config, updateHandler);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Unknown setting'),
        })
      );
    });

    it('should update to setting view when valid setting selected', async () => {
      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-123',
          entityId: 'entity-1',
          data: createTestData(),
          view: 'overview',
        },
      });

      const interaction = createSelectInteraction('test-settings::select::entity-1', 'maxMessages');
      const config = createTestConfig();
      const updateHandler = vi.fn();

      await handleSettingsSelectMenu(interaction as never, config, updateHandler);

      expect(interaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });
  });

  describe('handleSettingsButton', () => {
    const createButtonInteraction = (customId: string, userId = 'user-123') => ({
      customId,
      user: { id: userId },
      reply: vi.fn(),
      update: vi.fn(),
      showModal: vi.fn(),
    });

    it('should return early for invalid customId', async () => {
      const interaction = createButtonInteraction('invalid');
      const config = createTestConfig();
      const updateHandler = vi.fn();

      await handleSettingsButton(interaction as never, config, updateHandler);

      expect(interaction.reply).not.toHaveBeenCalled();
      expect(interaction.update).not.toHaveBeenCalled();
    });

    it('should reply with expired message when session not found', async () => {
      mockSessionManager.get.mockReturnValue(null);

      const interaction = createButtonInteraction('test-settings::back::entity-1');
      const config = createTestConfig();
      const updateHandler = vi.fn();

      await handleSettingsButton(interaction as never, config, updateHandler);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('expired'),
        })
      );
    });

    it('should reject when session belongs to another user', async () => {
      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'other-user',
          entityId: 'entity-1',
          data: createTestData(),
          view: 'setting',
        },
      });

      const interaction = createButtonInteraction('test-settings::back::entity-1', 'user-123');
      const config = createTestConfig();
      const updateHandler = vi.fn();

      await handleSettingsButton(interaction as never, config, updateHandler);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('another user'),
        })
      );
    });

    describe('back button', () => {
      it('should return to overview', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxMessages',
          },
        });

        const interaction = createButtonInteraction('test-settings::back::entity-1');
        const config = createTestConfig();
        const updateHandler = vi.fn();

        await handleSettingsButton(interaction as never, config, updateHandler);

        expect(interaction.update).toHaveBeenCalledWith(
          expect.objectContaining({
            embeds: expect.any(Array),
            components: expect.any(Array),
          })
        );
      });
    });

    describe('close button', () => {
      it('should delete session and update message', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'overview',
          },
        });

        const interaction = createButtonInteraction('test-settings::close::entity-1');
        const config = createTestConfig();
        const updateHandler = vi.fn();

        await handleSettingsButton(interaction as never, config, updateHandler);

        expect(mockSessionManager.delete).toHaveBeenCalled();
        expect(interaction.update).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining('closed'),
            embeds: [],
            components: [],
          })
        );
      });
    });

    describe('set button', () => {
      it('should return early when extra data is missing', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
          },
        });

        const interaction = createButtonInteraction('test-settings::set::entity-1');
        const config = createTestConfig();
        const updateHandler = vi.fn();

        await handleSettingsButton(interaction as never, config, updateHandler);

        expect(interaction.reply).not.toHaveBeenCalled();
        expect(interaction.update).not.toHaveBeenCalled();
      });

      it('should reply with unknown setting for invalid setting ID', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
          },
        });

        const interaction = createButtonInteraction(
          'test-settings::set::entity-1::nonexistent:true'
        );
        const config = createTestConfig();
        const updateHandler = vi.fn();

        await handleSettingsButton(interaction as never, config, updateHandler);

        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining('Unknown setting'),
          })
        );
      });

      it('should parse "auto" value as null', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxMessages',
          },
        });

        const interaction = createButtonInteraction(
          'test-settings::set::entity-1::maxMessages:auto'
        );
        const config = createTestConfig();
        const updateHandler = vi
          .fn()
          .mockResolvedValue({ success: true, newData: createTestData() });

        await handleSettingsButton(interaction as never, config, updateHandler);

        expect(updateHandler).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          'maxMessages',
          null
        );
      });

      it('should reply with error when update fails', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxMessages',
          },
        });

        const interaction = createButtonInteraction(
          'test-settings::set::entity-1::maxMessages:auto'
        );
        const config = createTestConfig();
        const updateHandler = vi.fn().mockResolvedValue({ success: false, error: 'API error' });

        await handleSettingsButton(interaction as never, config, updateHandler);

        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining('API error'),
          })
        );
      });

      it('should update view after successful change', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxMessages',
          },
        });

        const interaction = createButtonInteraction(
          'test-settings::set::entity-1::maxMessages:auto'
        );
        const config = createTestConfig();
        const newData = createTestData();
        newData.maxMessages.localValue = null;
        const updateHandler = vi.fn().mockResolvedValue({ success: true, newData });

        await handleSettingsButton(interaction as never, config, updateHandler);

        expect(interaction.update).toHaveBeenCalled();
      });
    });

    describe('edit button', () => {
      it('should return early when setting ID is missing', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
          },
        });

        const interaction = createButtonInteraction('test-settings::edit::entity-1');
        const config = createTestConfig();
        const updateHandler = vi.fn();

        await handleSettingsButton(interaction as never, config, updateHandler);

        expect(interaction.showModal).not.toHaveBeenCalled();
      });

      it('should reply with unknown setting for invalid setting ID', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
          },
        });

        const interaction = createButtonInteraction('test-settings::edit::entity-1::nonexistent');
        const config = createTestConfig();
        const updateHandler = vi.fn();

        await handleSettingsButton(interaction as never, config, updateHandler);

        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining('Unknown setting'),
          })
        );
      });

      it('should show modal for valid setting', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
          },
        });

        const interaction = createButtonInteraction('test-settings::edit::entity-1::maxMessages');
        const config = createTestConfig();
        const updateHandler = vi.fn();

        await handleSettingsButton(interaction as never, config, updateHandler);

        expect(interaction.showModal).toHaveBeenCalled();
      });
    });
  });

  describe('handleSettingsModal', () => {
    const createModalInteraction = (customId: string, inputValue: string, userId = 'user-123') => ({
      customId,
      user: { id: userId },
      fields: {
        getTextInputValue: vi.fn().mockReturnValue(inputValue),
      },
      reply: vi.fn(),
      deferUpdate: vi.fn(),
      editReply: vi.fn(),
    });

    it('should return early for invalid customId', async () => {
      const interaction = createModalInteraction('invalid', '50');
      const config = createTestConfig();
      const updateHandler = vi.fn();

      await handleSettingsModal(interaction as never, config, updateHandler);

      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should reply with invalid submission when setting ID is missing', async () => {
      const interaction = createModalInteraction('test-settings::modal::entity-1', '50');
      const config = createTestConfig();
      const updateHandler = vi.fn();

      await handleSettingsModal(interaction as never, config, updateHandler);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Invalid modal'),
        })
      );
    });

    it('should reply with expired message when session not found', async () => {
      mockSessionManager.get.mockReturnValue(null);

      const interaction = createModalInteraction(
        'test-settings::modal::entity-1::maxMessages',
        '50'
      );
      const config = createTestConfig();
      const updateHandler = vi.fn();

      await handleSettingsModal(interaction as never, config, updateHandler);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('expired'),
        })
      );
    });

    it('should reply with unknown setting for invalid setting ID', async () => {
      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-123',
          entityId: 'entity-1',
          data: createTestData(),
          view: 'setting',
        },
      });

      const interaction = createModalInteraction(
        'test-settings::modal::entity-1::nonexistent',
        '50'
      );
      const config = createTestConfig();
      const updateHandler = vi.fn();

      await handleSettingsModal(interaction as never, config, updateHandler);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Unknown setting'),
        })
      );
    });

    describe('numeric input parsing', () => {
      it('should parse valid number', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxMessages',
          },
        });

        const interaction = createModalInteraction(
          'test-settings::modal::entity-1::maxMessages',
          '75'
        );
        const config = createTestConfig();
        const updateHandler = vi
          .fn()
          .mockResolvedValue({ success: true, newData: createTestData() });

        await handleSettingsModal(interaction as never, config, updateHandler);

        expect(updateHandler).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          'maxMessages',
          75
        );
      });

      it('should parse "auto" as null', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxMessages',
          },
        });

        const interaction = createModalInteraction(
          'test-settings::modal::entity-1::maxMessages',
          'auto'
        );
        const config = createTestConfig();
        const updateHandler = vi
          .fn()
          .mockResolvedValue({ success: true, newData: createTestData() });

        await handleSettingsModal(interaction as never, config, updateHandler);

        expect(updateHandler).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          'maxMessages',
          null
        );
      });

      it('should parse empty string as null', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxMessages',
          },
        });

        const interaction = createModalInteraction(
          'test-settings::modal::entity-1::maxMessages',
          '  '
        );
        const config = createTestConfig();
        const updateHandler = vi
          .fn()
          .mockResolvedValue({ success: true, newData: createTestData() });

        await handleSettingsModal(interaction as never, config, updateHandler);

        expect(updateHandler).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          'maxMessages',
          null
        );
      });

      it('should reject invalid number', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxMessages',
          },
        });

        const interaction = createModalInteraction(
          'test-settings::modal::entity-1::maxMessages',
          'abc'
        );
        const config = createTestConfig();
        const updateHandler = vi.fn();

        await handleSettingsModal(interaction as never, config, updateHandler);

        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining('Invalid number'),
          })
        );
        expect(updateHandler).not.toHaveBeenCalled();
      });

      it('should reject number below minimum', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxMessages',
          },
        });

        const interaction = createModalInteraction(
          'test-settings::modal::entity-1::maxMessages',
          '0'
        );
        const config = createTestConfig();
        const updateHandler = vi.fn();

        await handleSettingsModal(interaction as never, config, updateHandler);

        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining('between'),
          })
        );
        expect(updateHandler).not.toHaveBeenCalled();
      });

      it('should reject number above maximum', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxMessages',
          },
        });

        const interaction = createModalInteraction(
          'test-settings::modal::entity-1::maxMessages',
          '999'
        );
        const config = createTestConfig();
        const updateHandler = vi.fn();

        await handleSettingsModal(interaction as never, config, updateHandler);

        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining('between'),
          })
        );
        expect(updateHandler).not.toHaveBeenCalled();
      });
    });

    describe('duration input parsing', () => {
      it('should parse hours format', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxAge',
          },
        });

        const interaction = createModalInteraction('test-settings::modal::entity-1::maxAge', '2h');
        const config = createTestConfig();
        const updateHandler = vi
          .fn()
          .mockResolvedValue({ success: true, newData: createTestData() });

        await handleSettingsModal(interaction as never, config, updateHandler);

        expect(updateHandler).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          'maxAge',
          7200 // 2 hours in seconds
        );
      });

      it('should parse minutes format', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxAge',
          },
        });

        const interaction = createModalInteraction('test-settings::modal::entity-1::maxAge', '30m');
        const config = createTestConfig();
        const updateHandler = vi
          .fn()
          .mockResolvedValue({ success: true, newData: createTestData() });

        await handleSettingsModal(interaction as never, config, updateHandler);

        expect(updateHandler).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          'maxAge',
          1800 // 30 minutes in seconds
        );
      });

      it('should parse days format', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxAge',
          },
        });

        const interaction = createModalInteraction('test-settings::modal::entity-1::maxAge', '1d');
        const config = createTestConfig();
        const updateHandler = vi
          .fn()
          .mockResolvedValue({ success: true, newData: createTestData() });

        await handleSettingsModal(interaction as never, config, updateHandler);

        expect(updateHandler).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          'maxAge',
          86400 // 1 day in seconds
        );
      });

      it('should parse "off" as -1 sentinel', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxAge',
          },
        });

        const interaction = createModalInteraction('test-settings::modal::entity-1::maxAge', 'off');
        const config = createTestConfig();
        const updateHandler = vi
          .fn()
          .mockResolvedValue({ success: true, newData: createTestData() });

        await handleSettingsModal(interaction as never, config, updateHandler);

        expect(updateHandler).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          'maxAge',
          -1
        );
      });

      it('should parse "disabled" as -1 sentinel', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxAge',
          },
        });

        const interaction = createModalInteraction(
          'test-settings::modal::entity-1::maxAge',
          'disabled'
        );
        const config = createTestConfig();
        const updateHandler = vi
          .fn()
          .mockResolvedValue({ success: true, newData: createTestData() });

        await handleSettingsModal(interaction as never, config, updateHandler);

        expect(updateHandler).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          'maxAge',
          -1
        );
      });

      it('should reject invalid duration format', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxAge',
          },
        });

        const interaction = createModalInteraction('test-settings::modal::entity-1::maxAge', 'abc');
        const config = createTestConfig();
        const updateHandler = vi.fn();

        await handleSettingsModal(interaction as never, config, updateHandler);

        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining('Invalid duration'),
          })
        );
        expect(updateHandler).not.toHaveBeenCalled();
      });

      it('should reject duration less than 1 minute', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxAge',
          },
        });

        const interaction = createModalInteraction('test-settings::modal::entity-1::maxAge', '30s');
        const config = createTestConfig();
        const updateHandler = vi.fn();

        await handleSettingsModal(interaction as never, config, updateHandler);

        expect(interaction.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining('at least 1 minute'),
          })
        );
        expect(updateHandler).not.toHaveBeenCalled();
      });

      it('should parse long form units (hours, minutes, days)', async () => {
        mockSessionManager.get.mockReturnValue({
          data: {
            userId: 'user-123',
            entityId: 'entity-1',
            data: createTestData(),
            view: 'setting',
            activeSetting: 'maxAge',
          },
        });

        const config = createTestConfig();
        const updateHandler = vi
          .fn()
          .mockResolvedValue({ success: true, newData: createTestData() });

        // Test "hours"
        const interaction1 = createModalInteraction(
          'test-settings::modal::entity-1::maxAge',
          '2 hours'
        );
        await handleSettingsModal(interaction1 as never, config, updateHandler);
        expect(updateHandler).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.anything(),
          'maxAge',
          7200
        );

        // Test "minutes"
        const interaction2 = createModalInteraction(
          'test-settings::modal::entity-1::maxAge',
          '90 minutes'
        );
        await handleSettingsModal(interaction2 as never, config, updateHandler);
        expect(updateHandler).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.anything(),
          'maxAge',
          5400
        );

        // Test "day"
        const interaction3 = createModalInteraction(
          'test-settings::modal::entity-1::maxAge',
          '1 day'
        );
        await handleSettingsModal(interaction3 as never, config, updateHandler);
        expect(updateHandler).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.anything(),
          'maxAge',
          86400
        );
      });
    });

    it('should defer update and call handler', async () => {
      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-123',
          entityId: 'entity-1',
          data: createTestData(),
          view: 'setting',
          activeSetting: 'maxMessages',
        },
      });

      const interaction = createModalInteraction(
        'test-settings::modal::entity-1::maxMessages',
        '50'
      );
      const config = createTestConfig();
      const updateHandler = vi.fn().mockResolvedValue({ success: true, newData: createTestData() });

      await handleSettingsModal(interaction as never, config, updateHandler);

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(updateHandler).toHaveBeenCalled();
    });

    it('should update view after successful change', async () => {
      mockSessionManager.get.mockReturnValue({
        data: {
          userId: 'user-123',
          entityId: 'entity-1',
          data: createTestData(),
          view: 'setting',
          activeSetting: 'maxMessages',
        },
      });

      const interaction = createModalInteraction(
        'test-settings::modal::entity-1::maxMessages',
        '50'
      );
      const config = createTestConfig();
      const newData = createTestData();
      newData.maxMessages.localValue = 50;
      const updateHandler = vi.fn().mockResolvedValue({ success: true, newData });

      await handleSettingsModal(interaction as never, config, updateHandler);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });
  });

  describe('getUpdateHandler', () => {
    it('should return undefined for unknown session', () => {
      const handler = getUpdateHandler('unknown-user', 'unknown-type', 'unknown-entity');
      expect(handler).toBeUndefined();
    });

    it('should return handler after dashboard creation', async () => {
      const config = createTestConfig();
      const data = createTestData();
      const interaction = createMockInteraction({ channelId: 'channel-123' });
      const updateHandler = vi.fn();

      await createSettingsDashboard(interaction as never, {
        config,
        data,
        entityId: 'test-entity',
        entityName: 'Test',
        userId: 'user-123',
        updateHandler,
      });

      const retrieved = getUpdateHandler('user-123', 'test-settings', 'test-entity');
      expect(retrieved).toBe(updateHandler);
    });
  });
});
