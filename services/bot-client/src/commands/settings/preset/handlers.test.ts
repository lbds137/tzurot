/**
 * Tests for Preset Command Handlers (browse, set, reset)
 *
 * Note: These handlers use editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleBrowseOverrides } from './browse.js';
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
// Note: Tests use objectContaining for API call assertions to focus on the essential
// userId parameter while ignoring implementation details like timeout values.
const mockCallGatewayApi = vi.fn();
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  GATEWAY_TIMEOUTS: { AUTOCOMPLETE: 2500, DEFERRED: 10000 },
}));

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

  describe('handleBrowseOverrides', () => {
    function createMockContext() {
      return {
        user: { id: '123456789' },
        editReply: mockEditReply,
      } as unknown as Parameters<typeof handleBrowseOverrides>[0];
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

      await handleBrowseOverrides(createMockContext());

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        '/user/model-override',
        expect.objectContaining({ userId: '123456789' })
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

      await handleBrowseOverrides(createMockContext());

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

      await handleBrowseOverrides(createMockContext());

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to get overrides'),
      });
    });
  });

  describe('handleSet', () => {
    function createMockContext(personalityId = PERSONALITY_ID_1, configId = CONFIG_ID_1) {
      return {
        user: { id: '123456789' },
        interaction: {
          options: {
            getString: (name: string) => {
              if (name === 'personality') return personalityId;
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
          userId: '123456789',
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

  describe('handleReset', () => {
    function createMockContext(personalityId = PERSONALITY_ID_1) {
      return {
        user: { id: '123456789' },
        interaction: {
          options: {
            getString: (name: string) => {
              if (name === 'personality') return personalityId;
              return null;
            },
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

      await handleReset(createMockContext());

      expect(mockCallGatewayApi).toHaveBeenCalledWith(
        `/user/model-override/${PERSONALITY_ID_1}`,
        expect.objectContaining({
          method: 'DELETE',
          userId: '123456789',
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

      await handleReset(createMockContext());

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to reset preset'),
      });
    });

    it('should handle exceptions', async () => {
      mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

      await handleReset(createMockContext());

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('An error occurred'),
      });
    });
  });
});
