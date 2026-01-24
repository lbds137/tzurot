/**
 * Tests for Preset Global Free Default Handler
 *
 * Tests /preset global free-default subcommand:
 * - Successful free tier default setting
 * - API error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGlobalSetFreeDefault } from './free-default.js';
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

describe('Preset Global Set Free Default Handler', () => {
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
    }) as unknown as Parameters<typeof handleGlobalSetFreeDefault>[0];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleGlobalSetFreeDefault', () => {
    it('should successfully set free tier default', async () => {
      const context = createMockContext('config-456');

      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ configName: 'Gemini Flash Free' }),
      } as unknown as Response);

      await handleGlobalSetFreeDefault(context);

      expect(adminApiClient.adminPutJson).toHaveBeenCalledWith(
        '/admin/llm-config/config-456/set-free-default',
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

      expect(embedData.title).toBe('Free Tier Default Preset Updated');
      expect(embedData.description).toContain('Gemini Flash Free');
      expect(embedData.description).toContain('Guest users');
    });

    it('should handle API error response', async () => {
      const context = createMockContext('invalid-config');

      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({ error: 'Config must be a free model' }),
      } as unknown as Response);

      await handleGlobalSetFreeDefault(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ Config must be a free model',
      });
    });

    it('should handle API error without message', async () => {
      const context = createMockContext('config-123');

      vi.mocked(adminApiClient.adminPutJson).mockResolvedValue({
        ok: false,
        status: 503,
        json: vi.fn().mockResolvedValue({}),
      } as unknown as Response);

      await handleGlobalSetFreeDefault(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ HTTP 503',
      });
    });

    it('should handle network errors', async () => {
      const context = createMockContext('config-123');

      vi.mocked(adminApiClient.adminPutJson).mockRejectedValue(new Error('DNS resolution failed'));

      await handleGlobalSetFreeDefault(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ An error occurred. Please try again later.',
      });
    });
  });
});
