/**
 * Tests for Model Command Handlers (list, set, reset)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleListOverrides } from './list.js';
import { handleSet } from './set.js';
import { handleReset } from './reset.js';

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
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

// Mock userGatewayClient
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

// Mock commandHelpers
const mockDeferEphemeral = vi.fn();
const mockReplyWithError = vi.fn();
const mockHandleCommandError = vi.fn();
const mockCreateSuccessEmbed = vi.fn().mockReturnValue({ data: { title: 'Success' } });
vi.mock('../../utils/commandHelpers.js', () => ({
  deferEphemeral: (...args: unknown[]) => mockDeferEphemeral(...args),
  replyWithError: (...args: unknown[]) => mockReplyWithError(...args),
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args),
  createSuccessEmbed: (...args: unknown[]) => mockCreateSuccessEmbed(...args),
}));

describe('Model Command Handlers', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleListOverrides', () => {
    function createMockInteraction() {
      return {
        user: { id: '123456789' },
        editReply: mockEditReply,
      } as unknown as Parameters<typeof handleListOverrides>[0];
    }

    it('should list overrides', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          overrides: [
            { personalityId: 'p1', personalityName: 'Lilith', configId: 'c1', configName: 'Fast' },
            { personalityId: 'p2', personalityName: 'Sarcastic', configId: 'c2', configName: 'GPT-4' },
          ],
        },
      });

      const interaction = createMockInteraction();
      await handleListOverrides(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/model-override', { userId: '123456789' });
      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({
          data: expect.objectContaining({
            title: '🎭 Your Model Overrides',
            description: expect.stringContaining('Lilith'),
          }),
        })],
      });
    });

    it('should show empty message when no overrides', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { overrides: [] },
      });

      const interaction = createMockInteraction();
      await handleListOverrides(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining("haven't set any"),
          }),
        })],
      });
    });

    it('should handle API error', async () => {
      mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'Error' });

      const interaction = createMockInteraction();
      await handleListOverrides(interaction);

      expect(mockReplyWithError).toHaveBeenCalled();
    });
  });

  describe('handleSet', () => {
    function createMockInteraction(personalityId = 'p1', configId = 'c1') {
      return {
        user: { id: '123456789' },
        options: {
          getString: (name: string) => {
            if (name === 'personality') return personalityId;
            if (name === 'config') return configId;
            return null;
          },
        },
        editReply: mockEditReply,
      } as unknown as Parameters<typeof handleSet>[0];
    }

    it('should set model override', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          override: {
            personalityId: 'p1',
            personalityName: 'Lilith',
            configId: 'c1',
            configName: 'Fast',
          },
        },
      });

      const interaction = createMockInteraction();
      await handleSet(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/model-override', {
        method: 'PUT',
        userId: '123456789',
        body: { personalityId: 'p1', configId: 'c1' },
      });
      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({
          data: expect.objectContaining({
            title: '✅ Model Override Set',
          }),
        })],
      });
    });

    it('should handle not found error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Personality not found',
      });

      const interaction = createMockInteraction('invalid', 'c1');
      await handleSet(interaction);

      expect(mockReplyWithError).toHaveBeenCalledWith(
        interaction,
        'Failed to set model: Personality not found'
      );
    });
  });

  describe('handleReset', () => {
    function createMockInteraction(personalityId = 'p1') {
      return {
        user: { id: '123456789' },
        options: {
          getString: (name: string) => {
            if (name === 'personality') return personalityId;
            return null;
          },
        },
        editReply: mockEditReply,
      } as unknown as Parameters<typeof handleReset>[0];
    }

    it('should reset model override', async () => {
      mockCallGatewayApi.mockResolvedValue({ ok: true });

      const interaction = createMockInteraction();
      await handleReset(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/model-override/p1', {
        method: 'DELETE',
        userId: '123456789',
      });
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        '🔄 Model Override Removed',
        'The personality will now use its default model configuration.'
      );
    });

    it('should handle not found error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 404,
        error: 'No override found',
      });

      const interaction = createMockInteraction();
      await handleReset(interaction);

      expect(mockReplyWithError).toHaveBeenCalledWith(
        interaction,
        'Failed to reset model: No override found'
      );
    });

    it('should handle exceptions', async () => {
      const error = new Error('Network error');
      mockCallGatewayApi.mockRejectedValue(error);

      const interaction = createMockInteraction();
      await handleReset(interaction);

      expect(mockHandleCommandError).toHaveBeenCalledWith(
        interaction,
        error,
        { userId: '123456789', command: 'Model Reset' }
      );
    });
  });
});
