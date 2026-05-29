/**
 * Tests for Settings Preset Browse Handler
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleListOverrides } from './list.js';
import { EmbedBuilder } from 'discord.js';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/common-types';

const stub = {
  listModelOverrides: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('Settings Preset Browse Handler', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stub.listModelOverrides.mockReset();
  });

  function createMockContext() {
    return {
      user: { id: 'user-123' },
      interaction: {} as never,
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleListOverrides>[0];
  }

  describe('handleListOverrides', () => {
    it('should show empty state when no overrides', async () => {
      stub.listModelOverrides.mockResolvedValue(makeOk({ overrides: [] }));

      await handleListOverrides(createMockContext());

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });

      const embedCall = mockEditReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toContain('Preset Overrides');
      expect(embedData.description).toContain("You haven't set any preset overrides");
    });

    it('should list overrides when present', async () => {
      stub.listModelOverrides.mockResolvedValue(
        makeOk({
          overrides: [
            { personalityName: 'Lilith', configName: 'Fast Claude' },
            { personalityName: 'Bob', configName: 'GPT-4 Turbo' },
          ],
        })
      );

      await handleListOverrides(createMockContext());

      const embedCall = mockEditReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.description).toContain('Lilith');
      expect(embedData.description).toContain('Fast Claude');
      expect(embedData.description).toContain('Bob');
      expect(embedData.description).toContain('GPT-4 Turbo');
      expect(embedData.footer?.text).toContain('2 override(s)');
    });

    it('should handle unknown config name', async () => {
      stub.listModelOverrides.mockResolvedValue(
        makeOk({
          overrides: [{ personalityName: 'Test', configName: null }],
        })
      );

      await handleListOverrides(createMockContext());

      const embedCall = mockEditReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.description).toContain('Unknown');
    });

    it('should handle API error', async () => {
      stub.listModelOverrides.mockResolvedValue(makeErr(500, 'Internal error'));

      await handleListOverrides(createMockContext());

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ Failed to get overrides. Please try again later.',
      });
    });

    it('should handle network errors', async () => {
      stub.listModelOverrides.mockRejectedValue(new Error('Network error'));

      await handleListOverrides(createMockContext());

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ An error occurred. Please try again later.',
      });
    });
  });
});
