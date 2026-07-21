/**
 * Tests for Preset Clear-Default Handler
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleClearDefault } from './clear-default.js';
import { mockClearDefaultConfigResponse } from '@tzurot/test-factories';
import { makeOk, makeErr } from '../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

const stub = {
  clearDefaultModelConfig: vi.fn(),
};

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

// Mock logger
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

describe('handleClearDefault', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stub.clearDefaultModelConfig.mockReset();
    mockEditReply.mockResolvedValue(undefined);
  });

  function createMockContext(slot?: string) {
    return {
      user: { id: '123456789', username: 'testuser' },
      interaction: {
        // The `slot` option is optional (null → handler clears both slots).
        options: {
          getString: (_name: string, _required?: boolean) => slot ?? null,
        },
      } as never,
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleClearDefault>[0];
  }

  it('clears BOTH default slots when no slot is given', async () => {
    stub.clearDefaultModelConfig.mockResolvedValue(makeOk(mockClearDefaultConfigResponse()));

    await handleClearDefault(createMockContext());

    expect(stub.clearDefaultModelConfig).toHaveBeenCalledWith({ slot: 'all' });
  });

  it('should clear the vision default when slot=vision', async () => {
    stub.clearDefaultModelConfig.mockResolvedValue(makeOk(mockClearDefaultConfigResponse()));

    await handleClearDefault(createMockContext('vision'));

    expect(stub.clearDefaultModelConfig).toHaveBeenCalledWith({ slot: 'vision' });
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
          newEffectiveDefaults: { text: { id: 'free-id', name: 'gpt-4-free' } },
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
      makeOk(mockClearDefaultConfigResponse({ newEffectiveDefaults: { text: null } }))
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

  it('renders BOTH slot fallbacks on an all-clear (the per-slot fix)', async () => {
    stub.clearDefaultModelConfig.mockResolvedValue(
      makeOk(
        mockClearDefaultConfigResponse({
          newEffectiveDefaults: {
            text: { id: 'text-free', name: 'chat-fallback-model' },
            vision: { id: 'vision-free', name: 'vision-fallback-model' },
          },
        })
      )
    );

    await handleClearDefault(createMockContext());

    // Both slot labels and both fallback model names appear — clearing both slots
    // no longer silently omits the vision fallback.
    const call = mockEditReply.mock.calls[0][0];
    const description = call.embeds[0].data.description;
    expect(description).toContain('Chat');
    expect(description).toContain('chat-fallback-model');
    expect(description).toContain('Vision');
    expect(description).toContain('vision-fallback-model');
  });

  it('renders cleanly with no fallback lines (empty map → no double blank line)', async () => {
    // mockClearDefaultConfigResponse() defaults to newEffectiveDefaults: {}. The
    // gateway never sends an empty map today, but the embed must stay robust to it
    // (no double blank line between the two sentences).
    stub.clearDefaultModelConfig.mockResolvedValue(makeOk(mockClearDefaultConfigResponse()));

    await handleClearDefault(createMockContext());

    const description = mockEditReply.mock.calls[0][0].embeds[0].data.description;
    expect(description).not.toContain('\n\n\n');
    expect(description).toContain('Your default preset has been removed.');
  });

  it('should show error when API fails', async () => {
    stub.clearDefaultModelConfig.mockResolvedValue(makeErr(500, 'Internal server error'));

    await handleClearDefault(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Internal server error',
    });
  });

  it('should handle exceptions', async () => {
    stub.clearDefaultModelConfig.mockRejectedValue(new Error('Network error'));

    await handleClearDefault(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to clear the default. Please try again.',
    });
  });
});
