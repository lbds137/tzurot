/**
 * Tests for the settings dashboard index navigation handlers (Index button,
 * jump select). These run post-ack and post-session-guard by contract; the
 * router-level ack and expiry behavior is pinned in
 * SettingsDashboardHandler.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { handleIndexButton, handleJumpSelect } from './settingsNavigationHandlers.js';
import {
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingsPage,
  DashboardView,
} from './types.js';
import { EXTENDED_CONTEXT_SETTINGS } from './settingsConfig.js';

const mockSessionManager = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../SessionManager.js', () => ({
  getSessionManager: vi.fn(() => mockSessionManager),
}));

const FOUR_PAGES: SettingsPage[] = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((label, i) => ({
  id: `p${i}`,
  label,
  settingIds: [EXTENDED_CONTEXT_SETTINGS[i % EXTENDED_CONTEXT_SETTINGS.length].id],
}));

/** A paged config (four pages by default); `null` builds a flat config with no `pages` key. */
const config = (pages: SettingsPage[] | null = FOUR_PAGES): SettingsDashboardConfig => ({
  level: 'global',
  entityType: 'test-settings',
  titlePrefix: 'Test',
  color: DISCORD_COLORS.BLURPLE,
  settings: EXTENDED_CONTEXT_SETTINGS,
  ...(pages !== null ? { pages } : {}),
  scopeNote: () => 'test scope',
});

const session = (overrides: Partial<SettingsDashboardSession> = {}): SettingsDashboardSession => ({
  level: 'global',
  entityId: 'entity-1',
  entityName: 'Entity',
  userId: 'user-123',
  messageId: 'msg-123',
  channelId: 'channel-123',
  lastActivityAt: new Date(0),
  view: DashboardView.OVERVIEW,
  page: 1,
  data: {},
  ...overrides,
});

const interaction = (values: string[] = []) => ({
  user: { id: 'user-123' },
  values,
  editReply: vi.fn(),
});

/** The session the handler persisted (SessionStorage wraps it as `data`). */
function storedSession(): SettingsDashboardSession {
  return mockSessionManager.set.mock.calls.at(-1)?.[0].data as SettingsDashboardSession;
}

function renderedTitle(i: ReturnType<typeof interaction>): string | undefined {
  return i.editReply.mock.calls.at(-1)?.[0].embeds[0].toJSON().title;
}

describe('settingsNavigationHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleIndexButton', () => {
    it('moves the session to the index, clears any drill-down, persists, and renders the index', async () => {
      const i = interaction();
      await handleIndexButton(
        i as never,
        config(),
        session({ view: DashboardView.SETTING, activeSetting: 'maxMessages', page: 2 })
      );

      const stored = storedSession();
      expect(stored.view).toBe(DashboardView.INDEX);
      expect(stored.activeSetting).toBeUndefined();
      expect(stored.page).toBe(2); // the index does not forget where the user was
      expect(stored.lastActivityAt.getTime()).toBeGreaterThan(0);
      expect(renderedTitle(i)).toBe('Test Settings · Index');
    });

    it('a stale Index click on a flat config (no pages) re-renders the overview, never an empty index', async () => {
      const i = interaction();
      await handleIndexButton(i as never, config(null), session());

      expect(storedSession().view).toBe(DashboardView.OVERVIEW);
      expect(renderedTitle(i)).toBe('Test Settings');
    });
  });

  describe('handleJumpSelect', () => {
    it('jumps to the selected page (page 3 of 4, id p2) and renders that page', async () => {
      const i = interaction(['p2']);
      await handleJumpSelect(i as never, config(), session({ view: DashboardView.INDEX, page: 0 }));

      const stored = storedSession();
      expect(stored.page).toBe(2);
      expect(stored.view).toBe(DashboardView.OVERVIEW);
      expect(stored.activeSetting).toBeUndefined();
      expect(renderedTitle(i)).toBe('Test Settings · Charlie');
    });

    it('resolves the id to its CURRENT position when a deploy reorders config.pages', async () => {
      // The select was built from FOUR_PAGES order (p0..p3), but the config
      // handed to the handler has since been reordered — the clicked id
      // (Charlie, p2) must land on ITS new position, not the old one.
      const reordered = config([FOUR_PAGES[3], FOUR_PAGES[2], FOUR_PAGES[0], FOUR_PAGES[1]]);
      const i = interaction(['p2']);
      await handleJumpSelect(
        i as never,
        reordered,
        session({ view: DashboardView.INDEX, page: 0 })
      );

      expect(storedSession().page).toBe(1); // Charlie is now at position 1
      expect(renderedTitle(i)).toBe('Test Settings · Charlie');
    });

    it('clamps a stale session page past a since-shrunk page list to the last page', async () => {
      // The clicked id (p3 / Delta) no longer exists in the shrunk 2-page
      // list, so the handler falls back to the session's own page — which is
      // itself stale (3, from before the shrink) and needs clamping.
      const shrunk = config(FOUR_PAGES.slice(0, 2));
      const i = interaction(['p3']);
      await handleJumpSelect(i as never, shrunk, session({ view: DashboardView.INDEX, page: 3 }));

      expect(storedSession().page).toBe(1);
      expect(renderedTitle(i)).toBe('Test Settings · Bravo');
    });

    it('an id with no matching page (removed page, or a forged value) keeps the current page', async () => {
      for (const forged of ['abc', '-1', '1.5', '', 'p99']) {
        vi.clearAllMocks();
        const i = interaction([forged]);
        await handleJumpSelect(
          i as never,
          config(),
          session({ view: DashboardView.INDEX, page: 1 })
        );

        expect(storedSession().page).toBe(1);
        expect(renderedTitle(i)).toBe('Test Settings · Bravo');
      }
    });
  });
});
