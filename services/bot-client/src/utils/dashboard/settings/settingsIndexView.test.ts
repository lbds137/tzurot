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

const configWithPages = (
  pages?: SettingsPage[],
  overrides: Partial<SettingsDashboardConfig> = {}
): SettingsDashboardConfig => ({
  level: 'global',
  entityType: 'test-settings',
  titlePrefix: 'Test',
  color: DISCORD_COLORS.BLURPLE,
  settings: EXTENDED_CONTEXT_SETTINGS,
  ...(pages !== undefined ? { pages } : {}),
  scopeNote: () => 'test scope',
  ...overrides,
});

/**
 * A paged config whose `overviewDescription`/`scopeNote` don't name the
 * entity — mirrors `ADMIN_SETTINGS_CONFIG`'s shape (static copy, `scopeNote`
 * ignoring its parameter) so the index's "Editing **name**" hint stays
 * meaningful to test against.
 */
const configWithPagesNoNamePreamble = (pages?: SettingsPage[]): SettingsDashboardConfig =>
  configWithPages(pages, {
    overviewDescription: 'Static copy that never names the entity.',
    scopeNote: () => 'static scope copy',
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

    it("the admin index description (preamble + 11 page lines + hint) stays under Discord's 4096-char embed-description cap", () => {
      const embed = buildIndexEmbed(ADMIN_SETTINGS_CONFIG, session()).toJSON();
      expect((embed.description ?? '').length).toBeLessThan(4096);
    });

    it('jump select offers every page, in page order, valued by page id', () => {
      const select = jumpSelect(ADMIN_SETTINGS_CONFIG);
      expect(select.options.map(o => o.label)).toEqual(adminPages.map(p => p.label));
      expect(select.options.map(o => o.value)).toEqual(adminPages.map(p => p.id));
      expect(select.custom_id).toBe('admin-settings::jump::global');
      expect(select.placeholder).toBe('Jump to a page…');
    });

    it('embed lists every page label, one line each, in page order', () => {
      const embed = buildIndexEmbed(ADMIN_SETTINGS_CONFIG, session()).toJSON();
      expect(embed.title).toBe('Global Settings · Index');
      // Page lines sit below the scope-disclosure preamble now (TASK: index
      // gains the preamble), so locate them by their own numbered-line shape
      // rather than assuming they start at line 0.
      const pageLines = (embed.description ?? '')
        .split('\n')
        .filter(line => /^\*\*\d+\.\*\*/.test(line));
      expect(pageLines).toEqual(adminPages.map((page, i) => `**${i + 1}.** ${page.label}`));
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

    it('closes with a one-line hint naming the entity, escaped against masked links, when the preamble does not already name it', () => {
      const name = '[click me](https://evil.example)';
      const embed = buildIndexEmbed(
        configWithPagesNoNamePreamble(pagesOf(4)),
        session({ entityName: name })
      ).toJSON();
      const description = embed.description ?? '';
      expect(description).toContain(
        `Editing **${escapeMarkdown(name, { maskedLink: true })}** — pick a page from the menu below.`
      );
      expect(description).not.toContain(`**${name}**`);
    });

    it('omits the redundant "Editing name" hint when the preamble already names the entity (the default overviewDescription template)', () => {
      const embed = buildIndexEmbed(
        configWithPages(pagesOf(4)),
        session({ entityName: 'Global Settings' })
      ).toJSON();
      const description = embed.description ?? '';
      expect(description).toContain('Configure extended context settings for **Global Settings**.');
      expect(description).not.toContain('Editing **Global Settings**');
      expect(description).toContain('Pick a page from the menu below.');
    });

    it('renders the scope-disclosure preamble above the page list — a sentinel scopeNote appears on the index', () => {
      const embed = buildIndexEmbed(configWithPagesNoNamePreamble(pagesOf(4)), session()).toJSON();
      expect(embed.description ?? '').toContain('static scope copy');
    });

    it("renders the admin dashboard's real scope-note text on the index landing render", () => {
      const embed = buildIndexEmbed(ADMIN_SETTINGS_CONFIG, session()).toJSON();
      expect(embed.description ?? '').toContain(
        "🌐 Applies to everyone, bot-wide. Character, channel, and each user's own settings override these."
      );
    });

    it('renders a descriptionNote sentinel on the index too, when the config carries one', () => {
      const embed = buildIndexEmbed(
        configWithPages(pagesOf(4), { descriptionNote: 'DESCRIPTION_NOTE_SENTINEL' }),
        session()
      ).toJSON();
      expect(embed.description ?? '').toContain('DESCRIPTION_NOTE_SENTINEL');
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
