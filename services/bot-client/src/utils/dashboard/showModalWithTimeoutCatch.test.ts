/**
 * Tests for showModalWithTimeoutCatch.
 *
 * Pins the 10062 contract: log + ephemeral followUp + swallow secondary
 * 10062. Non-10062 errors rethrow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscordAPIError, MessageFlags, type ModalBuilder } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';

// Shared mock logger so tests can assert against `mockLogger.warn`
// (the helper logs unexpected followUp failures there). vi.hoisted is
// required because vi.mock factories are hoisted above const declarations.
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

const { showModalWithTimeoutCatch } = await import('./showModalWithTimeoutCatch.js');

const FAKE_MODAL = { __modal: true } as unknown as ModalBuilder;
const DIAG = {
  source: 'handleTest',
  userId: 'user-1',
  entityId: 'entity-1',
  sectionId: 'identity',
};
const RETRY = '⏰ Took too long, please retry.';

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

describe('showModalWithTimeoutCatch', () => {
  // Reset all mock fn state between tests so warn-call-count assertions
  // don't leak across tests if execution order changes or a new test is
  // inserted between two count-asserting tests. Per 02-code-standards.md:
  // "Each it() block sets up its own data; never depend on side effects
  // from prior tests."
  beforeEach(() => {
    mockLogger.warn.mockClear();
  });

  it('forwards a successful showModal call without a followUp', async () => {
    const showModal = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn();
    const interaction = { showModal, followUp } as unknown as ButtonInteraction;

    await showModalWithTimeoutCatch(interaction, FAKE_MODAL, DIAG, RETRY);

    expect(showModal).toHaveBeenCalledWith(FAKE_MODAL);
    expect(followUp).not.toHaveBeenCalled();
  });

  it('catches 10062 and surfaces an ephemeral retry followUp', async () => {
    const showModal = vi.fn().mockRejectedValue(make10062Error());
    const followUp = vi.fn().mockResolvedValue(undefined);
    const interaction = { showModal, followUp } as unknown as ButtonInteraction;

    await showModalWithTimeoutCatch(interaction, FAKE_MODAL, DIAG, RETRY);

    expect(followUp).toHaveBeenCalledWith({
      content: RETRY,
      flags: MessageFlags.Ephemeral,
    });
  });

  it('swallows secondary 10062 on the followUp without logging (fully-dead token)', async () => {
    // When the interaction token is fully dead, even the followUp throws
    // 10062. The helper must not propagate that — the outer CommandHandler
    // catch would re-log and re-attempt a send. AND it must NOT log warn
    // for this expected case, since 10062-after-10062 is the documented
    // fully-dead-token path.
    const err = make10062Error();
    const showModal = vi.fn().mockRejectedValue(err);
    const followUp = vi.fn().mockRejectedValue(err);
    const interaction = { showModal, followUp } as unknown as ButtonInteraction;

    await expect(
      showModalWithTimeoutCatch(interaction, FAKE_MODAL, DIAG, RETRY)
    ).resolves.toBeUndefined();
    expect(followUp).toHaveBeenCalled();
    // First warn is the 10062 on showModal; no second warn for the
    // followUp's 10062 (that's the expected fully-dead-token signal).
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });

  it('logs warn when followUp fails with a non-10062 error', async () => {
    // Network partition, rate limit, or any non-10062 Discord error on
    // the followUp is genuinely unexpected — the helper must surface it
    // via warn (with the original showModal-10062 warn already emitted
    // first). Without this, observability into followUp infrastructure
    // failures is invisible.
    const showModal = vi.fn().mockRejectedValue(make10062Error());
    const networkErr = new Error('ECONNRESET');
    const followUp = vi.fn().mockRejectedValue(networkErr);
    const interaction = { showModal, followUp } as unknown as ButtonInteraction;

    await expect(
      showModalWithTimeoutCatch(interaction, FAKE_MODAL, DIAG, RETRY)
    ).resolves.toBeUndefined();
    // Two warn calls: 1) showModal 10062, 2) followUp non-10062 unexpected.
    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    expect(mockLogger.warn).toHaveBeenLastCalledWith(
      expect.objectContaining({ err: networkErr }),
      expect.stringContaining('followUp after 10062 failed with unexpected error')
    );
  });

  it('rethrows non-10062 showModal errors', async () => {
    const unexpected = new Error('boom');
    const showModal = vi.fn().mockRejectedValue(unexpected);
    const followUp = vi.fn();
    const interaction = { showModal, followUp } as unknown as ButtonInteraction;

    await expect(showModalWithTimeoutCatch(interaction, FAKE_MODAL, DIAG, RETRY)).rejects.toThrow(
      'boom'
    );
    expect(followUp).not.toHaveBeenCalled();
  });

  it('rethrows non-10062 DiscordAPIError codes', async () => {
    // 50001 (Missing Access) is a different DiscordAPIError; should rethrow,
    // not get treated as a 3-sec budget timeout.
    const accessError = new DiscordAPIError(
      { code: 50001, message: 'Missing Access' },
      50001,
      403,
      'POST',
      '/interactions/x/y/callback',
      {}
    );
    const showModal = vi.fn().mockRejectedValue(accessError);
    const followUp = vi.fn();
    const interaction = { showModal, followUp } as unknown as ButtonInteraction;

    await expect(showModalWithTimeoutCatch(interaction, FAKE_MODAL, DIAG, RETRY)).rejects.toThrow(
      'Missing Access'
    );
  });
});
