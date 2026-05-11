/**
 * Tests for Preset Command Handlers (browse, set, clear)
 *
 * Note: These handlers use editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleListOverrides } from './list.js';
import { handleSet } from './set.js';
import { handleClear } from './clear.js';
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
// Note: Tests use objectContaining for API call assertions to focus on the essential
// userId parameter while ignoring implementation details like timeout values.
const mockCallGatewayApi = vi.fn();
vi.mock('../../../utils/userGatewayClient.js', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/userGatewayClient.js')>(
    '../../../utils/userGatewayClient.js'
  );
  return {
    ...actual,
    callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  };
});

// Mock commandHelpers (only used by reset for createSuccessEmbed/createInfoEmbed)
const mockCreateSuccessEmbed = vi.fn().mockReturnValue({ data: { title: 'Success' } });
const mockCreateInfoEmbed = vi.fn().mockReturnValue({ data: { title: 'Info' } });
vi.mock('../../../utils/commandHelpers.js', () => ({
  createSuccessEmbed: (...args: unknown[]) => mockCreateSuccessEmbed(...args),
  createInfoEmbed: (...args: unknown[]) => mockCreateInfoEmbed(...args),
}));

describe('Preset Command Handlers', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleListOverrides', () => {
    function createMockContext() {
      return {
        user: { id: '123456789', username: 'testuser' },
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

      await handleListOverrides(createMockContext());

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/model-override',
        expect.objectContaining({
          user: { discordId: '123456789', username: 'testuser', displayName: 'testuser' },
        })
      );
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

      await handleListOverrides(createMockContext());

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

      await handleListOverrides(createMockContext());

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to get overrides'),
      });
    });
  });

  describe('handleSet', () => {
    function createMockContext(personalityId = PERSONALITY_ID_1, configId = CONFIG_ID_1) {
      return {
        user: { id: '123456789', username: 'testuser' },
        interaction: {
          options: {
            getString: (name: string) => {
              if (name === 'character') return personalityId;
              if (name === 'preset') return configId;
              return null;
            },
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

      await handleSet(createMockContext());

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/model-override',
        expect.objectContaining({
          method: 'PUT',
          user: {
            discordId: '123456789',
            username: 'testuser',
            displayName: 'testuser',
          },
          body: { personalityId: PERSONALITY_ID_1, configId: CONFIG_ID_1 },
        })
      );
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

      await handleSet(createMockContext('invalid', 'c1'));

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to set preset'),
      });
    });
  });

  describe('handleClear', () => {
    function createMockContext(personalityId = PERSONALITY_ID_1) {
      return {
        user: { id: '123456789', username: 'testuser' },
        interaction: {
          options: {
            getString: (name: string) => {
              if (name === 'character') return personalityId;
              return null;
            },
          },
        },
        editReply: mockEditReply,
      } as unknown as Parameters<typeof handleClear>[0];
    }

    it('should clear model override', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: mockDeleteModelOverrideResponse(),
      });

      await handleClear(createMockContext());

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        `/user/model-override/${PERSONALITY_ID_1}`,
        expect.objectContaining({
          method: 'DELETE',
          user: {
            discordId: '123456789',
            username: 'testuser',
            displayName: 'testuser',
          },
        })
      );
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

      await handleClear(createMockContext());

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to clear preset'),
      });
    });

    it('should handle exceptions', async () => {
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleClear(createMockContext());

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('An error occurred'),
      });
    });
  });
});
