/**
 * Tests for Preset Global Set Free Default Handler
 *
 * Tests /preset global set-free-default subcommand:
 * - Successful free tier default setting
 * - API error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGlobalSetFreeDefault } from './set-free-default.js';
import * as adminApiClient from '../../../utils/adminApiClient.js';
import * as commandHelpers from '../../../utils/commandHelpers.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';

// Mock dependencies
vi.mock('../../../utils/adminApiClient.js', () => ({
  adminPutJson: vi.fn(),
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

describe('Preset Global Set Free Default Handler', () => {
  const createMockInteraction = (configId: string) =>
    ({
      user: { id: 'owner-123' },
      options: {
        getString: vi.fn((_name: string, _required?: boolean) => configId),
      },
      editReply: vi.fn(),
    }) as unknown as ChatInputCommandInteraction;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleGlobalSetFreeDefault', () => {
    it('should successfully set free tier default', async () => {
      const mockInteraction = createMockInteraction('config-456');

      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ configName: 'Gemini Flash Free' }),
      } as unknown as Response);

      await handleGlobalSetFreeDefault(mockInteraction);

      expect(adminApiClient.adminPutJson).toHaveBeenCalledWith(
        '/admin/llm-config/config-456/set-free-default',
        {}
      );

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });

      const embedCall = vi.mocked(mockInteraction.editReply).mock.calls[0][0] as {
        embeds: EmbedBuilder[];
      };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toBe('Free Tier Default Preset Updated');
      expect(embedData.description).toContain('Gemini Flash Free');
      expect(embedData.description).toContain('Guest users');
    });

    it('should handle API error response', async () => {
      const mockInteraction = createMockInteraction('invalid-config');

      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({ error: 'Config must be a free model' }),
      } as unknown as Response);

      await handleGlobalSetFreeDefault(mockInteraction);

      expect(commandHelpers.replyWithError).toHaveBeenCalledWith(
        mockInteraction,
        'Config must be a free model'
      );
    });

    it('should handle API error without message', async () => {
      const mockInteraction = createMockInteraction('config-123');

      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: false,
        status: 503,
        json: vi.fn().mockResolvedValue({}),
      } as unknown as Response);

      await handleGlobalSetFreeDefault(mockInteraction);

      expect(commandHelpers.replyWithError).toHaveBeenCalledWith(mockInteraction, 'HTTP 503');
    });

    it('should handle network errors with handleCommandError', async () => {
      const mockInteraction = createMockInteraction('config-123');

      const networkError = new Error('DNS resolution failed');
      vi.mocked(adminApiClient.adminPutJson).mockRejectedValue(networkError);

      await handleGlobalSetFreeDefault(mockInteraction);

      expect(commandHelpers.handleCommandError).toHaveBeenCalledWith(
        mockInteraction,
        networkError,
        { userId: 'owner-123', command: 'Preset Global Set Free Default' }
      );
    });
  });
});
