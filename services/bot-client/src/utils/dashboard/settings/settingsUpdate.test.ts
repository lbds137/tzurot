/**
 * Tests for shared mapSettingToApiUpdate utility
 */

import { describe, it, expect, vi } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import { mapSettingToApiUpdate, handleSetButton } from './settingsUpdate.js';
import { ALL_SETTINGS, EXTENDED_CONTEXT_SETTINGS } from './settingsConfig.js';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  DashboardView,
} from './types.js';

vi.mock('./SettingsSessionStorage.js', () => ({
  storeSession: vi.fn().mockResolvedValue(undefined),
}));

describe('mapSettingToApiUpdate', () => {
  describe('maxMessages', () => {
    it('should map numeric value', () => {
      expect(mapSettingToApiUpdate('maxMessages', 75)).toEqual({ maxMessages: 75 });
    });

    it('should map null (auto/clear)', () => {
      expect(mapSettingToApiUpdate('maxMessages', null)).toEqual({ maxMessages: null });
    });
  });

  describe('maxAge', () => {
    it('should map numeric value (seconds)', () => {
      expect(mapSettingToApiUpdate('maxAge', 3600)).toEqual({ maxAge: 3600 });
    });

    it('should map null (auto) to null', () => {
      expect(mapSettingToApiUpdate('maxAge', null)).toEqual({ maxAge: null });
    });

    it('should pass -1 (off) through as the wire OFF sentinel — distinct from auto', () => {
      // Collapsing -1 to null was the off-vs-inherit bug: "off" silently
      // meant "inherit" because null on the wire clears the override.
      expect(mapSettingToApiUpdate('maxAge', -1)).toEqual({ maxAge: -1 });
    });
  });

  describe('maxImages', () => {
    it('should map numeric value', () => {
      expect(mapSettingToApiUpdate('maxImages', 5)).toEqual({ maxImages: 5 });
    });

    it('should map null (auto/clear)', () => {
      expect(mapSettingToApiUpdate('maxImages', null)).toEqual({ maxImages: null });
    });
  });

  describe('crossChannelHistoryEnabled', () => {
    it('should map boolean value', () => {
      expect(mapSettingToApiUpdate('crossChannelHistoryEnabled', true)).toEqual({
        crossChannelHistoryEnabled: true,
      });
    });

    it('should map null (auto/clear)', () => {
      expect(mapSettingToApiUpdate('crossChannelHistoryEnabled', null)).toEqual({
        crossChannelHistoryEnabled: null,
      });
    });
  });

  describe('retired settings', () => {
    it('returns null for the removed focusModeEnabled knob', () => {
      expect(mapSettingToApiUpdate('focusModeEnabled', true)).toBeNull();
    });
  });

  describe('shareLtmAcrossPersonalities', () => {
    it('should map boolean value', () => {
      expect(mapSettingToApiUpdate('shareLtmAcrossPersonalities', false)).toEqual({
        shareLtmAcrossPersonalities: false,
      });
    });
  });

  describe('memoryScoreThreshold', () => {
    it('should map numeric value', () => {
      expect(mapSettingToApiUpdate('memoryScoreThreshold', 0.7)).toEqual({
        memoryScoreThreshold: 0.7,
      });
    });

    it('should map null (auto/clear)', () => {
      expect(mapSettingToApiUpdate('memoryScoreThreshold', null)).toEqual({
        memoryScoreThreshold: null,
      });
    });
  });

  describe('memoryLimit', () => {
    it('should map numeric value', () => {
      expect(mapSettingToApiUpdate('memoryLimit', 50)).toEqual({
        memoryLimit: 50,
      });
    });

    it('should map null (auto/clear)', () => {
      expect(mapSettingToApiUpdate('memoryLimit', null)).toEqual({
        memoryLimit: null,
      });
    });
  });

  describe('showModelFooter', () => {
    it('should map boolean value', () => {
      expect(mapSettingToApiUpdate('showModelFooter', false)).toEqual({
        showModelFooter: false,
      });
    });

    it('should map null (auto/clear)', () => {
      expect(mapSettingToApiUpdate('showModelFooter', null)).toEqual({
        showModelFooter: null,
      });
    });
  });

  describe('unknown setting', () => {
    it('should return null for unrecognized setting ID', () => {
      expect(mapSettingToApiUpdate('unknownSetting', 42)).toBeNull();
    });
  });

  describe('completeness guard', () => {
    it('should handle every setting defined in ALL_SETTINGS', () => {
      for (const setting of ALL_SETTINGS) {
        const result = mapSettingToApiUpdate(setting.id, 'test-value');
        expect(result).not.toBeNull();
      }
    });
  });
});

describe('handleSetButton', () => {
  // Direct tests for the branches best pinned at the function seam (guards
  // and the update-result contract); the full ack-then-dispatch flow is
  // exercised through handleSettingsButton in SettingsDashboardHandler.test.ts.
  const config = {
    level: 'channel',
    entityType: 'test-settings',
    titlePrefix: 'Test',
    color: 0x5865f2,
    settings: EXTENDED_CONTEXT_SETTINGS,
  } as SettingsDashboardConfig;

  function makeSession(): SettingsDashboardSession {
    return {
      level: 'channel',
      entityId: 'entity-1',
      entityName: '#test',
      userId: 'user-123',
      messageId: 'msg-1',
      channelId: 'chan-1',
      lastActivityAt: new Date(),
      view: DashboardView.OVERVIEW,
      data: {
        maxMessages: {
          localValue: null,
          hasLocalOverride: false,
          effectiveValue: 50,
          source: 'admin',
          parentValue: 50,
        },
      },
    };
  }

  function makeInteraction() {
    return {
      user: { id: 'user-123' },
      followUp: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction & {
      followUp: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
    };
  }

  it('notifies and skips the update handler when extra is missing', async () => {
    const interaction = makeInteraction();
    const updateHandler = vi.fn();

    await handleSetButton(interaction, config, makeSession(), undefined, updateHandler);

    expect(updateHandler).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid button data') })
    );
  });

  it('rejects an unknown settingId before calling the update handler', async () => {
    const interaction = makeInteraction();
    const updateHandler = vi.fn();

    await handleSetButton(interaction, config, makeSession(), 'nonexistent:true', updateHandler);

    expect(updateHandler).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Unknown setting.' })
    );
  });

  it('parses auto to null and forwards it across the update seam', async () => {
    const interaction = makeInteraction();
    const updateHandler = vi.fn().mockResolvedValue({ success: true });

    await handleSetButton(interaction, config, makeSession(), 'maxMessages:auto', updateHandler);

    expect(updateHandler).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({ entityId: 'entity-1' }),
      'maxMessages',
      null
    );
  });

  it('surfaces the update handler failure without re-rendering', async () => {
    const interaction = makeInteraction();
    const updateHandler = vi.fn().mockResolvedValue({ success: false, error: 'API down' });

    await handleSetButton(interaction, config, makeSession(), 'maxMessages:25', updateHandler);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('API down') })
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});
