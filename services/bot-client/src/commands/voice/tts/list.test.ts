/**
 * Tests for /voice tts browse handler.
 * Verifies override-list rendering for empty + populated cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/common-types';

const stub = {
  listTtsOverrides: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
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

const { handleTtsListOverrides: handleListOverrides } = await import('./list.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('handleListOverrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub.listTtsOverrides.mockReset();
  });

  it('shows empty-state guidance when no overrides', async () => {
    stub.listTtsOverrides.mockResolvedValue(makeOk({ overrides: [] }));
    const context = makeContext();

    await handleListOverrides(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining("haven't set"),
            }),
          }),
        ],
      })
    );
  });

  it('renders override list with personality+config names', async () => {
    stub.listTtsOverrides.mockResolvedValue(
      makeOk({
        overrides: [
          {
            personalityId: 'p1',
            personalityName: 'Alice',
            configId: 'c1',
            configName: 'kyutai-self-hosted',
          },
        ],
      })
    );
    const context = makeContext();

    await handleListOverrides(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining('Alice'),
            }),
          }),
        ],
      })
    );
  });

  it('shows error message on gateway failure', async () => {
    stub.listTtsOverrides.mockResolvedValue(makeErr(500, 'INTERNAL_ERROR'));
    const context = makeContext();

    await handleListOverrides(context as never);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Failed') })
    );
  });
});
