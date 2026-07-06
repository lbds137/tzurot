/**
 * Tests for Preset Clear Handler
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleClear } from './clear.js';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

const stub = {
  deleteModelOverride: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

// Create mock EmbedBuilder-like objects
function createMockEmbed(title: string, description?: string) {
  const data: Record<string, unknown> = { title };
  if (description !== undefined) {
    data.description = description;
  }
  return { data };
}

const mockCreateSuccessEmbed = vi.fn((title: string, description: string) =>
  createMockEmbed(title, description)
);
const mockCreateInfoEmbed = vi.fn((title: string, description: string) =>
  createMockEmbed(title, description)
);

vi.mock('../../../utils/commandHelpers.js', () => ({
  createSuccessEmbed: (...args: unknown[]) => mockCreateSuccessEmbed(...(args as [string, string])),
  createInfoEmbed: (...args: unknown[]) => mockCreateInfoEmbed(...(args as [string, string])),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('Preset Clear Handler', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stub.deleteModelOverride.mockReset();
    mockCreateSuccessEmbed.mockImplementation((title: string, description: string) =>
      createMockEmbed(title, description)
    );
    mockCreateInfoEmbed.mockImplementation((title: string, description: string) =>
      createMockEmbed(title, description)
    );
  });

  function createMockContext(personalityId: string, slot?: string) {
    return {
      user: { id: 'user-123', username: 'testuser' },
      interaction: {
        options: {
          // The `slot` option is optional (null → handler clears both slots);
          // every other option (`character`) resolves to the personalityId.
          getString: (name: string, _required?: boolean) =>
            name === 'slot' ? (slot ?? null) : personalityId,
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleClear>[0];
  }

  describe('handleClear', () => {
    it('clears BOTH slots when no slot is given', async () => {
      stub.deleteModelOverride.mockResolvedValue(makeOk({ deleted: true }));

      await handleClear(createMockContext('personality-123'));

      // No slot → clear both slots (the gateway's `all` sentinel), so a vision
      // override isn't silently left behind.
      expect(stub.deleteModelOverride).toHaveBeenCalledWith('personality-123', { slot: 'all' });

      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        '🔄 Preset Override Removed',
        'The character will now use its default preset.'
      );

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({ data: expect.objectContaining({}) })],
      });
    });

    it('clears the vision override when slot=vision', async () => {
      stub.deleteModelOverride.mockResolvedValue(makeOk({ deleted: true }));

      await handleClear(createMockContext('personality-123', 'vision'));

      expect(stub.deleteModelOverride).toHaveBeenCalledWith('personality-123', { slot: 'vision' });
      // The vision path completes through to the success embed, same as text.
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        '🔄 Preset Override Removed',
        'The character will now use its default preset.'
      );
      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({ data: expect.objectContaining({}) })],
      });
    });

    it('should show info message when no override was set', async () => {
      stub.deleteModelOverride.mockResolvedValue(makeOk({ deleted: true, wasSet: false }));

      await handleClear(createMockContext('personality-123'));

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        'ℹ️ No Override Set',
        'This character was already using its default preset.'
      );

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({ data: expect.objectContaining({}) })],
      });
    });

    it('should handle API error', async () => {
      stub.deleteModelOverride.mockResolvedValue(makeErr(404, 'Override not found'));

      await handleClear(createMockContext('nonexistent'));

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ Failed to clear preset: Override not found',
      });
    });

    it('should handle network errors', async () => {
      stub.deleteModelOverride.mockRejectedValue(new Error('Connection refused'));

      await handleClear(createMockContext('personality-123'));

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ An error occurred. Please try again later.',
      });
    });

    it('rejects the autocomplete-error sentinel before calling the gateway', async () => {
      await handleClear(createMockContext('__autocomplete_error__'));

      expect(stub.deleteModelOverride).not.toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Autocomplete was unavailable'),
      });
    });
  });
});
