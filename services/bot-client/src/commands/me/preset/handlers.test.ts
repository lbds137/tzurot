/**
 * Tests for Model Command Handlers (list, set, reset)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleListOverrides } from './list.js';
import { handleSet } from './set.js';
import { handleReset } from './reset.js';
import {
  mockListModelOverridesResponse,
  mockSetModelOverrideResponse,
  mockDeleteModelOverrideResponse,
  mockListWalletKeysResponse,
  mockListLlmConfigsResponse,
} from '@tzurot/common-types';

// Test UUIDs (RFC 4122 compliant)
const PERSONALITY_ID_1 = '11111111-1111-5111-8111-111111111111';
const PERSONALITY_ID_2 = '22222222-2222-5222-8222-222222222222';
const CONFIG_ID_1 = '33333333-3333-5333-8333-333333333333';
const CONFIG_ID_2 = '44444444-4444-5444-8444-444444444444';

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
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

// Mock commandHelpers
const mockReplyWithError = vi.fn();
const mockHandleCommandError = vi.fn();
const mockCreateSuccessEmbed = vi.fn().mockReturnValue({ data: { title: 'Success' } });
vi.mock('../../../utils/commandHelpers.js', () => ({
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
        data: mockListModelOverridesResponse([
          {
            personalityId: PERSONALITY_ID_1,
            personalityName: 'Lilith',
            configId: CONFIG_ID_1,
            configName: 'Fast',
          },
          {
            personalityId: PERSONALITY_ID_2,
            personalityName: 'Sarcastic',
            configId: CONFIG_ID_2,
            configName: 'GPT-4',
          },
        ]),
      });

      const interaction = createMockInteraction();
      await handleListOverrides(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/model-override', {
        userId: '123456789',
      });
      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              title: '🎭 Your Preset Overrides',
              description: expect.stringContaining('Lilith'),
            }),
          }),
        ],
      });
    });

    it('should show empty message when no overrides', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: mockListModelOverridesResponse([]),
      });

      const interaction = createMockInteraction();
      await handleListOverrides(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining("haven't set any"),
            }),
          }),
        ],
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
    function createMockInteraction(personalityId = PERSONALITY_ID_1, configId = CONFIG_ID_1) {
      return {
        user: { id: '123456789' },
        options: {
          getString: (name: string) => {
            if (name === 'personality') return personalityId;
            if (name === 'preset') return configId;
            return null;
          },
        },
        editReply: mockEditReply,
      } as unknown as Parameters<typeof handleSet>[0];
    }

    it('should set model override', async () => {
      // Mock responses based on API path
      mockCallGatewayApi.mockImplementation((path: string, options?: { method?: string }) => {
        if (path === '/wallet/list') {
          return Promise.resolve({
            ok: true,
            data: mockListWalletKeysResponse([{ isActive: true }]),
          });
        }
        if (path === '/user/llm-config') {
          return Promise.resolve({
            ok: true,
            data: mockListLlmConfigsResponse([
              { id: CONFIG_ID_1, name: 'Fast', model: 'openai/gpt-4o-mini' },
            ]),
          });
        }
        if (path === '/user/model-override' && options?.method === 'PUT') {
          return Promise.resolve({
            ok: true,
            data: mockSetModelOverrideResponse({
              override: {
                personalityId: PERSONALITY_ID_1,
                personalityName: 'Lilith',
                configId: CONFIG_ID_1,
                configName: 'Fast',
              },
            }),
          });
        }
        return Promise.resolve({ ok: false, error: 'Unknown path' });
      });

      const interaction = createMockInteraction();
      await handleSet(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/model-override', {
        method: 'PUT',
        userId: '123456789',
        body: { personalityId: PERSONALITY_ID_1, configId: CONFIG_ID_1 },
      });
      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              title: '✅ Preset Override Set',
            }),
          }),
        ],
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
        'Failed to set preset: Personality not found'
      );
    });
  });

  describe('handleReset', () => {
    function createMockInteraction(personalityId = PERSONALITY_ID_1) {
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
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: mockDeleteModelOverrideResponse(),
      });

      const interaction = createMockInteraction();
      await handleReset(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith(`/user/model-override/${PERSONALITY_ID_1}`, {
        method: 'DELETE',
        userId: '123456789',
      });
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        '🔄 Preset Override Removed',
        'The personality will now use its default preset.'
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
        'Failed to reset preset: No override found'
      );
    });

    it('should handle exceptions', async () => {
      const error = new Error('Network error');
      mockCallGatewayApi.mockRejectedValue(error);

      const interaction = createMockInteraction();
      await handleReset(interaction);

      expect(mockHandleCommandError).toHaveBeenCalledWith(interaction, error, {
        userId: '123456789',
        command: 'Preset Reset',
      });
    });
  });
});
