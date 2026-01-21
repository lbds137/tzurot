/**
 * Tests for Preset Global Set Default Handler
 *
 * Tests /preset global set-default subcommand:
 * - Successful default setting
 * - API error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGlobalSetDefault } from './set-default.js';
import * as adminApiClient from '../../../utils/adminApiClient.js';
import { EmbedBuilder } from 'discord.js';

// Mock dependencies
vi.mock('../../../utils/adminApiClient.js', () => ({
  adminPutJson: vi.fn(),
}));

// Note: Handlers now use context.editReply() directly, not commandHelpers

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

describe('Preset Global Set Default Handler', () => {
  const mockEditReply = vi.fn();

  const createMockContext = (configId: string) =>
    ({
      user: { id: 'owner-123' },
      interaction: {
        options: {
          getString: vi.fn((_name: string, _required?: boolean) => configId),
        },
      },
      editReply: mockEditReply,
    }) as unknown as Parameters<typeof handleGlobalSetDefault>[0];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleGlobalSetDefault', () => {
    it('should successfully set system default', async () => {
      const context = createMockContext('config-123');

      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ configName: 'Claude Opus' }),
      } as unknown as Response);

      await handleGlobalSetDefault(context);

      expect(adminApiClient.adminPutJson).toHaveBeenCalledWith(
        '/admin/llm-config/config-123/set-default',
        {}
      );

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });

      const embedCall = mockEditReply.mock.calls[0][0] as {
        embeds: EmbedBuilder[];
      };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toBe('System Default Preset Updated');
      expect(embedData.description).toContain('Claude Opus');
      expect(embedData.description).toContain('system default');
    });

    it('should handle API error response', async () => {
      const context = createMockContext('invalid-config');

      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({ error: 'Config not found' }),
      } as unknown as Response);

      await handleGlobalSetDefault(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ Config not found',
      });
    });

    it('should handle API error without message', async () => {
      const context = createMockContext('config-123');

      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({}),
      } as unknown as Response);

      await handleGlobalSetDefault(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ HTTP 500',
      });
    });

    it('should handle network errors', async () => {
      const context = createMockContext('config-123');

      vi.mocked(adminApiClient.adminPutJson).mockRejectedValue(new Error('Connection timeout'));

      await handleGlobalSetDefault(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ An error occurred. Please try again later.',
      });
    });
  });
});
