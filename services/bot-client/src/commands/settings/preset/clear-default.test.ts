/**
 * Tests for Preset Clear-Default Handler
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleClearDefault } from './clear-default.js';
import { mockClearDefaultConfigResponse } from '@tzurot/test-factories';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

const stub = {
  clearDefaultModelConfig: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

describe('handleClearDefault', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stub.clearDefaultModelConfig.mockReset();
    mockEditReply.mockResolvedValue(undefined);
  });

  function createMockContext(kind?: string) {
    return {
      user: { id: '123456789', username: 'testuser' },
      interaction: {
        // The `kind` option is optional (null → handler defaults to text).
        options: {
          getString: (_name: string, _required?: boolean) => kind ?? null,
        },
      } as never,
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleClearDefault>[0];
  }

  it('clears BOTH default slots when no slot is given', async () => {
    stub.clearDefaultModelConfig.mockResolvedValue(makeOk(mockClearDefaultConfigResponse()));

    await handleClearDefault(createMockContext());

    expect(stub.clearDefaultModelConfig).toHaveBeenCalledWith({ kind: 'all' });
  });

  it('should clear the vision default when kind=vision', async () => {
    stub.clearDefaultModelConfig.mockResolvedValue(makeOk(mockClearDefaultConfigResponse()));

    await handleClearDefault(createMockContext('vision'));

    expect(stub.clearDefaultModelConfig).toHaveBeenCalledWith({ kind: 'vision' });
    // The vision path completes through to the success embed, same as text.
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({ title: '✅ Default Preset Cleared' }),
        }),
      ],
    });
  });

  it('should show success embed when config cleared', async () => {
    stub.clearDefaultModelConfig.mockResolvedValue(makeOk(mockClearDefaultConfigResponse()));

    await handleClearDefault(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '✅ Default Preset Cleared',
          }),
        }),
      ],
    });
  });

  it('should render the new effective default name when one exists', async () => {
    stub.clearDefaultModelConfig.mockResolvedValue(
      makeOk(
        mockClearDefaultConfigResponse({
          newEffectiveDefault: { id: 'free-id', name: 'gpt-4-free' },
        })
      )
    );

    await handleClearDefault(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining('gpt-4-free'),
          }),
        }),
      ],
    });
  });

  it('should render hardcoded-fallback notice when no system default is configured', async () => {
    stub.clearDefaultModelConfig.mockResolvedValue(
      makeOk(mockClearDefaultConfigResponse({ newEffectiveDefault: null }))
    );

    await handleClearDefault(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining('built-in fallback'),
          }),
        }),
      ],
    });
  });

  it('should show error when API fails', async () => {
    stub.clearDefaultModelConfig.mockResolvedValue(makeErr(500, 'Internal server error'));

    await handleClearDefault(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to clear default: Internal server error',
    });
  });

  it('should handle exceptions', async () => {
    stub.clearDefaultModelConfig.mockRejectedValue(new Error('Network error'));

    await handleClearDefault(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An error occurred. Please try again later.',
    });
  });
});
