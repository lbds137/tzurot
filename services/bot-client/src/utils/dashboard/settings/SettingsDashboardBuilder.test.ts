/**
 * Tests for SettingsDashboardBuilder
 */

import { describe, it, expect } from 'vitest';
import { ButtonStyle } from 'discord.js';
import {
  buildOverviewEmbed,
  buildSettingEmbed,
  buildSettingsSelectMenu,
  buildTriStateButtons,
  buildEditButtons,
  buildBackButton,
  buildCloseButton,
  buildOverviewMessage,
  buildSettingMessage,
  getSettingById,
} from './SettingsDashboardBuilder.js';
import {
  type SettingDefinition,
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingsData,
  SettingType,
  DashboardView,
} from './types.js';
import type { APIButtonComponentWithCustomId, APIStringSelectComponent } from 'discord.js';
import { EXTENDED_CONTEXT_SETTINGS } from './settingsConfig.js';
import { DISCORD_COLORS } from '@tzurot/common-types';

// Test fixtures
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
    ...dataOverrides,
  },
});

// Helper to extract embed fields
function getEmbedFields(embed: ReturnType<typeof buildOverviewEmbed>) {
  const json = embed.toJSON();
  return json.fields ?? [];
}

// Helper to extract button data from action row
function getButtons(
  row: ReturnType<typeof buildTriStateButtons>
): APIButtonComponentWithCustomId[] {
  const json = row.toJSON();
  return (json.components ?? []) as APIButtonComponentWithCustomId[];
}

// Helper to extract select menu from action row
function getSelectMenu(
  row: ReturnType<typeof buildSettingsSelectMenu>
): APIStringSelectComponent | undefined {
  const json = row.toJSON();
  return json.components?.[0] as APIStringSelectComponent | undefined;
}

