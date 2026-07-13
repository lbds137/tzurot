/**
 * Tests for the settings-dashboard button-row builders (extracted from
 * SettingsDashboardBuilder.test.ts alongside the module split).
 */

import { describe, it, expect } from 'vitest';
import { ButtonStyle } from 'discord.js';
import type { APIButtonComponentWithCustomId } from 'discord.js';
import {
  buildTriStateButtons,
  buildEnumButtons,
  buildEditButtons,
  buildBackButton,
  buildCloseButton,
} from './settingsButtonBuilders.js';
import {
  type SettingDefinition,
  type SettingsData,
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  DashboardView,
  SettingType,
} from './types.js';
import { EXTENDED_CONTEXT_SETTINGS } from './settingsConfig.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';

// Test fixtures (mirrors the Builder test's dashboard shape)
const createTestConfig = (): SettingsDashboardConfig => ({
  level: 'global',
  entityType: 'test-settings',
  titlePrefix: 'Test',
  color: DISCORD_COLORS.BLURPLE,
  settings: EXTENDED_CONTEXT_SETTINGS,
});

const createTestSession = (
  dataOverrides: Partial<SettingsData> = {}
): SettingsDashboardSession => ({
  level: 'channel',
  entityId: 'test-entity',
  entityName: 'Test Entity',
  userId: 'user-123',
  messageId: 'msg-123',
  channelId: 'channel-123',
  lastActivityAt: new Date(),
  view: DashboardView.OVERVIEW,
  data: {
    maxMessages: {
      localValue: null,
      hasLocalOverride: false,
      effectiveValue: 50,
      source: 'admin',
    },
    maxAge: {
      localValue: null,
      hasLocalOverride: false,
      effectiveValue: 7200,
      source: 'admin',
    },
    maxImages: {
      localValue: null,
      hasLocalOverride: false,
      effectiveValue: 10,
      source: 'admin',
    },
    crossChannelHistoryEnabled: {
      localValue: null,
      hasLocalOverride: false,
      effectiveValue: false,
      source: 'hardcoded',
    },
    focusModeEnabled: {
      localValue: null,
      hasLocalOverride: false,
      effectiveValue: false,
      source: 'hardcoded',
    },
    shareLtmAcrossPersonalities: {
      localValue: null,
      hasLocalOverride: false,
      effectiveValue: false,
      source: 'hardcoded',
    },
    memoryScoreThreshold: {
      localValue: null,
      hasLocalOverride: false,
      effectiveValue: 0.5,
      source: 'hardcoded',
    },
    memoryLimit: {
      localValue: null,
      hasLocalOverride: false,
      effectiveValue: 20,
      source: 'hardcoded',
    },
    showModelFooter: {
      localValue: null,
      hasLocalOverride: false,
      effectiveValue: true,
      source: 'hardcoded',
    },
    voiceResponseMode: {
      localValue: null,
      hasLocalOverride: false,
      effectiveValue: 'always',
      source: 'hardcoded',
    },
    voiceTranscriptionEnabled: {
      localValue: null,
      hasLocalOverride: false,
      effectiveValue: true,
      source: 'hardcoded',
    },
    ...dataOverrides,
  },
});

// Helper to extract button data from action row
function getButtons(
  row: ReturnType<typeof buildTriStateButtons>
): APIButtonComponentWithCustomId[] {
  const json = row.toJSON();
  return (json.components ?? []) as APIButtonComponentWithCustomId[];
}

