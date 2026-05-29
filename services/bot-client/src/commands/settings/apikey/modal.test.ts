/**
 * Tests for Settings API Key Modal Submit Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { handleApikeyModalSubmit } from './modal.js';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/common-types';

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

const stub = {
  setWalletKey: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

// Mock providers utility
vi.mock('../../../utils/providers.js', () => ({
  getProviderDisplayName: (provider: string) => {
    if (provider === 'openrouter') return 'OpenRouter';
    return provider;
  },
}));

describe('handleApikeyModalSubmit', () => {
  const mockReply = vi.fn();
  const mockDeferReply = vi.fn();
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stub.setWalletKey.mockReset();
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

    it('should accept ZaiCoding key with any non-empty format (no client-side prefix check)', async () => {
      // z.ai keys have no documented strict prefix, so the client-side
      // validateKeyFormat returns null. Validation happens server-side via
      // the chat-completions probe in api-gateway.
      stub.setWalletKey.mockResolvedValue(makeOk({ success: true }));

      const interaction = createMockInteraction(
        'settings::apikey::set::zai-coding',
        'arbitrary-zai-key-format'
      );
      await handleApikeyModalSubmit(interaction);

      // Should NOT show a client-side format error — request flows through to gateway
      expect(mockEditReply).not.toHaveBeenCalledWith(expect.stringContaining('Invalid'));
      expect(stub.setWalletKey).toHaveBeenCalledWith({
        provider: 'zai-coding',
        apiKey: 'arbitrary-zai-key-format',
      });
    });
  });

  describe('Gateway API interaction', () => {
    it('should send valid key to gateway', async () => {
      stub.setWalletKey.mockResolvedValue(makeOk({ success: true }));

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-or-valid-key-here'
      );
      await handleApikeyModalSubmit(interaction);

      expect(stub.setWalletKey).toHaveBeenCalledWith({
        provider: 'openrouter',
        apiKey: 'sk-or-valid-key-here',
      });
    });

    it('should trim whitespace from API key before sending', async () => {
      stub.setWalletKey.mockResolvedValue(makeOk({ success: true }));

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        '  sk-or-valid-key-here  \n'
      );
      await handleApikeyModalSubmit(interaction);

      expect(stub.setWalletKey).toHaveBeenCalledWith({
        provider: 'openrouter',
        apiKey: 'sk-or-valid-key-here',
      });
    });

    it('should handle successful key storage', async () => {
      stub.setWalletKey.mockResolvedValue(makeOk({ success: true }));

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
      stub.setWalletKey.mockResolvedValue(makeErr(401, 'Invalid API key'));

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-or-invalid-key'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Invalid API Key'));
    });

    it('should handle 402 insufficient credits error', async () => {
      stub.setWalletKey.mockResolvedValue(makeErr(402, 'Insufficient credits'));

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-or-no-credits'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Insufficient Credits'));
    });

    it('should handle generic gateway error', async () => {
      stub.setWalletKey.mockResolvedValue(makeErr(500, 'Internal error'));

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-or-valid-key'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Server Error'));
    });

    it('should handle network errors', async () => {
      stub.setWalletKey.mockRejectedValue(new Error('Network error'));

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-or-valid-key'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('unexpected error'));
    });

    it('should show descriptive error for missing permissions (400)', async () => {
      stub.setWalletKey.mockResolvedValue(
        makeErr(400, 'Your ElevenLabs API key is valid but missing required permissions.')
      );

      const interaction = createMockInteraction(
        'settings::apikey::set::elevenlabs',
        'sk_valid_scoped_key'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith(
        expect.stringContaining('missing required permissions')
      );
    });
  });
});
