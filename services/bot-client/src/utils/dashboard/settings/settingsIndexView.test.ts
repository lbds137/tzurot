/**
 * Tests for the settings dashboard index (hub) view and the landing decision.
 */

import { describe, it, expect } from 'vitest';
import { escapeMarkdown, type APIStringSelectComponent } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import {
  INDEX_LANDING_MIN_PAGES,
  buildIndexEmbed,
  buildIndexMessage,
  buildIndexSelectMenu,
  buildLandingMessage,
  resolveLandingView,
} from './settingsIndexView.js';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingsPage,
  DashboardView,
} from './types.js';
import { EXTENDED_CONTEXT_SETTINGS } from './settingsConfig.js';
import { ADMIN_SETTINGS_CONFIG } from '../../../commands/admin/settings.js';
import { USER_DEFAULTS_CONFIG } from '../../../commands/settings/defaults/edit.js';

const pagesOf = (count: number): SettingsPage[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    label: `Page Label ${i + 1}`,
    settingIds: [EXTENDED_CONTEXT_SETTINGS[0].id],
  }));

const configWithPages = (pages?: SettingsPage[]): SettingsDashboardConfig => ({
  level: 'global',
  entityType: 'test-settings',
  titlePrefix: 'Test',
  color: DISCORD_COLORS.BLURPLE,
  settings: EXTENDED_CONTEXT_SETTINGS,
  ...(pages !== undefined ? { pages } : {}),
  scopeNote: () => 'test scope',
});

const session = (overrides: Partial<SettingsDashboardSession> = {}): SettingsDashboardSession => ({
  level: 'global',
  entityId: 'global',
  entityName: 'Global Settings',
  userId: 'user-123',
  messageId: 'msg-123',
  channelId: 'channel-123',
  lastActivityAt: new Date(),
  view: DashboardView.INDEX,
  page: 0,
  data: {},
  ...overrides,
});

function jumpSelect(config: SettingsDashboardConfig): APIStringSelectComponent {
  return buildIndexSelectMenu(config, session()).toJSON().components[0] as APIStringSelectComponent;
}

describe('settingsIndexView', () => {
  describe('index lists every page (the 11-page admin dashboard)', () => {
    const adminPages = ADMIN_SETTINGS_CONFIG.pages ?? [];

    it('the admin config really has 11 pages (fixture guard for the boundary cuts below)', () => {
      expect(adminPages).toHaveLength(11);
    });

    it('jump select offers every page, in page order, valued by page position', () => {
      const select = jumpSelect(ADMIN_SETTINGS_CONFIG);
      expect(select.options.map(o => o.label)).toEqual(adminPages.map(p => p.label));
      expect(select.options.map(o => o.value)).toEqual(adminPages.map((_, i) => String(i)));
      expect(select.custom_id).toBe('admin-settings::jump::global');
      expect(select.placeholder).toBe('Jump to a page…');
    });

    it('embed lists every page label, one line each, in page order', () => {
      const embed = buildIndexEmbed(ADMIN_SETTINGS_CONFIG, session()).toJSON();
      expect(embed.title).toBe('Global Settings · Index');
      const lines = (embed.description ?? '').split('\n');
      adminPages.forEach((page, i) => {
        expect(lines[i]).toBe(`**${i + 1}.** ${page.label}`);
      });
    });
  });

  describe('index is navigation only', () => {
    it('renders no setting fields and exactly one component row: the jump select', () => {
      const message = buildIndexMessage(ADMIN_SETTINGS_CONFIG, session());
      expect(message.embeds).toHaveLength(1);
      expect(message.embeds[0].toJSON().fields ?? []).toHaveLength(0);
      expect(message.components).toHaveLength(1);
      const onlyComponent = message.components[0].toJSON().components;
      expect(onlyComponent).toHaveLength(1);
      expect(onlyComponent[0].type).toBe(3); // ComponentType.StringSelect
    });

    it('closes with a one-line hint naming the entity, escaped against masked links', () => {
      const name = '[click me](https://evil.example)';
      const embed = buildIndexEmbed(
        configWithPages(pagesOf(4)),
        session({ entityName: name })
      ).toJSON();
      const description = embed.description ?? '';
      expect(description).toContain(
        `Editing **${escapeMarkdown(name, { maskedLink: true })}** — pick a page from the menu below.`
      );
      expect(description).not.toContain(`**${name}**`);
    });

    it("throws past Discord's 25-option cap instead of truncating", () => {
      expect(() => jumpSelect(configWithPages(pagesOf(26)))).toThrow(/25-option limit/);
      expect(jumpSelect(configWithPages(pagesOf(25))).options).toHaveLength(25);
    });
  });

  describe('landing threshold', () => {
    it(`lands a dashboard of ${INDEX_LANDING_MIN_PAGES}+ pages on the index`, () => {
      expect(INDEX_LANDING_MIN_PAGES).toBe(4);
      expect(resolveLandingView(configWithPages(pagesOf(4)))).toBe(DashboardView.INDEX);
      expect(resolveLandingView(configWithPages(pagesOf(11)))).toBe(DashboardView.INDEX);
    });

    it('opens a dashboard of 3 pages or fewer, or a flat one, on the overview', () => {
      expect(resolveLandingView(configWithPages(pagesOf(3)))).toBe(DashboardView.OVERVIEW);
      expect(resolveLandingView(configWithPages(pagesOf(1)))).toBe(DashboardView.OVERVIEW);
      expect(resolveLandingView(configWithPages())).toBe(DashboardView.OVERVIEW);
    });

    it('the real dashboards: admin (11 pages) lands on the index, user defaults (3) on page 1', () => {
      expect(resolveLandingView(ADMIN_SETTINGS_CONFIG)).toBe(DashboardView.INDEX);
      expect(resolveLandingView(USER_DEFAULTS_CONFIG)).toBe(DashboardView.OVERVIEW);
    });
  });

  describe('buildLandingMessage', () => {
    const config = configWithPages(pagesOf(4));

    it('renders the index for an INDEX session', () => {
      const message = buildLandingMessage(config, session({ view: DashboardView.INDEX }));
      expect(message.embeds[0].toJSON().title).toBe('Test Settings · Index');
    });

    it('renders the overview for any other view (sessions stored before INDEX existed)', () => {
      const overview = buildLandingMessage(config, session({ view: DashboardView.OVERVIEW }));
      expect(overview.embeds[0].toJSON().title).toBe('Test Settings · Page Label 1');
      const setting = buildLandingMessage(config, session({ view: DashboardView.SETTING }));
      expect(setting.embeds[0].toJSON().title).toBe('Test Settings · Page Label 1');
    });
  });
});
