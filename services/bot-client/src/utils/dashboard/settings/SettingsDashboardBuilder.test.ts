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
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingsData,
  SettingType,
} from './types.js';
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
  entityId: 'test-entity',
  entityName: 'Test Entity',
  userId: 'user-123',
  view: 'overview',
  data: {
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
    ...dataOverrides,
  },
  updateHandler: async () => ({ success: true }),
});

// Helper to extract embed fields
function getEmbedFields(embed: ReturnType<typeof buildOverviewEmbed>) {
  const json = embed.toJSON();
  return json.fields ?? [];
}

// Helper to extract button data from action row
function getButtons(row: ReturnType<typeof buildTriStateButtons>) {
  const json = row.toJSON();
  return json.components ?? [];
}

// Helper to extract select menu from action row
function getSelectMenu(row: ReturnType<typeof buildSettingsSelectMenu>) {
  const json = row.toJSON();
  return json.components?.[0];
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

      expect(fields).toHaveLength(4); // enabled, maxMessages, maxAge, maxImages
    });

    it('should show enabled status with checkbox emoji', () => {
      const config = createTestConfig();
      const session = createTestSession({
        enabled: { localValue: true, effectiveValue: true, source: 'global' },
      });

      const embed = buildOverviewEmbed(config, session);
      const fields = getEmbedFields(embed);
      const enabledField = fields.find(f => f.name?.includes('Extended Context'));

      expect(enabledField?.value).toContain('Enabled');
    });

    it('should show disabled status with X emoji', () => {
      const config = createTestConfig();
      const session = createTestSession({
        enabled: { localValue: false, effectiveValue: false, source: 'global' },
      });

      const embed = buildOverviewEmbed(config, session);
      const fields = getEmbedFields(embed);
      const enabledField = fields.find(f => f.name?.includes('Extended Context'));

      expect(enabledField?.value).toContain('Disabled');
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
      const enabledField = fields.find(f => f.name?.includes('Extended Context'));

      expect(enabledField?.value).toContain('Auto');
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
      const setting = EXTENDED_CONTEXT_SETTINGS[0]; // enabled

      const embed = buildSettingEmbed(config, session, setting);
      const json = embed.toJSON();

      expect(json.title).toBe('📜 Extended Context');
    });

    it('should include setting description', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[0];

      const embed = buildSettingEmbed(config, session, setting);
      const json = embed.toJSON();

      expect(json.description).toBe(setting.description);
    });

    it('should show current value field', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxMessages: { localValue: 30, effectiveValue: 30, source: 'channel' },
      });
      const setting = EXTENDED_CONTEXT_SETTINGS[1]; // maxMessages

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
      const setting = EXTENDED_CONTEXT_SETTINGS[1];

      const embed = buildSettingEmbed(config, session, setting);
      const fields = getEmbedFields(embed);
      const status = fields.find(f => f.name === 'Status');

      expect(status?.value).toContain('Override');
    });

    it('should show entity name in footer', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[0];

      const embed = buildSettingEmbed(config, session, setting);
      const json = embed.toJSON();

      expect(json.footer?.text).toContain('Test Entity');
    });

    it('should show help text when available', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[1]; // maxMessages has helpText

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

      expect(menu?.options).toHaveLength(4);
    });

    it('should include setting labels and values', () => {
      const config = createTestConfig();
      const session = createTestSession();

      const row = buildSettingsSelectMenu(config, session);
      const menu = getSelectMenu(row);
      const enabledOption = menu?.options?.find((o: { value?: string }) => o.value === 'enabled');

      expect(enabledOption?.label).toBe('Extended Context');
    });

    it('should include current value in description', () => {
      const config = createTestConfig();
      const session = createTestSession({
        enabled: { localValue: true, effectiveValue: true, source: 'global' },
      });

      const row = buildSettingsSelectMenu(config, session);
      const menu = getSelectMenu(row);
      const enabledOption = menu?.options?.find((o: { value?: string }) => o.value === 'enabled');

      expect(enabledOption?.description).toContain('Enabled');
    });
  });

  describe('buildTriStateButtons', () => {
    it('should create three buttons: Auto, Enable, Disable', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[0]; // enabled

      const row = buildTriStateButtons(config, session, setting);
      const buttons = getButtons(row);

      expect(buttons).toHaveLength(3);
      expect(buttons[0].label).toBe('Auto (Inherit)');
      expect(buttons[1].label).toBe('Enable');
      expect(buttons[2].label).toBe('Disable');
    });

    it('should highlight Auto button when local value is null', () => {
      const config = createTestConfig();
      const session = createTestSession({
        enabled: { localValue: null, effectiveValue: true, source: 'global' },
      });
      const setting = EXTENDED_CONTEXT_SETTINGS[0];

      const row = buildTriStateButtons(config, session, setting);
      const buttons = getButtons(row);

      expect(buttons[0].style).toBe(ButtonStyle.Primary); // Auto highlighted
      expect(buttons[1].style).toBe(ButtonStyle.Secondary);
      expect(buttons[2].style).toBe(ButtonStyle.Secondary);
    });

    it('should highlight Enable button when local value is true', () => {
      const config = createTestConfig();
      const session = createTestSession({
        enabled: { localValue: true, effectiveValue: true, source: 'channel' },
      });
      const setting = EXTENDED_CONTEXT_SETTINGS[0];

      const row = buildTriStateButtons(config, session, setting);
      const buttons = getButtons(row);

      expect(buttons[0].style).toBe(ButtonStyle.Secondary);
      expect(buttons[1].style).toBe(ButtonStyle.Success); // Enable highlighted
      expect(buttons[2].style).toBe(ButtonStyle.Secondary);
    });

    it('should highlight Disable button when local value is false', () => {
      const config = createTestConfig();
      const session = createTestSession({
        enabled: { localValue: false, effectiveValue: false, source: 'channel' },
      });
      const setting = EXTENDED_CONTEXT_SETTINGS[0];

      const row = buildTriStateButtons(config, session, setting);
      const buttons = getButtons(row);

      expect(buttons[0].style).toBe(ButtonStyle.Secondary);
      expect(buttons[1].style).toBe(ButtonStyle.Secondary);
      expect(buttons[2].style).toBe(ButtonStyle.Danger); // Disable highlighted
    });

    it('should have correct custom IDs', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[0];

      const row = buildTriStateButtons(config, session, setting);
      const buttons = getButtons(row);

      expect(buttons[0].custom_id).toBe('test-settings::set::test-entity::enabled:auto');
      expect(buttons[1].custom_id).toBe('test-settings::set::test-entity::enabled:true');
      expect(buttons[2].custom_id).toBe('test-settings::set::test-entity::enabled:false');
    });
  });

  describe('buildEditButtons', () => {
    it('should create Edit and Reset buttons', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[1]; // maxMessages

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
      const setting = EXTENDED_CONTEXT_SETTINGS[1];

      const row = buildEditButtons(config, session, setting);
      const buttons = getButtons(row);

      expect(buttons[1].disabled).toBe(true);
    });

    it('should enable Reset button when override exists', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxMessages: { localValue: 25, effectiveValue: 25, source: 'channel' },
      });
      const setting = EXTENDED_CONTEXT_SETTINGS[1];

      const row = buildEditButtons(config, session, setting);
      const buttons = getButtons(row);

      expect(buttons[1].disabled).toBe(false);
    });

    it('should have correct custom IDs', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[1]; // maxMessages

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
    it('should return embed and components for tri-state setting', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[0]; // enabled (TRI_STATE)

      const message = buildSettingMessage(config, session, setting);

      expect(message.embeds).toHaveLength(1);
      expect(message.components).toHaveLength(2); // tri-state buttons + back button
    });

    it('should return embed and components for numeric setting', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const setting = EXTENDED_CONTEXT_SETTINGS[1]; // maxMessages (NUMERIC)

      const message = buildSettingMessage(config, session, setting);

      expect(message.embeds).toHaveLength(1);
      expect(message.components).toHaveLength(2); // edit buttons + back button
    });
  });

  describe('getSettingById', () => {
    it('should return setting definition by ID', () => {
      const setting = getSettingById('enabled');

      expect(setting).toBeDefined();
      expect(setting?.id).toBe('enabled');
      expect(setting?.type).toBe(SettingType.TRI_STATE);
    });

    it('should return undefined for unknown ID', () => {
      const setting = getSettingById('nonexistent');

      expect(setting).toBeUndefined();
    });

    it('should find all extended context settings', () => {
      expect(getSettingById('enabled')).toBeDefined();
      expect(getSettingById('maxMessages')).toBeDefined();
      expect(getSettingById('maxAge')).toBeDefined();
      expect(getSettingById('maxImages')).toBeDefined();
    });
  });
});