describe('SettingsDashboardBuilder', () => {
  describe('buildOverviewEmbed', () => {
    it('should create embed with correct title', () => {
      const config = createTestConfig();
      const session = createTestSession();

      const embed = buildOverviewEmbed(config, session);
      const json = embed.toJSON();

      expect(json.title).toBe('Test Settings');
    });

    it('should include entity name in description', () => {
      const config = createTestConfig();
      const session = createTestSession();

      const embed = buildOverviewEmbed(config, session);
      const json = embed.toJSON();

      expect(json.description).toContain('Test Entity');
    });

    it('should have fields for each setting', () => {
      const config = createTestConfig();
      const session = createTestSession();

      const embed = buildOverviewEmbed(config, session);
      const fields = getEmbedFields(embed);

      expect(fields).toHaveLength(3); // maxMessages, maxAge, maxImages
    });

    it('should show override status when local value set', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxMessages: { localValue: 25, effectiveValue: 25, source: 'channel' },
      });

      const embed = buildOverviewEmbed(config, session);
      const fields = getEmbedFields(embed);
      const maxMessagesField = fields.find(f => f.name?.includes('Max Messages'));

      expect(maxMessagesField?.value).toContain('Override');
    });

    it('should show auto status when inheriting', () => {
      const config = createTestConfig();
      const session = createTestSession();

      const embed = buildOverviewEmbed(config, session);
      const fields = getEmbedFields(embed);
      const maxMessagesField = fields.find(f => f.name?.includes('Max Messages'));

      expect(maxMessagesField?.value).toContain('Auto');
    });

    it('should format duration values', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxAge: { localValue: 7200, effectiveValue: 7200, source: 'global' },
      });

      const embed = buildOverviewEmbed(config, session);
      const fields = getEmbedFields(embed);
      const maxAgeField = fields.find(f => f.name?.includes('Max Age'));

      expect(maxAgeField?.value).toContain('2 hours'); // Duration.fromSeconds(7200).toHuman()
    });

    it('should show "Off (no limit)" for null duration', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxAge: { localValue: null, effectiveValue: null, source: 'global' },
      });

      const embed = buildOverviewEmbed(config, session);
      const fields = getEmbedFields(embed);
      const maxAgeField = fields.find(f => f.name?.includes('Max Age'));

      expect(maxAgeField?.value).toContain('Off (no limit)');
    });
  });

  describe('buildSettingEmbed', () => {
    it('should create embed with setting title', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[0]; // maxMessages

      const embed = buildSettingEmbed(config, session, setting);
      const json = embed.toJSON();

      expect(json.title).toBe('💬 Max Messages');
    });

    it('should include setting description', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[0]; // maxMessages

      const embed = buildSettingEmbed(config, session, setting);
      const json = embed.toJSON();

      expect(json.description).toBe(setting.description);
    });

    it('should show current value field', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxMessages: { localValue: 30, effectiveValue: 30, source: 'channel' },
      });
      const setting = EXTENDED_CONTEXT_SETTINGS[0]; // maxMessages

      const embed = buildSettingEmbed(config, session, setting);
      const fields = getEmbedFields(embed);
      const currentValue = fields.find(f => f.name === 'Current Value');

      expect(currentValue?.value).toContain('30');
    });

    it('should show status field', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxMessages: { localValue: 30, effectiveValue: 30, source: 'channel' },
      });
      const setting = EXTENDED_CONTEXT_SETTINGS[0]; // maxMessages

      const embed = buildSettingEmbed(config, session, setting);
      const fields = getEmbedFields(embed);
      const status = fields.find(f => f.name === 'Status');

      expect(status?.value).toContain('Override');
    });

    it('should show entity name in footer', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[0]; // maxMessages

      const embed = buildSettingEmbed(config, session, setting);
      const json = embed.toJSON();

      expect(json.footer?.text).toContain('Test Entity');
    });

    it('should show help text when available', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[0]; // maxMessages has helpText

      const embed = buildSettingEmbed(config, session, setting);
      const fields = getEmbedFields(embed);
      const helpField = fields.find(f => f.name === 'Help');

      expect(helpField).toBeDefined();
      expect(helpField?.value).toBeTruthy();
    });
  });

  describe('buildSettingsSelectMenu', () => {
    it('should create menu with correct custom ID', () => {
      const config = createTestConfig();
      const session = createTestSession();

      const row = buildSettingsSelectMenu(config, session);
      const menu = getSelectMenu(row);

      expect(menu?.custom_id).toBe('test-settings::select::test-entity');
    });

    it('should have options for each setting', () => {
      const config = createTestConfig();
      const session = createTestSession();

      const row = buildSettingsSelectMenu(config, session);
      const menu = getSelectMenu(row);

      expect(menu?.options).toHaveLength(3);
    });

    it('should include setting labels and values', () => {
      const config = createTestConfig();
      const session = createTestSession();

      const row = buildSettingsSelectMenu(config, session);
      const menu = getSelectMenu(row);
      const maxMessagesOption = menu?.options?.find(
        (o: { value?: string }) => o.value === 'maxMessages'
      );

      expect(maxMessagesOption?.label).toBe('Max Messages');
    });

    it('should include current value in description', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxMessages: { localValue: 30, effectiveValue: 30, source: 'channel' },
      });

      const row = buildSettingsSelectMenu(config, session);
      const menu = getSelectMenu(row);
      const maxMessagesOption = menu?.options?.find(
        (o: { value?: string }) => o.value === 'maxMessages'
      );

      expect(maxMessagesOption?.description).toContain('30');
    });
  });

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
      source: 'global' | 'channel' = 'global'
    ) => {
      const session = createTestSession();
      // Inject synthetic field into data so the builder can read it
      (session.data as unknown as Record<string, unknown>)['testToggle'] = {
        localValue,
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
        maxMessages: { localValue: null, effectiveValue: 50, source: 'global' },
      });
      const setting = EXTENDED_CONTEXT_SETTINGS[0]; // maxMessages

      const row = buildEditButtons(config, session, setting);
      const buttons = getButtons(row);

      expect(buttons[1].disabled).toBe(true);
    });

    it('should enable Reset button when override exists', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxMessages: { localValue: 25, effectiveValue: 25, source: 'channel' },
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

  describe('buildOverviewMessage', () => {
    it('should return embed and components', () => {
      const config = createTestConfig();
      const session = createTestSession();

      const message = buildOverviewMessage(config, session);

      expect(message.embeds).toHaveLength(1);
      expect(message.components).toHaveLength(2); // select menu + close button
    });
  });

  describe('buildSettingMessage', () => {
    it('should return embed and components for numeric setting', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[0]; // maxMessages (NUMERIC)

      const message = buildSettingMessage(config, session, setting);

      expect(message.embeds).toHaveLength(1);
      expect(message.components).toHaveLength(2); // edit buttons + back button
    });

    it('should return embed and components for duration setting', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[1]; // maxAge (DURATION)

      const message = buildSettingMessage(config, session, setting);

      expect(message.embeds).toHaveLength(1);
      expect(message.components).toHaveLength(2); // edit buttons + back button
    });
  });

  describe('getSettingById', () => {
    it('should return setting definition by ID', () => {
      const setting = getSettingById('maxMessages');

      expect(setting).toBeDefined();
      expect(setting?.id).toBe('maxMessages');
      expect(setting?.type).toBe(SettingType.NUMERIC);
    });

    it('should return undefined for unknown ID', () => {
      const setting = getSettingById('nonexistent');

      expect(setting).toBeUndefined();
    });

    it('should find all extended context settings', () => {
      expect(getSettingById('maxMessages')).toBeDefined();
      expect(getSettingById('maxAge')).toBeDefined();
      expect(getSettingById('maxImages')).toBeDefined();
    });
  });
});
