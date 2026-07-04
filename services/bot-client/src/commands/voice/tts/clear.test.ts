/**
 * Tests for /voice tts clear handler.
 * Verifies the per-character clear flow + idempotent wasSet messaging.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

const stub = {
  deleteTtsOverride: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

vi.mock('@tzurot/common-types/generated/commandOptions', async () => {
  const actual = await vi.importActual<
    typeof import('@tzurot/common-types/generated/commandOptions')
  >('@tzurot/common-types/generated/commandOptions');
  return {
    ...actual,
    voiceTtsClearOptions: vi.fn(() => ({
      character: () => 'personality-uuid-1',
    })),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

vi.mock('../../../utils/apiCheck.js', () => ({
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE: '⚠️ Autocomplete unavailable',
  isAutocompleteErrorSentinel: vi.fn(() => false),
}));

const { handleTtsClear: handleClear } = await import('./clear.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleTtsClear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub.deleteTtsOverride.mockReset();
  });

  it('shows success embed when an override was actually removed', async () => {
    stub.deleteTtsOverride.mockResolvedValue(makeOk({ deleted: true }));
    const context = makeContext();

    await handleClear(context as never);

    expect(stub.deleteTtsOverride).toHaveBeenCalledWith('personality-uuid-1');
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({ title: expect.stringContaining('Removed') }),
          }),
        ],
      })
    );
  });

  it('shows info embed when no override was set (wasSet: false)', async () => {
    stub.deleteTtsOverride.mockResolvedValue(makeOk({ deleted: true, wasSet: false }));
    const context = makeContext();

    await handleClear(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({ title: expect.stringContaining('No Override') }),
          }),
        ],
      })
    );
  });

  it('shows error message on gateway failure', async () => {
    stub.deleteTtsOverride.mockResolvedValue(makeErr(500, 'INTERNAL_ERROR'));
    const context = makeContext();

    await handleClear(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌') })
    );
  });
});
