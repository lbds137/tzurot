/**
 * Tests for the settings dashboard reset scopes: which settings a Reset page
 * or Reset all press covers, how that scope rides in a customId's extra
 * segment, and which of the covered settings hold an override at this
 * dashboard's tier.
 */

import { describe, it, expect } from 'vitest';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import {
  isResettablePage,
  locallySetIds,
  parseResetScope,
  resetScopeExtra,
  type ResetScope,
} from './settingsResetScope.js';
import {
  type SettingDefinition,
  type SettingsData,
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  DashboardView,
  SettingType,
} from './types.js';
import { EXTENDED_CONTEXT_SETTINGS, VOICE_SETTINGS } from './settingsConfig.js';

const PLAIN_SETTING: SettingDefinition = {
  id: 'sysFlag',
  label: 'Sys Flag',
  emoji: '🎛️',
  description: 'A system flag.',
  type: SettingType.BOOLEAN,
  plainDisplay: true,
};

const CONTEXT_PAGE = {
  id: 'context',
  label: 'Context',
  settingIds: EXTENDED_CONTEXT_SETTINGS.map(s => s.id),
};
const VOICE_PAGE = { id: 'voice', label: 'Voice', settingIds: VOICE_SETTINGS.map(s => s.id) };
const EMPTY_PAGE = { id: 'empty', label: 'Empty', settingIds: [] };
const PLAIN_PAGE = {
  id: 'plain',
  label: 'Plain',
  settingIds: [...EXTENDED_CONTEXT_SETTINGS.map(s => s.id), PLAIN_SETTING.id],
};

const baseConfig = (overrides: Partial<SettingsDashboardConfig> = {}): SettingsDashboardConfig => ({
  level: 'global',
  entityType: 'test-settings',
  titlePrefix: 'Test',
  color: DISCORD_COLORS.BLURPLE,
  settings: [...EXTENDED_CONTEXT_SETTINGS, ...VOICE_SETTINGS, PLAIN_SETTING],
  pages: [CONTEXT_PAGE, VOICE_PAGE, EMPTY_PAGE, PLAIN_PAGE],
  scopeNote: () => 'test scope',
  ...overrides,
});

const overrideValue = (overrides: Partial<SettingsData[string]> = {}): SettingsData[string] => ({
  localValue: null,
  hasLocalOverride: false,
  effectiveValue: null,
  source: 'admin',
  parentValue: null,
  ...overrides,
});

const baseSession = (data: SettingsData): SettingsDashboardSession => ({
  level: 'global',
  entityId: 'entity-1',
  entityName: 'Entity',
  userId: 'user-123',
  messageId: 'msg-1',
  channelId: 'chan-1',
  lastActivityAt: new Date(),
  view: DashboardView.OVERVIEW,
  page: 0,
  data,
});

describe('isResettablePage', () => {
  it('a page whose settings are all Auto-capable (cascade) is resettable', () => {
    expect(isResettablePage(baseConfig(), CONTEXT_PAGE)).toBe(true);
  });

  it('a page holding one plain setting is not resettable', () => {
    expect(isResettablePage(baseConfig(), PLAIN_PAGE)).toBe(false);
  });

  it('an empty page is not resettable', () => {
    expect(isResettablePage(baseConfig(), EMPTY_PAGE)).toBe(false);
  });

  it('no page is resettable on a whole-config statusDisplay: plain dashboard', () => {
    const config = baseConfig({ statusDisplay: 'plain' });
    expect(isResettablePage(config, CONTEXT_PAGE)).toBe(false);
  });
});

describe('parseResetScope', () => {
  it('resolves page:<id> to the page and its current index', () => {
    const config = baseConfig();
    const scope = parseResetScope(config, 'page:voice');
    expect(scope).toEqual({ kind: 'page', page: VOICE_PAGE, pageIndex: 1 });
  });

  it('an unknown page id resolves to null', () => {
    expect(parseResetScope(baseConfig(), 'page:nonexistent')).toBeNull();
  });

  it('a page:<id> naming a non-resettable page (holds a plain setting) resolves to null', () => {
    expect(parseResetScope(baseConfig(), 'page:plain')).toBeNull();
  });

  it("'all' resolves to the all scope only when config.resetAll is true", () => {
    expect(parseResetScope(baseConfig({ resetAll: true }), 'all')).toEqual({ kind: 'all' });
    expect(parseResetScope(baseConfig(), 'all')).toBeNull();
  });

  it('a scope-less (undefined) extra resolves to all only with BOTH resetAll and legacyBareResetMeansAll', () => {
    const both = baseConfig({ resetAll: true, legacyBareResetMeansAll: true });
    expect(parseResetScope(both, undefined)).toEqual({ kind: 'all' });

    const resetAllOnly = baseConfig({ resetAll: true });
    expect(parseResetScope(resetAllOnly, undefined)).toBeNull();
  });

  it('garbage extra resolves to null', () => {
    expect(parseResetScope(baseConfig(), 'bogus')).toBeNull();
  });

  it('resetScopeExtra round-trips through parseResetScope for both scope kinds', () => {
    const config = baseConfig({ resetAll: true });

    const pageScope: ResetScope = { kind: 'page', page: CONTEXT_PAGE, pageIndex: 0 };
    expect(parseResetScope(config, resetScopeExtra(pageScope))).toEqual(pageScope);

    const allScope: ResetScope = { kind: 'all' };
    expect(parseResetScope(config, resetScopeExtra(allScope))).toEqual(allScope);
  });
});

describe('locallySetIds', () => {
  it('returns the page-scope ids that hold a local override, in scope order — a stored explicit OFF (maxAge) counts, an inherited one does not', () => {
    const config = baseConfig();
    // maxMessages: local override; maxAge: stored explicit OFF (localValue null,
    // hasLocalOverride true) — presence, not value; maxImages: inherited.
    const data: SettingsData = {
      maxMessages: overrideValue({ localValue: 25, hasLocalOverride: true, effectiveValue: 25 }),
      maxAge: overrideValue({ localValue: null, hasLocalOverride: true, effectiveValue: null }),
      maxImages: overrideValue({ hasLocalOverride: false }),
    };
    const session = baseSession(data);

    const ids = locallySetIds(config, session, { kind: 'page', page: CONTEXT_PAGE, pageIndex: 0 });

    expect(ids).toEqual(['maxMessages', 'maxAge']);
  });

  it("the 'all' scope excludes plain settings even when they hold hasLocalOverride", () => {
    const config = baseConfig();
    const data: SettingsData = {
      maxMessages: overrideValue({ localValue: 25, hasLocalOverride: true, effectiveValue: 25 }),
      voiceResponseMode: overrideValue({ hasLocalOverride: false }),
      sysFlag: overrideValue({ localValue: true, hasLocalOverride: true, effectiveValue: true }),
    };
    const session = baseSession(data);

    const ids = locallySetIds(config, session, { kind: 'all' });

    expect(ids).toEqual(['maxMessages']);
  });
});
