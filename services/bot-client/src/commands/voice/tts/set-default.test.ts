/**
 * Tests for /voice tts set-default handler.
 * Locks the BYOK-gate-then-mutation flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

const { mockCheckTtsByokAccess } = vi.hoisted(() => ({
  mockCheckTtsByokAccess: vi.fn(),
}));

const stub = {
  setTtsDefaultConfig: vi.fn(),
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
    voiceTtsSetDefaultOptions: vi.fn(() => ({
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

const { handleTtsSetDefault: handleSetDefault } = await import('./set-default.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleSetDefault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub.setTtsDefaultConfig.mockReset();
  });

  it('blocks at command time when BYOK gate fails', async () => {
    mockCheckTtsByokAccess.mockResolvedValue({ blocked: true, reason: 'blocked-byok' });
    const context = makeContext();

    await handleSetDefault(context as never);

    expect(stub.setTtsDefaultConfig).not.toHaveBeenCalled();
  });

  it('calls setTtsDefaultConfig on happy path', async () => {
    mockCheckTtsByokAccess.mockResolvedValue({ blocked: false, reason: 'self-hosted' });
    stub.setTtsDefaultConfig.mockResolvedValue(
      makeOk({ default: { configId: 'cfg-uuid-1', configName: 'kyutai-self-hosted' } })
    );
    const context = makeContext();

    await handleSetDefault(context as never);

    expect(stub.setTtsDefaultConfig).toHaveBeenCalledWith({ configId: 'cfg-uuid-1' });
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({ title: expect.stringContaining('Default TTS') }),
          }),
        ],
      })
    );
  });

  it('shows error embed on gateway failure', async () => {
    mockCheckTtsByokAccess.mockResolvedValue({ blocked: false, reason: 'has-key' });
    stub.setTtsDefaultConfig.mockResolvedValue(makeErr(500, 'INTERNAL_ERROR'));
    const context = makeContext();

    await handleSetDefault(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌') })
    );
  });
});
