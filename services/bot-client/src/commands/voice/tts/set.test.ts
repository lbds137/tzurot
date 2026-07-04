/**
 * Tests for /voice tts set handler.
 * Locks the BYOK gate + per-character TTS override flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

const { mockCheckTtsByokAccess } = vi.hoisted(() => ({
  mockCheckTtsByokAccess: vi.fn(),
}));

const stub = {
  setTtsOverride: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

vi.mock('./guestModeValidation.js', () => ({
  checkTtsByokAccess: mockCheckTtsByokAccess,
}));

vi.mock('@tzurot/common-types/generated/commandOptions', async () => {
  const actual = await vi.importActual<
    typeof import('@tzurot/common-types/generated/commandOptions')
  >('@tzurot/common-types/generated/commandOptions');
  return {
    ...actual,
    voiceTtsSetOptions: vi.fn(() => ({
      character: () => 'personality-uuid-1',
      tts: () => 'cfg-uuid-1',
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

const { handleTtsSet: handleSet } = await import('./set.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleTtsSet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub.setTtsOverride.mockReset();
  });

  it('blocks at command time when BYOK gate fails', async () => {
    mockCheckTtsByokAccess.mockResolvedValue({ blocked: true, reason: 'blocked-byok' });
    const context = makeContext();

    await handleSet(context as never);
    expect(stub.setTtsOverride).not.toHaveBeenCalled();
  });

  it('calls setTtsOverride on happy path', async () => {
    mockCheckTtsByokAccess.mockResolvedValue({ blocked: false, reason: 'has-key' });
    stub.setTtsOverride.mockResolvedValue(
      makeOk({
        override: {
          personalityId: 'personality-uuid-1',
          personalityName: 'Alice',
          configId: 'cfg-uuid-1',
          configName: 'kyutai-self-hosted',
        },
      })
    );
    const context = makeContext();

    await handleSet(context as never);

    expect(stub.setTtsOverride).toHaveBeenCalledWith({
      personalityId: 'personality-uuid-1',
      configId: 'cfg-uuid-1',
    });
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({ title: expect.stringContaining('Set') }),
          }),
        ],
      })
    );
  });

  it('shows error embed on gateway failure', async () => {
    mockCheckTtsByokAccess.mockResolvedValue({ blocked: false, reason: 'has-key' });
    stub.setTtsOverride.mockResolvedValue(makeErr(500, 'INTERNAL_ERROR'));
    const context = makeContext();

    await handleSet(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌') })
    );
  });
});
