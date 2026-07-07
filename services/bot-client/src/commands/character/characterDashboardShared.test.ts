/**
 * Focused tests for the shared open-dashboard flow's spec plumbing. The two
 * command wrappers (overrides/settings) exercise the full flow end-to-end in
 * their own suites; this file pins what the SPEC controls — the cascade
 * callback wiring, the tier passed to conversion, and the error-copy noun.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openCharacterCascadeDashboard } from './characterDashboardShared.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { SettingsDashboardConfig } from '../../utils/dashboard/settings/index.js';

const mockGetPersonality = vi.hoisted(() => vi.fn());
const mockCreateDashboard = vi.hoisted(() => vi.fn());
const mockConvert = vi.hoisted(() => vi.fn());

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: () => ({ userClient: { getPersonality: mockGetPersonality } }),
}));
vi.mock('../../utils/dashboard/settings/index.js', () => ({
  createSettingsDashboard: mockCreateDashboard,
}));
vi.mock('../../utils/dashboard/settings/settingsUpdateFactory.js', () => ({
  convertCascadeToSettingsData: mockConvert,
}));

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as never;

function makeContext(): DeferredCommandContext & { editReply: ReturnType<typeof vi.fn> } {
  return {
    interaction: {},
    user: { id: 'user-1' },
    editReply: vi.fn().mockResolvedValue(undefined),
  } as unknown as DeferredCommandContext & { editReply: ReturnType<typeof vi.fn> };
}

const dashboardConfig = { entityType: 'character-overrides' } as SettingsDashboardConfig;

describe('openCharacterCascadeDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPersonality.mockResolvedValue({
      ok: true,
      data: { personality: { id: 'pers-1', name: 'Ivy', slug: 'ivy' } },
    });
    mockConvert.mockReturnValue({ converted: true });
    mockCreateDashboard.mockResolvedValue(undefined);
  });

  it('threads the spec cascade callback and tier through to the dashboard', async () => {
    const resolveCascade = vi.fn().mockResolvedValue({ ok: true, data: { some: 'cascade' } });
    const context = makeContext();

    await openCharacterCascadeDashboard(context, 'ivy', {
      dashboardConfig,
      sourceTier: 'user-personality',
      resolveCascade,
      noun: 'overrides',
      logger,
    });

    expect(resolveCascade).toHaveBeenCalledWith(expect.anything(), 'pers-1');
    expect(mockConvert).toHaveBeenCalledWith({ some: 'cascade' }, 'user-personality');
    expect(mockCreateDashboard).toHaveBeenCalledWith(
      context.interaction,
      expect.objectContaining({
        config: dashboardConfig,
        entityId: 'pers-1',
        entityName: 'Ivy (ivy)',
        userId: 'user-1',
      })
    );
  });

  it('404s politely on an unknown slug without touching the cascade', async () => {
    mockGetPersonality.mockResolvedValue({ ok: false, status: 404 });
    const resolveCascade = vi.fn();
    const context = makeContext();

    await openCharacterCascadeDashboard(context, 'ghost', {
      dashboardConfig,
      sourceTier: 'personality',
      resolveCascade,
      noun: 'settings',
      logger,
    });

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ Character "ghost" not found.',
    });
    expect(resolveCascade).not.toHaveBeenCalled();
  });

  it('uses the spec noun in the catch-all error copy', async () => {
    mockCreateDashboard.mockRejectedValue(new Error('render exploded'));
    const context = makeContext();

    await openCharacterCascadeDashboard(context, 'ivy', {
      dashboardConfig,
      sourceTier: 'personality',
      resolveCascade: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      noun: 'settings',
      logger,
    });

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ An error occurred while opening the settings dashboard.',
    });
  });

  it('reports a cascade failure without opening the dashboard, logging the error detail', async () => {
    const context = makeContext();

    await openCharacterCascadeDashboard(context, 'ivy', {
      dashboardConfig,
      sourceTier: 'user-personality',
      resolveCascade: vi.fn().mockResolvedValue({ ok: false, error: 'gateway timeout' }),
      noun: 'overrides',
      logger,
    });

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ Failed to fetch config settings.',
    });
    expect(mockCreateDashboard).not.toHaveBeenCalled();
    expect(vi.mocked((logger as { warn: unknown }).warn)).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'gateway timeout' }),
      'Cascade resolve failed'
    );
  });
});
