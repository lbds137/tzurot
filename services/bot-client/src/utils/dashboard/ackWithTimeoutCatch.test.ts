/**
 * Tests for ackWithTimeoutCatch.
 *
 * Pins the generic first-ack 10062 contract for non-modal acks (reply /
 * update). The showModal-specific delegation is pinned separately in
 * showModalWithTimeoutCatch.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscordAPIError, MessageFlags } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

const { ackWithTimeoutCatch } = await import('./ackWithTimeoutCatch.js');

const DIAG = {
  source: 'handleTest',
  userId: 'user-1',
  entityId: 'entity-1',
  sectionId: 'edit',
};
const TIMEOUT_MSG = '⏰ Took too long, please retry.';

function make10062Error(): DiscordAPIError {
  return new DiscordAPIError(
    { code: 10062, message: 'Unknown interaction' },
    10062,
    404,
    'POST',
    '/interactions/x/y/callback',
    {}
  );
}

describe('ackWithTimeoutCatch', () => {
  beforeEach(() => {
    // Clear every logger method, not just warn — defensive against a future
    // test asserting on debug/info/error without realizing state leaked.
    Object.values(mockLogger).forEach(mock => mock.mockClear());
  });

  it('runs the ack thunk without a followUp on success', async () => {
    const ack = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn();
    const interaction = { followUp } as unknown as ButtonInteraction;

    await ackWithTimeoutCatch(interaction, ack, DIAG, TIMEOUT_MSG);

    expect(ack).toHaveBeenCalledTimes(1);
    expect(followUp).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('catches 10062, logs, and surfaces an ephemeral followUp', async () => {
    const ack = vi.fn().mockRejectedValue(make10062Error());
    const followUp = vi.fn().mockResolvedValue(undefined);
    const interaction = { followUp } as unknown as ButtonInteraction;

    await ackWithTimeoutCatch(interaction, ack, DIAG, TIMEOUT_MSG);

    expect(followUp).toHaveBeenCalledWith({
      content: TIMEOUT_MSG,
      flags: MessageFlags.Ephemeral,
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      DIAG,
      expect.stringContaining('exceeded 3-second window')
    );
  });

  it('swallows secondary 10062 on the followUp without a second warn', async () => {
    const err = make10062Error();
    const ack = vi.fn().mockRejectedValue(err);
    const followUp = vi.fn().mockRejectedValue(err);
    const interaction = { followUp } as unknown as ButtonInteraction;

    await expect(ackWithTimeoutCatch(interaction, ack, DIAG, TIMEOUT_MSG)).resolves.toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });

  it('logs warn when the followUp fails with a non-10062 error', async () => {
    const ack = vi.fn().mockRejectedValue(make10062Error());
    const networkErr = new Error('ECONNRESET');
    const followUp = vi.fn().mockRejectedValue(networkErr);
    const interaction = { followUp } as unknown as ButtonInteraction;

    await expect(ackWithTimeoutCatch(interaction, ack, DIAG, TIMEOUT_MSG)).resolves.toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    expect(mockLogger.warn).toHaveBeenLastCalledWith(
      expect.objectContaining({ err: networkErr }),
      expect.stringContaining('followUp after 10062 failed with unexpected error')
    );
  });

  it('rethrows non-10062 ack errors without a followUp', async () => {
    const ack = vi.fn().mockRejectedValue(new Error('boom'));
    const followUp = vi.fn();
    const interaction = { followUp } as unknown as ButtonInteraction;

    await expect(ackWithTimeoutCatch(interaction, ack, DIAG, TIMEOUT_MSG)).rejects.toThrow('boom');
    expect(followUp).not.toHaveBeenCalled();
  });

  it('rethrows non-10062 DiscordAPIError codes', async () => {
    const accessError = new DiscordAPIError(
      { code: 50001, message: 'Missing Access' },
      50001,
      403,
      'POST',
      '/interactions/x/y/callback',
      {}
    );
    const ack = vi.fn().mockRejectedValue(accessError);
    const followUp = vi.fn();
    const interaction = { followUp } as unknown as ButtonInteraction;

    await expect(ackWithTimeoutCatch(interaction, ack, DIAG, TIMEOUT_MSG)).rejects.toThrow(
      'Missing Access'
    );
  });
});
