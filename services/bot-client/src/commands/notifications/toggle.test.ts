/**
 * Tests for /notifications on|off handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr } from '../../test/gatewayClientStubs.js';
import { mockUpdateNotificationPrefsResponse } from '@tzurot/test-factories';
import type { UserClient } from '@tzurot/clients';

const stub = {
  updateNotificationPrefs: vi.fn(),
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

const { handleNotificationsEnable, handleNotificationsDisable } = await import('./toggle.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('notifications toggle handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub.updateNotificationPrefs.mockReset();
  });

  it('on → PATCHes enabled: true and confirms', async () => {
    stub.updateNotificationPrefs.mockResolvedValue(
      makeOk(mockUpdateNotificationPrefsResponse({ enabled: true, level: 'minor' }))
    );
    const context = makeContext();

    await handleNotificationsEnable(context as never);

    expect(stub.updateNotificationPrefs).toHaveBeenCalledWith({ enabled: true });
    const call = context.editReply.mock.calls[0][0] as {
      embeds: { data: { description?: string } }[];
    };
    expect(call.embeds[0].data.description).toContain('DMs are **on**');
  });

  it('off → PATCHes enabled: false and confirms', async () => {
    stub.updateNotificationPrefs.mockResolvedValue(
      makeOk(mockUpdateNotificationPrefsResponse({ enabled: false, level: 'minor' }))
    );
    const context = makeContext();

    await handleNotificationsDisable(context as never);

    expect(stub.updateNotificationPrefs).toHaveBeenCalledWith({ enabled: false });
    const call = context.editReply.mock.calls[0][0] as {
      embeds: { data: { description?: string } }[];
    };
    expect(call.embeds[0].data.description).toContain('DMs are **off**');
  });

  it('surfaces the gateway message on an http failure', async () => {
    stub.updateNotificationPrefs.mockResolvedValue(makeErr(500, 'boom'));
    const context = makeContext();

    await handleNotificationsEnable(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('boom'),
    });
  });

  it('falls back to the generic error on a thrown failure', async () => {
    stub.updateNotificationPrefs.mockRejectedValue(new Error('network'));
    const context = makeContext();

    await handleNotificationsDisable(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to disable release-notes DMs'),
    });
  });
});
