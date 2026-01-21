/**
 * Tests for Me Preset Reset Handler
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleReset } from './reset.js';

// Mock dependencies
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
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

import { callGatewayApi } from '../../../utils/userGatewayClient.js';

describe('Me Preset Reset Handler', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSuccessEmbed.mockImplementation((title: string, description: string) =>
      createMockEmbed(title, description)
    );
    mockCreateInfoEmbed.mockImplementation((title: string, description: string) =>
      createMockEmbed(title, description)
    );
  });

  function createMockContext(personalityId: string) {
    return {
      user: { id: 'user-123' },
      interaction: {
        options: {
          getString: (_name: string, _required?: boolean) => personalityId,
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleReset>[0];
  }

  describe('handleReset', () => {
    it('should successfully reset model override when one exists', async () => {
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: { deleted: true }, // wasSet defaults to true when not specified
      });

      await handleReset(createMockContext('personality-123'));

      expect(callGatewayApi).toHaveBeenCalledWith('/user/model-override/personality-123', {
        method: 'DELETE',
        userId: 'user-123',
      });

      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        '🔄 Preset Override Removed',
        'The personality will now use its default preset.'
      );

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({ data: expect.objectContaining({}) })],
      });
    });

    it('should show info message when no override was set', async () => {
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: { deleted: true, wasSet: false },
      });

      await handleReset(createMockContext('personality-123'));

      expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
        'ℹ️ No Override Set',
        'This personality was already using its default preset.'
      );

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({ data: expect.objectContaining({}) })],
      });
    });

    it('should handle API error', async () => {
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Override not found',
      });

      await handleReset(createMockContext('nonexistent'));

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ Failed to reset preset: Override not found',
      });
    });

    it('should handle network errors', async () => {
      vi.mocked(callGatewayApi).mockRejectedValue(new Error('Connection refused'));

      await handleReset(createMockContext('personality-123'));

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ An error occurred. Please try again later.',
      });
    });
  });
});
