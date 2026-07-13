import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSettingsModal } from './settingsModalSubmit.js';
import { type SettingsDashboardConfig, type SettingDefinition, SettingType } from './types.js';
import { EXTENDED_CONTEXT_SETTINGS } from './settingsConfig.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';

const mockSessionManager = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../SessionManager.js', () => ({
  getSessionManager: vi.fn(() => mockSessionManager),
}));

const TEXT_SETTING: SettingDefinition = {
  id: 'sysModel',
  label: 'Sys Model',
  emoji: '🤖',
  description: 'A system model field.',
  type: SettingType.TEXT,
  plainDisplay: true,
};

const NUMERIC_PLAIN_SETTING: SettingDefinition = {
  id: 'sysThreshold',
  label: 'Sys Threshold',
  emoji: '📦',
  description: 'A system integer.',
  type: SettingType.NUMERIC,
  min: 1,
  max: 50,
  plainDisplay: true,
};

const config = (): SettingsDashboardConfig => ({
  level: 'global',
  entityType: 'test-settings',
  titlePrefix: 'Test',
  color: DISCORD_COLORS.BLURPLE,
  settings: [...EXTENDED_CONTEXT_SETTINGS, TEXT_SETTING, NUMERIC_PLAIN_SETTING],
});

const sessionData = () => ({
  maxMessages: { localValue: null, hasLocalOverride: false, effectiveValue: 50, source: 'admin' },
  sysModel: {
    localValue: 'openrouter/auto',
    hasLocalOverride: true,
    effectiveValue: 'openrouter/auto',
    source: 'admin',
  },
  sysThreshold: { localValue: 6, hasLocalOverride: true, effectiveValue: 6, source: 'admin' },
});

const session = (activeSetting: string, extra: Record<string, unknown> = {}) => ({
  data: {
    userId: 'user-123',
    entityId: 'entity-1',
    entityName: 'Entity',
    data: sessionData(),
    view: 'setting',
    activeSetting,
    ...extra,
  },
});

const modal = (customId: string, inputValue: string) => ({
  customId,
  user: { id: 'user-123' },
  fields: { getTextInputValue: vi.fn().mockReturnValue(inputValue) },
  reply: vi.fn(),
  deferUpdate: vi.fn(),
  editReply: vi.fn().mockResolvedValue(undefined),
  followUp: vi.fn().mockResolvedValue(undefined),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TEXT modal path', () => {
  it('passes the trimmed string to the update handler (regression: the old fallthrough sent undefined → empty patch)', async () => {
    mockSessionManager.get.mockReturnValue(session('sysModel'));
    const interaction = modal('test-settings::modal::entity-1::sysModel', '  openrouter/auto  ');
    const updateHandler = vi.fn().mockResolvedValue({ success: true });

    await handleSettingsModal(interaction as never, config(), updateHandler);

    expect(updateHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'sysModel',
      'openrouter/auto'
    );
  });

  it('rejects empty input with a named error + Try-again button, storing the rejected value', async () => {
    mockSessionManager.get.mockReturnValue(session('sysModel'));
    const interaction = modal('test-settings::modal::entity-1::sysModel', '   ');
    const updateHandler = vi.fn();

    await handleSettingsModal(interaction as never, config(), updateHandler);

    expect(updateHandler).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('cannot be empty'),
        components: expect.any(Array),
      })
    );
    const stored = mockSessionManager.set.mock.calls.at(-1)?.[0];
    expect(stored.data.lastRejectedInput).toEqual({ settingId: 'sysModel', value: '   ' });
  });
});

describe('plain-setting null guard (modal path)', () => {
  it('rejects an empty NUMERIC input on a plain setting instead of sending null to the gateway', async () => {
    mockSessionManager.get.mockReturnValue(session('sysThreshold'));
    const interaction = modal('test-settings::modal::entity-1::sysThreshold', '');
    const updateHandler = vi.fn();

    await handleSettingsModal(interaction as never, config(), updateHandler);

    expect(updateHandler).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('no Auto') })
    );
  });
});

describe('retry affordance on update-handler failure', () => {
  it('surfaces an update-handler rejection through the same retry shape', async () => {
    mockSessionManager.get.mockReturnValue(session('sysModel'));
    const interaction = modal('test-settings::modal::entity-1::sysModel', 'not-a-model');
    const updateHandler = vi
      .fn()
      .mockResolvedValue({ success: false, error: 'not in the catalog' });

    await handleSettingsModal(interaction as never, config(), updateHandler);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('not in the catalog') })
    );
    const stored = mockSessionManager.set.mock.calls.at(-1)?.[0];
    expect(stored.data.lastRejectedInput).toEqual({ settingId: 'sysModel', value: 'not-a-model' });
  });

  it('a successful update clears any pending rejected input', async () => {
    mockSessionManager.get.mockReturnValue(
      session('sysModel', { lastRejectedInput: { settingId: 'sysModel', value: 'old-bad' } })
    );
    const interaction = modal('test-settings::modal::entity-1::sysModel', 'openrouter/auto');
    const updateHandler = vi.fn().mockResolvedValue({ success: true });

    await handleSettingsModal(interaction as never, config(), updateHandler);

    const stored = mockSessionManager.set.mock.calls.at(-1)?.[0];
    expect(stored.data.lastRejectedInput).toBeUndefined();
  });
});
