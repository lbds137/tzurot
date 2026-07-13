import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import type { SettingsDashboardSession } from '../../utils/dashboard/settings/index.js';

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

import { handleSystemSettingUpdate } from './settingsSystemUpdate.js';

const UPDATED_AT = '2026-07-12T10:00:00.000Z';

function makeStub(): {
  getSystemSettings: ReturnType<typeof vi.fn>;
  updateSystemSettings: ReturnType<typeof vi.fn>;
} {
  return { getSystemSettings: vi.fn(), updateSystemSettings: vi.fn() };
}

function makeInteraction(): ButtonInteraction & { followUp: ReturnType<typeof vi.fn> } {
  return {
    user: { id: 'owner-1' },
    followUp: vi.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction & { followUp: ReturnType<typeof vi.fn> };
}

function makeSession(): SettingsDashboardSession {
  return {
    level: 'global',
    entityId: 'global',
    entityName: 'Global Settings',
    data: {
      maxMessages: { localValue: 50, hasLocalOverride: true, effectiveValue: 50, source: 'admin' },
      extractionEnabled: {
        localValue: true,
        hasLocalOverride: true,
        effectiveValue: true,
        source: 'admin',
      },
    },
    view: 'setting' as never,
    userId: 'owner-1',
    messageId: 'msg-1',
    channelId: 'chan-1',
    lastActivityAt: new Date(),
  };
}

describe('handleSystemSettingUpdate', () => {
  let stub: ReturnType<typeof makeStub>;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
    stub.getSystemSettings.mockResolvedValue({
      ok: true,
      data: { systemSettings: { extractionEnabled: true }, updatedAt: UPDATED_AT },
    });
    stub.updateSystemSettings.mockResolvedValue({
      ok: true,
      data: {
        systemSettings: { extractionEnabled: false },
        updatedAt: '2026-07-12T10:00:01.000Z',
        warnings: [],
      },
    });
    clientsForMock.mockReturnValue({ ownerClient: stub });
  });

  it('reads the bag FRESH per write and sends the single-key envelope (the seam contract)', async () => {
    const result = await handleSystemSettingUpdate(
      makeInteraction(),
      makeSession(),
      'extractionEnabled',
      false
    );

    expect(stub.getSystemSettings).toHaveBeenCalledTimes(1);
    expect(stub.updateSystemSettings).toHaveBeenCalledWith({
      expectedUpdatedAt: UPDATED_AT,
      patch: { extractionEnabled: false },
    });
    expect(result.success).toBe(true);
  });

  it('merges the refreshed bag over the session map, preserving cascade entries', async () => {
    const result = await handleSystemSettingUpdate(
      makeInteraction(),
      makeSession(),
      'extractionEnabled',
      false
    );

    expect(result.newData?.maxMessages).toBeDefined(); // cascade entry survives
    expect(result.newData?.extractionEnabled?.effectiveValue).toBe(false); // refreshed
  });

  it('returns the changed-underneath-you hint on 409', async () => {
    stub.updateSystemSettings.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'updatedAt mismatch',
    });

    const result = await handleSystemSettingUpdate(
      makeInteraction(),
      makeSession(),
      'extractionEnabled',
      false
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Settings changed underneath you');
  });

  it('fails soft when the fresh read fails (no blind write without a token)', async () => {
    stub.getSystemSettings.mockResolvedValue({ ok: false, status: 500, error: 'unavailable' });

    const result = await handleSystemSettingUpdate(
      makeInteraction(),
      makeSession(),
      'extractionEnabled',
      false
    );

    expect(result.success).toBe(false);
    expect(stub.updateSystemSettings).not.toHaveBeenCalled();
  });

  it('relays write warnings as an ephemeral followUp', async () => {
    stub.updateSystemSettings.mockResolvedValue({
      ok: true,
      data: {
        systemSettings: { fallbackTextModel: 'some/model' },
        updatedAt: '2026-07-12T10:00:01.000Z',
        warnings: ['catalog unavailable — accepted unverified'],
      },
    });
    const interaction = makeInteraction();

    await handleSystemSettingUpdate(interaction, makeSession(), 'fallbackTextModel', 'some/model');

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('catalog unavailable') })
    );
  });
});
