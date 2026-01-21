/**
 * Tests for Preset Global Create Handler
 *
 * Tests /preset global create subcommand:
 * - Successful preset creation
 * - Default provider fallback
 * - API error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGlobalCreate } from './create.js';
import * as adminApiClient from '../../../utils/adminApiClient.js';
import { EmbedBuilder } from 'discord.js';

// Mock dependencies
vi.mock('../../../utils/adminApiClient.js', () => ({
  adminPostJson: vi.fn(),
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

describe('Preset Global Create Handler', () => {
  const mockEditReply = vi.fn();

  const createMockContext = (options: Record<string, string | null>) =>
    ({
      user: { id: 'owner-123' },
      interaction: {
        options: {
          getString: vi.fn((name: string, _required?: boolean) => {
            return options[name] ?? null;
          }),
        },
      },
      editReply: mockEditReply,
    }) as unknown as Parameters<typeof handleGlobalCreate>[0];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleGlobalCreate', () => {
    it('should successfully create preset with all fields', async () => {
      const context = createMockContext({
        name: 'Full Preset',
        model: 'claude-3-opus',
        provider: 'anthropic',
        description: 'A complete preset',
        'vision-model': 'gpt-4-vision',
      });

      vi.mocked(adminApiClient.adminPostJson).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          config: { id: 'preset-456', name: 'Full Preset', model: 'claude-3-opus' },
        }),
      } as unknown as Response);

      await handleGlobalCreate(context);

      expect(adminApiClient.adminPostJson).toHaveBeenCalledWith('/admin/llm-config', {
        name: 'Full Preset',
        model: 'claude-3-opus',
        provider: 'anthropic',
        description: 'A complete preset',
        visionModel: 'gpt-4-vision',
      });

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });
    });

    it('should use openrouter as default provider', async () => {
      const context = createMockContext({
        name: 'Default Provider',
        model: 'gpt-4',
        // No provider specified
      });

      vi.mocked(adminApiClient.adminPostJson).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          config: { id: 'preset-789', name: 'Default Provider', model: 'gpt-4' },
        }),
      } as unknown as Response);

      await handleGlobalCreate(context);

      expect(adminApiClient.adminPostJson).toHaveBeenCalledWith('/admin/llm-config', {
        name: 'Default Provider',
        model: 'gpt-4',
        provider: 'openrouter',
        description: null,
        visionModel: null,
      });
    });

    it('should handle API error response', async () => {
      const context = createMockContext({
        name: 'Duplicate',
        model: 'gpt-4',
      });

      vi.mocked(adminApiClient.adminPostJson).mockResolvedValue({
        ok: false,
        status: 409,
        json: vi.fn().mockResolvedValue({ error: 'Preset already exists' }),
      } as unknown as Response);

      await handleGlobalCreate(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ Preset already exists',
      });
    });

    it('should handle API error without message', async () => {
      const context = createMockContext({
        name: 'Server Error',
        model: 'gpt-4',
      });

      vi.mocked(adminApiClient.adminPostJson).mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({}),
      } as unknown as Response);

      await handleGlobalCreate(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ HTTP 500',
      });
    });

    it('should handle network errors', async () => {
      const context = createMockContext({
        name: 'Network Test',
        model: 'gpt-4',
      });

      vi.mocked(adminApiClient.adminPostJson).mockRejectedValue(new Error('Connection refused'));

      await handleGlobalCreate(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ An error occurred. Please try again later.',
      });
    });

    it('should show ID in success embed', async () => {
      const context = createMockContext({
        name: 'ID Test',
        model: 'gpt-4',
      });

      vi.mocked(adminApiClient.adminPostJson).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          config: { id: 'unique-id-123', name: 'ID Test', model: 'gpt-4' },
        }),
      } as unknown as Response);

      await handleGlobalCreate(context);

      const embedCall = mockEditReply.mock.calls[0][0] as {
        embeds: EmbedBuilder[];
      };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toBe('Global Preset Created');
      const idField = embedData.fields?.find(f => f.name === 'ID');
      expect(idField?.value).toContain('unique-id-123');
    });
  });
});
