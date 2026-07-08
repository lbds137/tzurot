/**
 * Tests for Settings API Key Modal Submit Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { handleApikeyModalSubmit } from './modal.js';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

// Mock common-types
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => ({
      GATEWAY_URL: 'http://localhost:3000',
    }),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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
    const interaction: Record<string, unknown> = {
      customId,
      user: { id: '123456789' },
      fields: {
        getTextInputValue: (fieldId: string) => {
          if (fieldId === 'apiKey') return apiKey;
          return '';
        },
      },
      reply: mockReply,
      editReply: mockEditReply,
      followUp: vi.fn().mockResolvedValue(undefined),
      deferred: false,
      replied: false,
    };
    // deferReply flips the ack state like Discord, so replyError picks
    // editReply (deferred) vs reply (fresh) the way it does at runtime.
    interaction.deferReply = mockDeferReply.mockImplementation(() => {
      interaction.deferred = true;
      return Promise.resolve();
    });
    return interaction as unknown as Parameters<typeof handleApikeyModalSubmit>[0];
  }

  describe('Modal routing', () => {
    it('should reject unknown modal format', async () => {
      const interaction = createMockInteraction('unknown-modal');
      await handleApikeyModalSubmit(interaction);

      expect(mockReply).toHaveBeenCalledWith({
        content: '❌ Unknown apikey modal submission.',
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should reject apikey customId without provider', async () => {
      // settings::apikey::set without provider should fail
      const interaction = createMockInteraction('settings::apikey::set');
      await handleApikeyModalSubmit(interaction);

      expect(mockReply).toHaveBeenCalledWith({
        content: '❌ Unknown apikey modal submission.',
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should reject unknown apikey action', async () => {
      const interaction = createMockInteraction('settings::apikey::unknown::openrouter');
      await handleApikeyModalSubmit(interaction);

      expect(mockReply).toHaveBeenCalledWith({
        content: '❌ Unknown apikey action.',
        flags: MessageFlags.Ephemeral,
      });
    });
  });

  describe('API key validation', () => {
    it('should reject empty API key', async () => {
      const interaction = createMockInteraction('settings::apikey::set::openrouter', '   ');
      await handleApikeyModalSubmit(interaction);

      expect(mockDeferReply).toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith({ content: '❌ API key cannot be empty.' });
    });

    it('should reject OpenRouter key with wrong format', async () => {
      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-wrong-format'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Invalid OpenRouter Key Format'),
      });
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
      // Non-z.ai providers keep the blanket routing copy.
      const embedData = vi.mocked(mockEditReply).mock.calls[0][0].embeds[0].data;
      const nextSteps = embedData.fields.find((f: { name: string }) => f.name === '💡 Next Steps');
      expect(nextSteps.value).toContain('will now be used for AI responses');
    });

    it('uses z.ai-specific success copy (key applies only when a z.ai model serves)', async () => {
      // Regression for the real user-confusion report: a saved z.ai key does
      // NOT switch all routing — only z.ai-model responses use it.
      stub.setWalletKey.mockResolvedValue(makeOk({ success: true }));

      const interaction = createMockInteraction('settings::apikey::set::zai-coding', 'zai-key-1');
      await handleApikeyModalSubmit(interaction);

      const embedData = vi.mocked(mockEditReply).mock.calls[0][0].embeds[0].data;
      const nextSteps = embedData.fields.find((f: { name: string }) => f.name === '💡 Next Steps');
      expect(nextSteps.value).toContain('whenever a z.ai model serves the response');
      expect(nextSteps.value).not.toContain('will now be used for AI responses');
    });

    it('should handle 401 invalid key error', async () => {
      stub.setWalletKey.mockResolvedValue(makeErr(401, 'Invalid API key'));

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-or-invalid-key'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Invalid API Key'),
      });
    });

    it('should handle 402 insufficient credits error', async () => {
      stub.setWalletKey.mockResolvedValue(makeErr(402, 'Insufficient credits'));

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-or-no-credits'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Insufficient Credits'),
      });
    });

    it('should handle a transport timeout (status 0) with a browse hint', async () => {
      // status 0 = bot-client transport timeout/drop (a slow provider probe
      // outlasting the client timeout). The gateway may have saved the key after
      // the client gave up, so the message points at browse instead of the
      // generic "Unable to Save".
      stub.setWalletKey.mockResolvedValue(
        makeErr(0, 'Request timeout (gateway slow or unavailable)')
      );

      const interaction = createMockInteraction(
        'settings::apikey::set::zai-coding',
        'zai-key-slow-probe'
      );
      await handleApikeyModalSubmit(interaction);

      // Outcome-uncertain (⏳), single glyph — never a doubled ❌ ⏳, and never
      // an ❌ that would frame a possibly-saved key as a definitive failure.
      const timeoutReply = (mockEditReply as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
        content: string;
      };
      expect(timeoutReply.content).toContain('⏳ **Request Timed Out**');
      expect(timeoutReply.content).not.toContain('❌');
    });

    it('should handle a rate-limit (429) as a transient warning, single glyph', async () => {
      stub.setWalletKey.mockResolvedValue(makeErr(429, 'Too many requests'));

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-or-v1-ratelimited'
      );
      await handleApikeyModalSubmit(interaction);

      const reply = (mockEditReply as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
        content: string;
      };
      expect(reply.content).toContain('⚠️ **Too Many Requests**');
      expect(reply.content).not.toContain('❌');
    });

    it('should handle generic gateway error', async () => {
      stub.setWalletKey.mockResolvedValue(makeErr(500, 'Internal error'));

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-or-valid-key'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Server Error'),
      });
    });

    it('should handle network errors', async () => {
      stub.setWalletKey.mockRejectedValue(new Error('Network error'));

      const interaction = createMockInteraction(
        'settings::apikey::set::openrouter',
        'sk-or-valid-key'
      );
      await handleApikeyModalSubmit(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('unexpected error'),
      });
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

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('missing required permissions'),
      });
    });
  });
});
