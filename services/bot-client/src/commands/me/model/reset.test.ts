/**
 * Tests for Me Model Reset Handler
 *
 * Tests /me model reset subcommand:
 * - Successful override removal
 * - API error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleReset } from './reset.js';
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
  createSuccessEmbed: vi.fn().mockImplementation(() => {
    // Dynamic import to avoid hoisting issues
    const { EmbedBuilder } = require('discord.js');
    return new EmbedBuilder().setTitle('Success');
  }),
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

describe('Me Model Reset Handler', () => {
  const createMockInteraction = (personalityId: string) =>
    ({
      user: { id: 'user-123' },
      options: {
        getString: vi.fn((_name: string, _required?: boolean) => personalityId),
      },
      editReply: vi.fn(),
    }) as unknown as ChatInputCommandInteraction;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleReset', () => {
    it('should successfully reset model override', async () => {
      const mockInteraction = createMockInteraction('personality-123');

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: undefined,
      });

      await handleReset(mockInteraction);

      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledWith(
        '/user/model-override/personality-123',
        {
          method: 'DELETE',
          userId: 'user-123',
        }
      );

      expect(commandHelpers.createSuccessEmbed).toHaveBeenCalledWith(
        '🔄 Model Override Removed',
        'The personality will now use its default model configuration.'
      );

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });
    });

    it('should handle API error', async () => {
      const mockInteraction = createMockInteraction('nonexistent');

      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Override not found',
      });

      await handleReset(mockInteraction);

      expect(commandHelpers.replyWithError).toHaveBeenCalledWith(
        mockInteraction,
        'Failed to reset model: Override not found'
      );
    });

    it('should handle network errors with handleCommandError', async () => {
      const mockInteraction = createMockInteraction('personality-123');

      const networkError = new Error('Connection refused');
      vi.mocked(userGatewayClient.callGatewayApi).mockRejectedValue(networkError);

      await handleReset(mockInteraction);

      expect(commandHelpers.handleCommandError).toHaveBeenCalledWith(
        mockInteraction,
        networkError,
        { userId: 'user-123', command: 'Model Reset' }
      );
    });
  });
});
