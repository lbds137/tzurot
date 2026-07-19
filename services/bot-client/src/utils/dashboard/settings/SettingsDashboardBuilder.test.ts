/**
 * Tests for SettingsDashboardBuilder
 */

import { describe, it, expect } from 'vitest';
import { ButtonStyle } from 'discord.js';
import {
  buildOverviewEmbed,
  buildSettingEmbed,
  buildSettingsSelectMenu,
  buildOverviewMessage,
  buildSettingMessage,
  getSettingById,
} from './SettingsDashboardBuilder.js';
import {
  buildEnumButtons,
  buildEditButtons,
  buildBooleanButtons,
  buildPaginationRow,
} from './settingsButtonBuilders.js';
import {
  type SettingDefinition,
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingsData,
  SettingType,
  DashboardView,
} from './types.js';
import type { APIButtonComponentWithCustomId, APIStringSelectComponent } from 'discord.js';
import { EXTENDED_CONTEXT_SETTINGS, ALL_SETTINGS } from './settingsConfig.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';

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

// Helper to extract embed fields
function getEmbedFields(embed: ReturnType<typeof buildOverviewEmbed>) {
  const json = embed.toJSON();
  return json.fields ?? [];
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
        maxMessages: {
          localValue: 25,
          hasLocalOverride: true,
          effectiveValue: 25,
          source: 'channel',
        },
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

    it('should show "Auto (from admin)" for admin-sourced values', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxMessages: {
          localValue: null,
          hasLocalOverride: false,
          effectiveValue: 75,
          source: 'admin',
        },
      });

      const embed = buildOverviewEmbed(config, session);
      const fields = getEmbedFields(embed);
      const maxMessagesField = fields.find(f => f.name?.includes('Max Messages'));

      expect(maxMessagesField?.value).toContain('Auto (from admin)');
    });

    it('should show "Auto (from personality)" for personality-sourced values', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxMessages: {
          localValue: null,
          hasLocalOverride: false,
          effectiveValue: 60,
          source: 'personality',
        },
      });

      const embed = buildOverviewEmbed(config, session);
      const fields = getEmbedFields(embed);
      const maxMessagesField = fields.find(f => f.name?.includes('Max Messages'));

      expect(maxMessagesField?.value).toContain('Auto (from personality)');
    });

    it('should show "Auto (from channel)" for channel-sourced values', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxMessages: {
          localValue: null,
          hasLocalOverride: false,
          effectiveValue: 40,
          source: 'channel',
        },
      });

      const embed = buildOverviewEmbed(config, session);
      const fields = getEmbedFields(embed);
      const maxMessagesField = fields.find(f => f.name?.includes('Max Messages'));

      expect(maxMessagesField?.value).toContain('Auto (from channel)');
    });

    it('should show "Auto (from your defaults)" for user-default-sourced values', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxMessages: {
          localValue: null,
          hasLocalOverride: false,
          effectiveValue: 30,
          source: 'user-default',
        },
      });

      const embed = buildOverviewEmbed(config, session);
      const fields = getEmbedFields(embed);
      const maxMessagesField = fields.find(f => f.name?.includes('Max Messages'));

      expect(maxMessagesField?.value).toContain('Auto (from your defaults)');
    });

    it('should show "Auto (from your override)" for user-personality-sourced values', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxMessages: {
          localValue: null,
          hasLocalOverride: false,
          effectiveValue: 25,
          source: 'user-personality',
        },
      });

      const embed = buildOverviewEmbed(config, session);
      const fields = getEmbedFields(embed);
      const maxMessagesField = fields.find(f => f.name?.includes('Max Messages'));

      expect(maxMessagesField?.value).toContain('Auto (from your override)');
    });

    it('should show "Auto (default)" for hardcoded-sourced values', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxMessages: {
          localValue: null,
          hasLocalOverride: false,
          effectiveValue: 50,
          source: 'hardcoded',
        },
      });

      const embed = buildOverviewEmbed(config, session);
      const fields = getEmbedFields(embed);
      const maxMessagesField = fields.find(f => f.name?.includes('Max Messages'));

      expect(maxMessagesField?.value).toContain('Auto (default)');
    });

    it('should format duration values', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxAge: { localValue: 7200, hasLocalOverride: true, effectiveValue: 7200, source: 'admin' },
      });

      const embed = buildOverviewEmbed(config, session);
      const fields = getEmbedFields(embed);
      const maxAgeField = fields.find(f => f.name?.includes('Max Age'));

      expect(maxAgeField?.value).toContain('2 hours'); // Duration.fromSeconds(7200).toHuman()
    });

    it('should show "Off (no limit)" for null duration', () => {
      const config = createTestConfig();
      const session = createTestSession({
        maxAge: {
          localValue: null,
          hasLocalOverride: false,
          effectiveValue: null,
          source: 'admin',
        },
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
        maxMessages: {
          localValue: 30,
          hasLocalOverride: true,
          effectiveValue: 30,
          source: 'channel',
        },
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
        maxMessages: {
          localValue: 30,
          hasLocalOverride: true,
          effectiveValue: 30,
          source: 'channel',
        },
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
        maxMessages: {
          localValue: 30,
          hasLocalOverride: true,
          effectiveValue: 30,
          source: 'channel',
        },
      });

      const row = buildSettingsSelectMenu(config, session);
      const menu = getSelectMenu(row);
      const maxMessagesOption = menu?.options?.find(
        (o: { value?: string }) => o.value === 'maxMessages'
      );

      expect(maxMessagesOption?.description).toContain('30');
    });
  });

  describe('buildOverviewMessage', () => {
    it('should return embed and components', () => {
      const config = createTestConfig();
      const session = createTestSession();

      const message = buildOverviewMessage(config, session);

      expect(message.embeds).toHaveLength(1);
      expect(message.components).toHaveLength(1); // select menu only (no Close — D18)
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

    it('should return embed and components for enum setting', () => {
      const config = createTestConfig();
      const session = createTestSession();
      const enumSetting: SettingDefinition = {
        id: 'voiceResponseMode',
        label: 'Voice Response Mode',
        emoji: '🔊',
        description: 'Controls voice responses.',
        type: SettingType.ENUM,
        choices: [
          { value: 'always', label: 'Always', emoji: '🔊' },
          { value: 'voice-only', label: 'Voice Only', emoji: '🎙️' },
          { value: 'never', label: 'Never', emoji: '🔇' },
        ],
      };

      const message = buildSettingMessage(config, session, enumSetting);

      expect(message.embeds).toHaveLength(1);
      expect(message.components).toHaveLength(2); // enum buttons + back button
    });
  });

  describe('getSettingById (config-scoped)', () => {
    // Config-scoping is a behavior fix: the old global lookup let a forged
    // customId address settings a dashboard deliberately excludes.
    const fullConfig: SettingsDashboardConfig = { ...createTestConfig(), settings: ALL_SETTINGS };

    it('should return setting definition by ID', () => {
      const setting = getSettingById(fullConfig, 'maxMessages');

      expect(setting).toBeDefined();
      expect(setting?.id).toBe('maxMessages');
      expect(setting?.type).toBe(SettingType.NUMERIC);
    });

    it('should return undefined for unknown ID', () => {
      const setting = getSettingById(fullConfig, 'nonexistent');

      expect(setting).toBeUndefined();
    });

    it('excludes settings outside the config (the forged-customId hole)', () => {
      // A config carrying only extended-context settings must NOT resolve a
      // voice setting, even though it exists globally.
      const narrowConfig = createTestConfig();
      expect(getSettingById(narrowConfig, 'voiceTranscriptionEnabled')).toBeUndefined();
      expect(getSettingById(fullConfig, 'voiceTranscriptionEnabled')).toBeDefined();
    });

    it('should find all extended context settings', () => {
      expect(getSettingById(fullConfig, 'maxMessages')).toBeDefined();
      expect(getSettingById(fullConfig, 'maxAge')).toBeDefined();
      expect(getSettingById(fullConfig, 'maxImages')).toBeDefined();
    });

    it('should find all memory settings', () => {
      expect(getSettingById(fullConfig, 'crossChannelHistoryEnabled')).toBeDefined();
      expect(getSettingById(fullConfig, 'shareLtmAcrossPersonalities')).toBeDefined();

      const crossChannel = getSettingById(fullConfig, 'crossChannelHistoryEnabled');
      expect(crossChannel?.type).toBe(SettingType.TRI_STATE);

      const shareLtm = getSettingById(fullConfig, 'shareLtmAcrossPersonalities');
      expect(shareLtm?.type).toBe(SettingType.TRI_STATE);
    });

    it('should find display settings', () => {
      expect(getSettingById(fullConfig, 'showModelFooter')).toBeDefined();

      const showModelFooter = getSettingById(fullConfig, 'showModelFooter');
      expect(showModelFooter?.type).toBe(SettingType.TRI_STATE);
    });

    it('should find voice settings', () => {
      expect(getSettingById(fullConfig, 'voiceTranscriptionEnabled')).toBeDefined();
      expect(getSettingById(fullConfig, 'voiceResponseMode')).toBeDefined();

      const transcription = getSettingById(fullConfig, 'voiceTranscriptionEnabled');
      expect(transcription?.type).toBe(SettingType.TRI_STATE);

      const responseMode = getSettingById(fullConfig, 'voiceResponseMode');
      expect(responseMode?.type).toBe(SettingType.ENUM);
      expect(responseMode?.choices).toHaveLength(3);
    });
  });

  describe('paged configs (§3.3 pagination-by-concern)', () => {
    const PAGED_SETTINGS: SettingDefinition[] = [
      ...EXTENDED_CONTEXT_SETTINGS,
      {
        id: 'sysFlag',
        label: 'Sys Flag',
        emoji: '🎛️',
        description: 'A system flag.',
        type: SettingType.BOOLEAN,
        plainDisplay: true,
      },
      {
        id: 'sysModel',
        label: 'Sys Model',
        emoji: '🤖',
        description: 'A system model field.',
        type: SettingType.TEXT,
        plainDisplay: true,
      },
    ];
    const pagedConfig = (): SettingsDashboardConfig => ({
      ...createTestConfig(),
      settings: PAGED_SETTINGS,
      pages: [
        {
          id: 'context',
          label: 'Context',
          settingIds: EXTENDED_CONTEXT_SETTINGS.map(s => s.id),
        },
        { id: 'system', label: 'System · Flags', settingIds: ['sysFlag', 'sysModel'] },
      ],
    });
    const pagedSession = (page: number): SettingsDashboardSession => ({
      ...createTestSession(),
      page,
      data: {
        ...createTestSession().data,
        sysFlag: {
          localValue: true,
          hasLocalOverride: true,
          effectiveValue: true,
          source: 'admin',
        },
        sysModel: {
          localValue: 'openrouter/auto',
          hasLocalOverride: true,
          effectiveValue: 'openrouter/auto',
          source: 'admin',
        },
      },
    });

    it('overview renders only the current page fields, titled and footered with the page indicator', () => {
      const embed = buildOverviewEmbed(pagedConfig(), pagedSession(0)).toJSON();
      expect(embed.title).toBe('Test Settings · Context');
      expect(embed.fields).toHaveLength(EXTENDED_CONTEXT_SETTINGS.length);
      expect(embed.footer?.text).toContain('Page 1/2 · Context');

      const page2 = buildOverviewEmbed(pagedConfig(), pagedSession(1)).toJSON();
      expect(page2.title).toBe('Test Settings · System · Flags');
      expect(page2.fields).toHaveLength(2);
    });

    it('clamps an out-of-range session page (shrunk page list) instead of rendering Page 6/2', () => {
      const embed = buildOverviewEmbed(pagedConfig(), pagedSession(99)).toJSON();
      expect(embed.footer?.text).toContain('Page 2/2');
    });

    it('pagination row: three distinct customIds, edges disabled', () => {
      const row = buildPaginationRow(pagedConfig(), pagedSession(0)).toJSON();
      const buttons = row.components as APIButtonComponentWithCustomId[];
      expect(buttons.map(b => b.label)).toEqual(['Prev', 'Page 1/2 · Context', 'Next']);
      expect(new Set(buttons.map(b => b.custom_id)).size).toBe(3);
      expect(buttons[0].disabled).toBe(true); // first page → Prev disabled
      expect(buttons[1].disabled).toBe(true); // indicator always disabled
      expect(buttons[2].disabled).toBeFalsy();

      const lastRow = buildPaginationRow(pagedConfig(), pagedSession(1)).toJSON();
      const lastButtons = lastRow.components as APIButtonComponentWithCustomId[];
      expect(lastButtons[0].disabled).toBeFalsy();
      expect(lastButtons[2].disabled).toBe(true); // last page → Next disabled
    });

    it('overview renders pagination on paged configs and NO second row on flat (D18)', () => {
      const paged = buildOverviewMessage(pagedConfig(), pagedSession(0));
      const secondRow = paged.components[1].toJSON();
      const labels = (secondRow.components as APIButtonComponentWithCustomId[]).map(b => b.label);
      expect(labels).toContain('Prev');
      expect(labels).not.toContain('Close');

      // Flat config: select menu only — native dismiss replaces Close.
      const flat = buildOverviewMessage(createTestConfig(), createTestSession());
      expect(flat.components).toHaveLength(1);
    });

    it('select menu scopes to the current page', () => {
      const row = buildSettingsSelectMenu(pagedConfig(), pagedSession(1)).toJSON();
      const select = row.components[0] as APIStringSelectComponent;
      expect(select.options.map(o => o.value)).toEqual(['sysFlag', 'sysModel']);
    });

    it("select menu throws past Discord's 25-option cap", () => {
      const manySettings: SettingDefinition[] = Array.from({ length: 26 }, (_, i) => ({
        id: `s${i}`,
        label: `S${i}`,
        emoji: '⚙️',
        description: 'x',
        type: SettingType.NUMERIC,
      }));
      const config: SettingsDashboardConfig = { ...createTestConfig(), settings: manySettings };
      const session: SettingsDashboardSession = {
        ...createTestSession(),
        data: Object.fromEntries(
          manySettings.map(s => [
            s.id,
            { localValue: null, hasLocalOverride: false, effectiveValue: 1, source: 'hardcoded' },
          ])
        ),
      };
      expect(() => buildSettingsSelectMenu(config, session)).toThrow(/25-option limit/);
    });
  });

  describe('plain display mode (non-cascading settings)', () => {
    const plainSetting: SettingDefinition = {
      id: 'sysThreshold',
      label: 'Sys Threshold',
      emoji: '📦',
      description: 'A system integer.',
      type: SettingType.NUMERIC,
      min: 1,
      max: 50,
      plainDisplay: true,
    };
    const booleanSetting: SettingDefinition = {
      id: 'sysFlag',
      label: 'Sys Flag',
      emoji: '🎛️',
      description: 'A system flag.',
      type: SettingType.BOOLEAN,
      plainDisplay: true,
    };
    const enumSetting: SettingDefinition = {
      id: 'sysProvider',
      label: 'Sys Provider',
      emoji: '🔀',
      description: 'A system enum.',
      type: SettingType.ENUM,
      plainDisplay: true,
      choices: [
        { value: 'openrouter', label: 'OpenRouter', emoji: '🔧' },
        { value: 'zai-coding', label: 'z.ai Coding', emoji: '🔧' },
      ],
    };
    const plainData = (): SettingsData => ({
      ...createTestSession().data,
      sysThreshold: { localValue: 6, hasLocalOverride: true, effectiveValue: 6, source: 'admin' },
      sysFlag: { localValue: true, hasLocalOverride: true, effectiveValue: true, source: 'admin' },
      sysProvider: {
        localValue: 'openrouter',
        hasLocalOverride: true,
        effectiveValue: 'openrouter',
        source: 'admin',
      },
    });
    const config = (): SettingsDashboardConfig => ({
      ...createTestConfig(),
      settings: [...EXTENDED_CONTEXT_SETTINGS, plainSetting, booleanSetting, enumSetting],
    });
    const session = (): SettingsDashboardSession => ({
      ...createTestSession(),
      data: plainData(),
    });

    it('drill-down omits Status AND Parent Value (the adapter shape would render nonsense)', () => {
      const embed = buildSettingEmbed(config(), session(), plainSetting).toJSON();
      const names = (embed.fields ?? []).map(f => f.name);
      expect(names).toContain('Current Value');
      expect(names).not.toContain('Status');
      expect(names).not.toContain('Parent Value');
    });

    it('cascade settings on the SAME mixed config keep full status display', () => {
      const cascadeSetting = EXTENDED_CONTEXT_SETTINGS[0];
      const embed = buildSettingEmbed(config(), session(), cascadeSetting).toJSON();
      const names = (embed.fields ?? []).map(f => f.name);
      expect(names).toContain('Status');
    });

    it('edit buttons omit Reset-to-Auto for plain settings', () => {
      const row = buildEditButtons(config(), session(), plainSetting).toJSON();
      const labels = (row.components as APIButtonComponentWithCustomId[]).map(b => b.label);
      expect(labels).toEqual(['Edit Value']);
    });

    it('enum buttons omit the Auto button for plain settings', () => {
      const row = buildEnumButtons(config(), session(), enumSetting).toJSON();
      const labels = (row.components as APIButtonComponentWithCustomId[]).map(b => b.label);
      expect(labels).toEqual(['OpenRouter', 'z.ai Coding']);
    });

    it('BOOLEAN renders two-state buttons (no Auto) with the active state highlighted', () => {
      const row = buildBooleanButtons(config(), session(), booleanSetting).toJSON();
      const buttons = row.components as APIButtonComponentWithCustomId[];
      expect(buttons.map(b => b.label)).toEqual(['Enable', 'Disable']);
      expect(buttons[0].style).toBe(ButtonStyle.Success); // effective true
    });

    it('buildSettingMessage routes BOOLEAN to the two-state buttons (no modal fallthrough)', () => {
      const message = buildSettingMessage(config(), session(), booleanSetting);
      const controlRow = message.components[0].toJSON();
      const labels = (controlRow.components as APIButtonComponentWithCustomId[]).map(b => b.label);
      expect(labels).toEqual(['Enable', 'Disable']);
    });

    it('a missing value (stale pre-deploy session) renders a placeholder, not a crash', () => {
      const staleSession: SettingsDashboardSession = {
        ...createTestSession(),
        data: createTestSession().data, // lacks the sys* keys entirely
      };
      const embed = buildSettingEmbed(config(), staleSession, plainSetting).toJSON();
      const current = (embed.fields ?? []).find(f => f.name === 'Current Value');
      expect(current?.value).toContain('—');
    });
  });
});
