/**
 * Tests for /notifications view handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr } from '../../test/gatewayClientStubs.js';
import { mockGetNotificationPrefsResponse } from '@tzurot/test-factories';
import type { UserClient } from '@tzurot/clients';

const stub = {
  getNotificationPrefs: vi.fn(),
};

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const { handleNotificationsView } = await import('./view.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleNotificationsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub.getNotificationPrefs.mockReset();
  });

  it('shows the stored prefs in an embed', async () => {
    stub.getNotificationPrefs.mockResolvedValue(
      makeOk(mockGetNotificationPrefsResponse({ enabled: true, level: 'minor' }))
    );
    const context = makeContext();

    await handleNotificationsView(context as never);

    expect(stub.getNotificationPrefs).toHaveBeenCalledWith();
    const call = context.editReply.mock.calls[0][0] as {
      embeds: { data: { fields?: { name: string; value: string }[] } }[];
    };
    expect(call.embeds).toHaveLength(1);
    const levelField = call.embeds[0].data.fields?.find(f => f.name === 'Level');
    expect(levelField?.value).toContain('Minor');
  });

  it('states DMs are off when disabled', async () => {
    stub.getNotificationPrefs.mockResolvedValue(
      makeOk(mockGetNotificationPrefsResponse({ enabled: false, level: 'major' }))
    );
    const context = makeContext();

    await handleNotificationsView(context as never);

    const call = context.editReply.mock.calls[0][0] as {
      embeds: { data: { description?: string } }[];
    };
    expect(call.embeds[0].data.description).toContain('DMs are **off**');
  });

  it('surfaces the gateway message on an http failure', async () => {
    stub.getNotificationPrefs.mockResolvedValue(makeErr(500, 'boom'));
    const context = makeContext();

    await handleNotificationsView(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('boom'),
    });
  });

  it('falls back to the generic error on a thrown failure', async () => {
    stub.getNotificationPrefs.mockRejectedValue(new Error('network'));
    const context = makeContext();

    await handleNotificationsView(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to load your notification settings'),
    });
  });

  it('renders the read-transient copy on a network failure, never write-uncertainty', async () => {
    // Pins operation: 'read' — a failed FETCH must not claim "your change may
    // still be applying" (nothing was submitted).
    stub.getNotificationPrefs.mockResolvedValue(makeErr(0, 'socket hangup', undefined, 'network'));
    const context = makeContext();

    await handleNotificationsView(context as never);

    const call = context.editReply.mock.calls[0][0] as { content: string };
    expect(call.content).toContain("Couldn't load");
    expect(call.content).not.toContain('still be applying');
  });
});
