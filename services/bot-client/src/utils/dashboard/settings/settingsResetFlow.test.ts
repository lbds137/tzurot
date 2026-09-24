/**
 * Tests for handleResetAction: the settings dashboard reset flow behind
 * Reset page and Reset all. Session guards and the router's ack are the
 * router's concern (SettingsDashboardHandler.test.ts) — these call
 * handleResetAction directly, post-ack and post-guard, matching its own
 * contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { escapeMarkdown, type ButtonInteraction } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { STALE_DASHBOARD_NOTICE, handleResetAction } from './settingsResetFlow.js';
import {
  type SettingsData,
  type SettingsDashboardConfig,
  type SettingsDashboardSession,
  type SettingsResetHandler,
  DashboardView,
} from './types.js';
import { EXTENDED_CONTEXT_SETTINGS, MEMORY_SETTINGS, VOICE_SETTINGS } from './settingsConfig.js';

const mockSessionManager = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../SessionManager.js', () => ({
  getSessionManager: vi.fn(() => mockSessionManager),
}));

const SETTINGS_POOL = [...MEMORY_SETTINGS, ...EXTENDED_CONTEXT_SETTINGS, ...VOICE_SETTINGS];
function pick(id: string) {
  const setting = SETTINGS_POOL.find(s => s.id === id);
  if (setting === undefined) throw new Error(`fixture setting missing: ${id}`);
  return setting;
}

// Three pages: Memory (2 local + 1 inherited), Context (1 local + 2
// inherited), Voice (nothing set) — resetAll opts the dashboard into Reset all.
const MEMORY_PAGE = {
  id: 'memory',
  label: 'Memory',
  settingIds: ['crossChannelHistoryEnabled', 'crossChannelRenderMode', 'crossChannelMaxMessages'],
};
const CONTEXT_PAGE = {
  id: 'context',
  label: 'Context',
  settingIds: ['maxMessages', 'maxAge', 'maxImages'],
};
const VOICE_PAGE = { id: 'voice', label: 'Voice', settingIds: ['voiceResponseMode'] };

const testConfig = (overrides: Partial<SettingsDashboardConfig> = {}): SettingsDashboardConfig => ({
  level: 'global',
  entityType: 'test-settings',
  titlePrefix: 'Test',
  color: DISCORD_COLORS.BLURPLE,
  settings: [
    pick('crossChannelHistoryEnabled'),
    pick('crossChannelRenderMode'),
    pick('crossChannelMaxMessages'),
    pick('maxMessages'),
    pick('maxAge'),
    pick('maxImages'),
    pick('voiceResponseMode'),
  ],
  pages: [MEMORY_PAGE, CONTEXT_PAGE, VOICE_PAGE],
  resetAll: true,
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

function makeData(): SettingsData {
  return {
    crossChannelHistoryEnabled: overrideValue({
      localValue: true,
      hasLocalOverride: true,
      effectiveValue: true,
    }),
    crossChannelRenderMode: overrideValue({
      localValue: 'user-only',
      hasLocalOverride: true,
      effectiveValue: 'user-only',
    }),
    crossChannelMaxMessages: overrideValue({ effectiveValue: 20 }),
    maxMessages: overrideValue({ localValue: 25, hasLocalOverride: true, effectiveValue: 25 }),
    maxAge: overrideValue({ effectiveValue: 7200 }),
    maxImages: overrideValue({ effectiveValue: 10 }),
    voiceResponseMode: overrideValue({ effectiveValue: 'always' }),
  };
}

function makeSession(overrides: Partial<SettingsDashboardSession> = {}): SettingsDashboardSession {
  return {
    level: 'global',
    entityId: 'entity-1',
    entityName: 'Entity',
    userId: 'user-123',
    messageId: 'msg-1',
    channelId: 'chan-1',
    lastActivityAt: new Date(0),
    view: DashboardView.OVERVIEW,
    page: 0,
    data: makeData(),
    ...overrides,
  };
}

function makeInteraction() {
  return {
    user: { id: 'user-123' },
    editReply: vi.fn().mockResolvedValue({ id: 'message-123' }),
    followUp: vi.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction & {
    editReply: ReturnType<typeof vi.fn>;
    followUp: ReturnType<typeof vi.fn>;
  };
}

type Call = ReturnType<typeof makeInteraction>;

function embedTitle(interaction: Call): string | undefined {
  return interaction.editReply.mock.calls.at(-1)?.[0].embeds[0].toJSON().title;
}

function embedDescription(interaction: Call): string {
  return interaction.editReply.mock.calls.at(-1)?.[0].embeds[0].toJSON().description ?? '';
}

function confirmButtonIds(interaction: Call): string[] {
  const components = interaction.editReply.mock.calls.at(-1)?.[0].components[0].toJSON()
    .components as Array<{ custom_id: string }>;
  return components.map(b => b.custom_id);
}

describe('handleResetAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prompt names the count and the page, and routes Cancel/Confirm with the page scope', async () => {
    const interaction = makeInteraction();
    const resetHandler = vi.fn();

    await handleResetAction(interaction as never, testConfig(), makeSession(), {
      action: 'reset',
      extra: 'page:memory',
      resetHandler,
      notify: vi.fn(),
    });

    expect(resetHandler).not.toHaveBeenCalled();
    expect(embedDescription(interaction)).toContain(
      '2 settings on **Memory** will go back to Auto.'
    );
    expect(confirmButtonIds(interaction)).toEqual([
      'test-settings::reset-cancel::entity-1::page:memory',
      'test-settings::reset-confirm::entity-1::page:memory',
    ]);
  });

  it('prompt for all names the count across all settings', async () => {
    const interaction = makeInteraction();

    await handleResetAction(interaction as never, testConfig(), makeSession(), {
      action: 'reset',
      extra: 'all',
      resetHandler: vi.fn(),
      notify: vi.fn(),
    });

    expect(embedDescription(interaction)).toContain(
      '3 settings across **all settings** will go back to Auto.'
    );
    expect(confirmButtonIds(interaction)).toEqual([
      'test-settings::reset-cancel::entity-1::all',
      'test-settings::reset-confirm::entity-1::all',
    ]);
  });

  it('prompt on a page with nothing set re-renders the page instead of a confirm', async () => {
    const interaction = makeInteraction();
    const resetHandler = vi.fn();

    await handleResetAction(interaction as never, testConfig(), makeSession(), {
      action: 'reset',
      extra: 'page:voice',
      resetHandler,
      notify: vi.fn(),
    });

    expect(resetHandler).not.toHaveBeenCalled();
    expect(embedTitle(interaction)).toContain('Voice');
  });

  it("confirm clears exactly the page's locally-set settings in one call", async () => {
    const interaction = makeInteraction();
    const resetHandler = vi.fn().mockResolvedValue({ success: true, newData: makeData() });

    await handleResetAction(interaction as never, testConfig(), makeSession(), {
      action: 'reset-confirm',
      extra: 'page:memory',
      resetHandler,
      notify: vi.fn(),
    });

    expect(resetHandler).toHaveBeenCalledTimes(1);
    expect(resetHandler).toHaveBeenCalledWith(expect.anything(), expect.anything(), [
      'crossChannelHistoryEnabled',
      'crossChannelRenderMode',
    ]);
    expect(embedTitle(interaction)).toContain('Memory');
    const stored = mockSessionManager.set.mock.calls.at(-1)?.[0];
    expect(stored.data.page).toBe(0);
    expect(stored.data.view).toBe(DashboardView.OVERVIEW);
  });

  it('confirm resolves the page from the customId, not session.page', async () => {
    const interaction = makeInteraction();
    const resetHandler = vi.fn().mockResolvedValue({ success: true, newData: makeData() });

    await handleResetAction(interaction as never, testConfig(), makeSession({ page: 0 }), {
      action: 'reset-confirm',
      extra: 'page:context',
      resetHandler,
      notify: vi.fn(),
    });

    expect(resetHandler).toHaveBeenCalledWith(expect.anything(), expect.anything(), [
      'maxMessages',
    ]);
    expect(embedTitle(interaction)).toContain('Context');
    const stored = mockSessionManager.set.mock.calls.at(-1)?.[0];
    expect(stored.data.page).toBe(1);
  });

  it('confirm all clears every locally-set Auto-capable setting and re-renders the hub', async () => {
    const interaction = makeInteraction();
    const resetHandler = vi.fn().mockResolvedValue({ success: true, newData: makeData() });

    await handleResetAction(interaction as never, testConfig(), makeSession(), {
      action: 'reset-confirm',
      extra: 'all',
      resetHandler,
      notify: vi.fn(),
    });

    expect(resetHandler).toHaveBeenCalledWith(expect.anything(), expect.anything(), [
      'crossChannelHistoryEnabled',
      'crossChannelRenderMode',
      'maxMessages',
    ]);
    const stored = mockSessionManager.set.mock.calls.at(-1)?.[0];
    expect(stored.data.view).toBe(DashboardView.INDEX);
    expect(embedTitle(interaction)).toBe('Test Settings · Index');
  });

  it('confirm failure notifies ephemerally and leaves the confirm surface', async () => {
    const interaction = makeInteraction();
    const resetHandler = vi.fn().mockResolvedValue({ success: false, error: 'API down' });

    await handleResetAction(interaction as never, testConfig(), makeSession(), {
      action: 'reset-confirm',
      extra: 'page:memory',
      resetHandler,
      notify: vi.fn(),
    });

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Failed to reset: API down') })
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('confirm with nothing left to clear writes nothing and re-renders', async () => {
    const interaction = makeInteraction();
    const resetHandler = vi.fn();

    await handleResetAction(interaction as never, testConfig(), makeSession(), {
      action: 'reset-confirm',
      extra: 'page:voice',
      resetHandler,
      notify: vi.fn(),
    });

    expect(resetHandler).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('stale scope answers with the out-of-date notice', async () => {
    const assertStale = async (
      config: SettingsDashboardConfig,
      extra: string | undefined,
      resetHandler: SettingsResetHandler | undefined
    ) => {
      const interaction = makeInteraction();
      const notify = vi.fn().mockResolvedValue(undefined);

      await handleResetAction(interaction as never, config, makeSession(), {
        action: 'reset',
        extra,
        resetHandler,
        notify,
      });

      expect(notify).toHaveBeenCalledWith(STALE_DASHBOARD_NOTICE);
      expect(interaction.editReply).not.toHaveBeenCalled();
    };

    // Unknown page id.
    await assertStale(testConfig(), 'page:nonexistent', vi.fn());
    // 'all' on a dashboard without resetAll.
    await assertStale({ ...testConfig(), resetAll: undefined }, 'all', vi.fn());
    // Scope-less on a dashboard without the legacy flag.
    await assertStale(testConfig(), undefined, vi.fn());
    // A valid scope but no reset handler wired.
    await assertStale(testConfig(), 'page:memory', undefined);
  });

  it('a scope-less reset reads as Reset all only where legacyBareResetMeansAll is set', async () => {
    const legacyConfig = { ...testConfig(), legacyBareResetMeansAll: true };

    const promptInteraction = makeInteraction();
    await handleResetAction(promptInteraction as never, legacyConfig, makeSession(), {
      action: 'reset',
      extra: undefined,
      resetHandler: vi.fn(),
      notify: vi.fn(),
    });
    expect(confirmButtonIds(promptInteraction)).toEqual([
      'test-settings::reset-cancel::entity-1::all',
      'test-settings::reset-confirm::entity-1::all',
    ]);

    const confirmInteraction = makeInteraction();
    const resetHandler = vi.fn().mockResolvedValue({ success: true, newData: makeData() });
    await handleResetAction(confirmInteraction as never, legacyConfig, makeSession(), {
      action: 'reset-confirm',
      extra: undefined,
      resetHandler,
      notify: vi.fn(),
    });
    expect(resetHandler).toHaveBeenCalledWith(expect.anything(), expect.anything(), [
      'crossChannelHistoryEnabled',
      'crossChannelRenderMode',
      'maxMessages',
    ]);
  });

  it("cancel returns to the scope's view without writing", async () => {
    const interaction = makeInteraction();
    const resetHandler = vi.fn();

    await handleResetAction(interaction as never, testConfig(), makeSession(), {
      action: 'reset-cancel',
      extra: 'page:context',
      resetHandler,
      notify: vi.fn(),
    });

    expect(resetHandler).not.toHaveBeenCalled();
    expect(embedTitle(interaction)).toContain('Context');
  });

  it('cancel with an unresolvable scope behaves like Back', async () => {
    const interaction = makeInteraction();

    await handleResetAction(interaction as never, testConfig(), makeSession({ page: 0 }), {
      action: 'reset-cancel',
      extra: 'page:nonexistent',
      resetHandler: vi.fn(),
      notify: vi.fn(),
    });

    // handleBackButton re-renders the session's CURRENT page (Back has no
    // scope to resolve to), never the unresolvable one from the customId.
    expect(embedTitle(interaction)).toBe('Test Settings · Memory');
  });

  it('escapes markdown in the entity name on the confirm surface', async () => {
    const entityName = '**bold** _it_ [x](https://e.example)';
    const interaction = makeInteraction();

    await handleResetAction(interaction as never, testConfig(), makeSession({ entityName }), {
      action: 'reset',
      extra: 'page:memory',
      resetHandler: vi.fn(),
      notify: vi.fn(),
    });

    const description = embedDescription(interaction);
    expect(description).toContain(escapeMarkdown(entityName, { maskedLink: true }));
    expect(description).not.toContain('**bold**');
  });
});