describe('settingsButtonBuilders', () => {
  describe('buildTriStateButtons', () => {
    // buildTriStateButtons still exists as infrastructure but no current settings use it.
    // Use a synthetic TRI_STATE setting + session data to test the builder.
    const syntheticTriStateSetting: SettingDefinition = {
      id: 'testToggle',
      label: 'Test Toggle',
      emoji: '🧪',
      description: 'A synthetic tri-state setting for testing',
      type: SettingType.TRI_STATE,
    };

    const createTriStateSession = (
      localValue: boolean | null,
      effectiveValue: boolean,
      source: 'admin' | 'channel' = 'admin'
    ) => {
      const session = createTestSession();
      // Inject synthetic field into data so the builder can read it
      (session.data as unknown as Record<string, unknown>)['testToggle'] = {
        localValue,
        hasLocalOverride: localValue !== null,
        effectiveValue,
        source,
      };
      return session;
    };

    it('should create three buttons: Auto, Enable, Disable', () => {
      const config = createTestConfig();
      const session = createTriStateSession(null, true);

      const row = buildTriStateButtons(config, session, syntheticTriStateSetting);
      const buttons = getButtons(row);

      expect(buttons).toHaveLength(3);
      expect(buttons[0].label).toBe('Auto (Inherit)');
      expect(buttons[1].label).toBe('Enable');
      expect(buttons[2].label).toBe('Disable');
    });

    it('should highlight Auto button when local value is null', () => {
      const config = createTestConfig();
      const session = createTriStateSession(null, true);

      const row = buildTriStateButtons(config, session, syntheticTriStateSetting);
      const buttons = getButtons(row);

      expect(buttons[0].style).toBe(ButtonStyle.Primary); // Auto highlighted
      expect(buttons[1].style).toBe(ButtonStyle.Secondary);
      expect(buttons[2].style).toBe(ButtonStyle.Secondary);
    });

    it('should highlight Enable button when local value is true', () => {
      const config = createTestConfig();
      const session = createTriStateSession(true, true, 'channel');

      const row = buildTriStateButtons(config, session, syntheticTriStateSetting);
      const buttons = getButtons(row);

      expect(buttons[0].style).toBe(ButtonStyle.Secondary);
      expect(buttons[1].style).toBe(ButtonStyle.Success); // Enable highlighted
      expect(buttons[2].style).toBe(ButtonStyle.Secondary);
    });

    it('should highlight Disable button when local value is false', () => {
      const config = createTestConfig();
      const session = createTriStateSession(false, false, 'channel');

      const row = buildTriStateButtons(config, session, syntheticTriStateSetting);
      const buttons = getButtons(row);

      expect(buttons[0].style).toBe(ButtonStyle.Secondary);
      expect(buttons[1].style).toBe(ButtonStyle.Secondary);
      expect(buttons[2].style).toBe(ButtonStyle.Danger); // Disable highlighted
    });

    it('should have correct custom IDs', () => {
      const config = createTestConfig();
      const session = createTriStateSession(null, true);

      const row = buildTriStateButtons(config, session, syntheticTriStateSetting);
      const buttons = getButtons(row);

      expect(buttons[0].custom_id).toBe('test-settings::set::test-entity::testToggle:auto');
      expect(buttons[1].custom_id).toBe('test-settings::set::test-entity::testToggle:true');
      expect(buttons[2].custom_id).toBe('test-settings::set::test-entity::testToggle:false');
    });
  });

  describe('buildEnumButtons', () => {
    const enumSetting: SettingDefinition = {
      id: 'voiceResponseMode',
      label: 'Voice Response Mode',
      emoji: '🔊',
      description: 'Controls when AI responses are converted to voice audio.',
      type: SettingType.ENUM,
      choices: [
        { value: 'always', label: 'Always', emoji: '🔊' },
        { value: 'voice-only', label: 'Voice Only', emoji: '🎙️' },
        { value: 'never', label: 'Never', emoji: '🔇' },
      ],
    };

    const createEnumSession = (
      localValue: string | null,
      effectiveValue: string,
      source: 'admin' | 'hardcoded' = 'hardcoded'
    ) => {
      return createTestSession({
        voiceResponseMode: {
          localValue,
          hasLocalOverride: localValue !== null,
          effectiveValue,
          source,
        },
      });
    };

    it('should create Auto + one button per choice', () => {
      const config = createTestConfig();
      const session = createEnumSession(null, 'always');

      const row = buildEnumButtons(config, session, enumSetting);
      const buttons = getButtons(row);

      expect(buttons).toHaveLength(4); // Auto + 3 choices
      expect(buttons[0].label).toBe('Auto (Inherit)');
      expect(buttons[1].label).toBe('Always');
      expect(buttons[2].label).toBe('Voice Only');
      expect(buttons[3].label).toBe('Never');
    });

    it('should highlight Auto when localValue is null', () => {
      const config = createTestConfig();
      const session = createEnumSession(null, 'always');

      const row = buildEnumButtons(config, session, enumSetting);
      const buttons = getButtons(row);

      expect(buttons[0].style).toBe(ButtonStyle.Primary);
      expect(buttons[1].style).toBe(ButtonStyle.Secondary);
      expect(buttons[2].style).toBe(ButtonStyle.Secondary);
      expect(buttons[3].style).toBe(ButtonStyle.Secondary);
    });

    it('should highlight the active choice when local override set', () => {
      const config = createTestConfig();
      const session = createEnumSession('voice-only', 'voice-only', 'admin');

      const row = buildEnumButtons(config, session, enumSetting);
      const buttons = getButtons(row);

      expect(buttons[0].style).toBe(ButtonStyle.Secondary);
      expect(buttons[1].style).toBe(ButtonStyle.Secondary);
      expect(buttons[2].style).toBe(ButtonStyle.Success); // voice-only highlighted
      expect(buttons[3].style).toBe(ButtonStyle.Secondary);
    });

    it('should have correct custom IDs', () => {
      const config = createTestConfig();
      const session = createEnumSession(null, 'always');

      const row = buildEnumButtons(config, session, enumSetting);
      const buttons = getButtons(row);

      expect(buttons[0].custom_id).toBe('test-settings::set::test-entity::voiceResponseMode:auto');
      expect(buttons[1].custom_id).toBe(
        'test-settings::set::test-entity::voiceResponseMode:always'
      );
      expect(buttons[2].custom_id).toBe(
        'test-settings::set::test-entity::voiceResponseMode:voice-only'
      );
      expect(buttons[3].custom_id).toBe('test-settings::set::test-entity::voiceResponseMode:never');
    });

    it('should throw when choices exceed Discord button limit', () => {
      const config = createTestConfig();
      const session = createEnumSession(null, 'a');
      const overflowSetting = {
        id: 'voiceResponseMode',
        label: 'Overflow',
        emoji: '💥',
        description: 'Too many choices',
        type: SettingType.ENUM,
        choices: [
          { value: 'a', label: 'A', emoji: '1️⃣' },
          { value: 'b', label: 'B', emoji: '2️⃣' },
          { value: 'c', label: 'C', emoji: '3️⃣' },
          { value: 'd', label: 'D', emoji: '4️⃣' },
          { value: 'e', label: 'E', emoji: '5️⃣' },
        ],
      } satisfies typeof enumSetting;

      expect(() => buildEnumButtons(config, session, overflowSetting)).toThrow(
        /exceeds Discord's 5-button row limit/
      );
    });

    it('should throw when a choice uses a reserved value', () => {
      const config = createTestConfig();
      const session = createEnumSession(null, 'auto');
      const reservedSetting = {
        id: 'voiceResponseMode',
        label: 'Reserved',
        emoji: '🚫',
        description: 'Has reserved value',
        type: SettingType.ENUM,
        choices: [
          { value: 'auto', label: 'Auto', emoji: '🔄' },
          { value: 'other', label: 'Other', emoji: '🔊' },
        ],
      } satisfies typeof enumSetting;

      expect(() => buildEnumButtons(config, session, reservedSetting)).toThrow(
        /reserved choice value "auto"/
      );
    });
  });

  describe('buildEditButtons', () => {
    it('should create Edit and Reset buttons', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[0]; // maxMessages

      const row = buildEditButtons(config, session, setting);
      const buttons = getButtons(row);

      expect(buttons).toHaveLength(2);
      expect(buttons[0].label).toBe('Edit Value');
      expect(buttons[1].label).toBe('Reset to Auto');
    });

    it('should disable Reset button when no override', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxMessages: {
          localValue: null,
          hasLocalOverride: false,
          effectiveValue: 50,
          source: 'admin',
        },
      });
      const setting = EXTENDED_CONTEXT_SETTINGS[0]; // maxMessages

      const row = buildEditButtons(config, session, setting);
      const buttons = getButtons(row);

      expect(buttons[1].disabled).toBe(true);
    });

    it('should enable Reset button when override exists', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxMessages: {
          localValue: 25,
          hasLocalOverride: true,
          effectiveValue: 25,
          source: 'channel',
        },
      });
      const setting = EXTENDED_CONTEXT_SETTINGS[0]; // maxMessages

      const row = buildEditButtons(config, session, setting);
      const buttons = getButtons(row);

      expect(buttons[1].disabled).toBe(false);
    });

    it('should have correct custom IDs', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[0]; // maxMessages

      const row = buildEditButtons(config, session, setting);
      const buttons = getButtons(row);

      expect(buttons[0].custom_id).toBe('test-settings::edit::test-entity::maxMessages');
      expect(buttons[1].custom_id).toBe('test-settings::set::test-entity::maxMessages:auto');
    });
    it('keeps Reset-to-Auto enabled for a stored OFF (localValue null but hasLocalOverride true)', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxAge: {
          localValue: null,
          hasLocalOverride: true,
          effectiveValue: null,
          source: 'channel',
        },
      });
      const setting = EXTENDED_CONTEXT_SETTINGS.find(s => s.id === 'maxAge');
      if (setting === undefined) throw new Error('maxAge setting missing');

      const row = buildEditButtons(config, session, setting);
      const buttons = getButtons(row);
      const reset = buttons.find(
        b => b.label?.includes('Auto') === true || b.label?.includes('Reset') === true
      );
      if (reset === undefined) throw new Error('reset button missing');

      expect(reset.disabled).toBe(false);
    });
  });

  describe('buildBackButton', () => {
    it('should create back button with correct custom ID', () => {
      const config = createTestConfig();
      const session = createTestSession();

      const row = buildBackButton(config, session);
      const buttons = getButtons(row);

      expect(buttons).toHaveLength(1);
      expect(buttons[0].label).toBe('Back to Overview');
      expect(buttons[0].custom_id).toBe('test-settings::back::test-entity');
    });
  });

  describe('buildCloseButton', () => {
    it('should create close button with correct custom ID', () => {
      const config = createTestConfig();
      const session = createTestSession();

      const row = buildCloseButton(config, session);
      const buttons = getButtons(row);

      expect(buttons).toHaveLength(1);
      expect(buttons[0].label).toBe('Close');
      expect(buttons[0].custom_id).toBe('test-settings::close::test-entity');
    });
  });
});
