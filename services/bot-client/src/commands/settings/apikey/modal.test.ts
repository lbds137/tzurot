/**
 * Tests for Settings API Key Modal Submit Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { handleApikeyModalSubmit } from './modal.js';

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
    getConfig: () => ({
      GATEWAY_URL: 'http://localhost:3000',
    }),
  };
});

// Mock providers utility
vi.mock('../../../utils/providers.js', () => ({
  getProviderDisplayName: (provider: string) => {
    if (provider === 'openrouter') return 'OpenRouter';
    return provider;
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('handleApikeyModalSubmit', () => {
  const mockReply = vi.fn();
  const mockDeferReply = vi.fn();
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(customId: string, apiKey: string = 'sk-or-valid-key') {
    return {
      customId,
      user: { id: '123456789' },
      fields: {
        getTextInputValue: (fieldId: string) => {
          if (fieldId === 'apiKey') return apiKey;
          return '';
        },
      },
      reply: mockReply,
      deferReply: mockDeferReply,
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleApikeyModalSubmit>[0];
  }

  describe('Modal routing', () => {
    it('should reject unknown modal format', async () => {
      const interaction = createMockInteraction('unknown-modal');
      await handleApikeyModalSubmit(interaction);

      expect(mockReply).toHaveBeenCalledWith({
        content: '❌ Unknown apikey modal submission',
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should reject apikey customId without provider', async () => {
      // settings::apikey::set without provider should fail
      const interaction = createMockInteraction('settings::apikey::set');
      await handleApikeyModalSubmit(interaction);

      expect(mockReply).toHaveBeenCalledWith({
        content: '❌ Unknown apikey modal submission',
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should reject unknown apikey action', async () => {
      const interaction = createMockInteraction('settings::apikey::unknown::openrouter');
      await handleApikeyModalSubmit(interaction);

      expect(mockReply).toHaveBeenCalledWith({
        content: '❌ Unknown apikey action',
        flags: MessageFlags.Ephemeral,
      });
    });
  });

  describe('API key validation', () => {
    it('should reject empty API key', async () => {
      const interaction = createMockInteraction('settings::apikey::set::openrouter', '   ');
      await handleApikeyModalSubmit(interaction);

      expect(mockDeferReply).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith('❌ API key cannot be empty');
    });

    it('should reject OpenRouter key with wrong format', async () => {
      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-wrong-format'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(
        expect.stringContaining('Invalid OpenRouter Key Format')
      );
    });
  });

  describe('Gateway API interaction', () => {
    it('should send valid key to gateway', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-or-valid-key-here'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/wallet/set',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            provider: 'openrouter',
            apiKey: 'sk-or-valid-key-here',
          }),
        })
      );
    });

    it('should handle successful key storage', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-or-valid-key'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              title: '✅ API Key Configured',
            }),
          }),
        ],
      });
    });

    it('should handle 401 invalid key error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Invalid API key' }),
      });

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-or-invalid-key'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Invalid API Key'));
    });

    it('should handle 402 insufficient credits error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 402,
        json: () => Promise.resolve({ error: 'Insufficient credits' }),
      });

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-or-no-credits'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Insufficient Credits'));
    });

    it('should handle generic gateway error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal error' }),
      });

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-or-valid-key'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Server Error'));
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-or-valid-key'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('unexpected error'));
    });
  });
});
