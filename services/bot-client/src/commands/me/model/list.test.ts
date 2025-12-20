/**
 * Tests for Me Model List Handler
 *
 * Tests /me model list subcommand:
 * - Empty overrides list
 * - List with overrides
 * - API error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleListOverrides } from './list.js';
import * as userGatewayClient from '../../../utils/userGatewayClient.js';
import * as commandHelpers from '../../../utils/commandHelpers.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';

// Mock dependencies
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

vi.mock('../../../utils/commandHelpers.js', () => ({
  replyWithError: vi.fn(),
  handleCommandError: vi.fn(),
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

describe('Me Model List Handler', () => {
  const createMockInteraction = () =>
    ({
      user: { id: 'user-123' },
      editReply: vi.fn(),
    }) as unknown as ChatInputCommandInteraction;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleListOverrides', () => {
    it('should show empty state when no overrides', async () => {
      const mockInteraction = createMockInteraction();

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: { overrides: [] },
      });

      await handleListOverrides(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });

      const embedCall = vi.mocked(mockInteraction.editReply).mock.calls[0][0] as {
        embeds: EmbedBuilder[];
      };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toContain('Model Overrides');
      expect(embedData.description).toContain("You haven't set any model overrides");
    });

    it('should list overrides when present', async () => {
      const mockInteraction = createMockInteraction();

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          overrides: [
            { personalityName: 'Lilith', configName: 'Fast Claude' },
            { personalityName: 'Bob', configName: 'GPT-4 Turbo' },
          ],
        },
      });

      await handleListOverrides(mockInteraction);

      const embedCall = vi.mocked(mockInteraction.editReply).mock.calls[0][0] as {
        embeds: EmbedBuilder[];
      };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.description).toContain('Lilith');
      expect(embedData.description).toContain('Fast Claude');
      expect(embedData.description).toContain('Bob');
      expect(embedData.description).toContain('GPT-4 Turbo');
      expect(embedData.footer?.text).toContain('2 override(s)');
    });

    it('should handle unknown config name', async () => {
      const mockInteraction = createMockInteraction();

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          overrides: [{ personalityName: 'Test', configName: null }],
        },
      });

      await handleListOverrides(mockInteraction);

      const embedCall = vi.mocked(mockInteraction.editReply).mock.calls[0][0] as {
        embeds: EmbedBuilder[];
      };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.description).toContain('Unknown');
    });

    it('should handle API error', async () => {
      const mockInteraction = createMockInteraction();

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Internal error',
      });

      await handleListOverrides(mockInteraction);

      expect(commandHelpers.replyWithError).toHaveBeenCalledWith(
        mockInteraction,
        'Failed to get overrides. Please try again later.'
      );
    });

    it('should handle network errors with handleCommandError', async () => {
      const mockInteraction = createMockInteraction();

      const networkError = new Error('Network error');
      vi.mocked(userGatewayClient.callGatewayApi).mockRejectedValue(networkError);

      await handleListOverrides(mockInteraction);

      expect(commandHelpers.handleCommandError).toHaveBeenCalledWith(
        mockInteraction,
        networkError,
        { userId: 'user-123', command: 'Model List' }
      );
    });
  });
});
