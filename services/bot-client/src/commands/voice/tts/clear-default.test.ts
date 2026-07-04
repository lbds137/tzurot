/**
 * Tests for /voice tts clear-default handler.
 * Smoke-tests happy path + gateway-error path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

const stub = {
  clearTtsDefaultConfig: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

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

import { mockClearTtsDefaultConfigResponse } from '@tzurot/test-factories';

const { handleTtsClearDefault: handleClearDefault } = await import('./clear-default.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleClearDefault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub.clearTtsDefaultConfig.mockReset();
  });

  it('calls clearTtsDefaultConfig and shows success embed', async () => {
    stub.clearTtsDefaultConfig.mockResolvedValue(makeOk(mockClearTtsDefaultConfigResponse()));
    const context = makeContext();

    await handleClearDefault(context as never);

    expect(stub.clearTtsDefaultConfig).toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({ title: expect.stringContaining('Cleared') }),
          }),
        ],
      })
    );
  });

  it('renders the new effective default name when one exists', async () => {
    stub.clearTtsDefaultConfig.mockResolvedValue(
      makeOk(
        mockClearTtsDefaultConfigResponse({
          newEffectiveDefault: { id: 'free-id', name: 'kyutai-self-hosted' },
        })
      )
    );
    const context = makeContext();

    await handleClearDefault(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining('kyutai-self-hosted'),
            }),
          }),
        ],
      })
    );
  });

  it('renders hardcoded-fallback notice when newEffectiveDefault is null', async () => {
    stub.clearTtsDefaultConfig.mockResolvedValue(
      makeOk(mockClearTtsDefaultConfigResponse({ newEffectiveDefault: null }))
    );
    const context = makeContext();

    await handleClearDefault(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining('built-in fallback'),
            }),
          }),
        ],
      })
    );
  });

  it('shows error message on gateway failure', async () => {
    stub.clearTtsDefaultConfig.mockResolvedValue(makeErr(500, 'INTERNAL_ERROR'));
    const context = makeContext();

    await handleClearDefault(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('❌') })
    );
  });

  it('catches and reports unexpected errors', async () => {
    stub.clearTtsDefaultConfig.mockRejectedValue(new Error('network down'));
    const context = makeContext();

    await handleClearDefault(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('error occurred') })
    );
  });
});
