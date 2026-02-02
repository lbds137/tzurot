/**
 * Tests for Me Preset Set Handler
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSet } from './set.js';
import { EmbedBuilder } from 'discord.js';

// Mock dependencies
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
  GATEWAY_TIMEOUTS: { AUTOCOMPLETE: 2500, DEFERRED: 10000 },
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

describe('Me Preset Set Handler', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(personalityId: string, presetId: string) {
    return {
      user: { id: 'user-123' },
      interaction: {
        options: {
          getString: (name: string, _required?: boolean) => {
            if (name === 'personality') return personalityId;
            if (name === 'preset') return presetId;
            return null;
          },
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleSet>[0];
  }

  describe('handleSet', () => {
    it('should show unlock models upsell when __unlock_all_models__ is selected', async () => {
      await handleSet(createMockContext('personality-1', '__unlock_all_models__'));

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });

      const embedCall = mockEditReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toContain('Unlock All Models');
      expect(embedData.description).toContain('Guest Mode');
      expect(embedData.description).toContain('/settings apikey set');

      // Should not call any API
      expect(callGatewayApi).not.toHaveBeenCalled();
    });

    it('should successfully set model override', async () => {
      vi.mocked(callGatewayApi)
        .mockResolvedValueOnce({
          ok: true,
          data: { keys: [{ provider: 'openrouter', isActive: true }] },
        }) // wallet
        .mockResolvedValueOnce({ ok: true, data: { configs: [] } }) // configs
        .mockResolvedValueOnce({
          ok: true,
          data: {
            override: {
              personalityId: 'personality-1',
              personalityName: 'Test Bot',
              configId: 'config-1',
              configName: 'Fast Claude',
            },
          },
        });

      await handleSet(createMockContext('personality-1', 'config-1'));

      // Verify set override API call
      expect(callGatewayApi).toHaveBeenCalledWith('/user/model-override', {
        method: 'PUT',
        userId: 'user-123',
        body: { personalityId: 'personality-1', configId: 'config-1' },
      });

      // Verify success embed
      const embedCall = mockEditReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toContain('Preset Override Set');
      expect(embedData.description).toContain('Test Bot');
      expect(embedData.description).toContain('Fast Claude');
    });

    it('should block guest mode users from using premium models', async () => {
      vi.mocked(callGatewayApi)
        .mockResolvedValueOnce({ ok: true, data: { keys: [] } }) // wallet - no active keys = guest mode
        .mockResolvedValueOnce({
          ok: true,
          data: {
            configs: [
              {
                id: 'premium-config',
                name: 'Premium Config',
                model: 'anthropic/claude-sonnet-4', // Not a free model
              },
            ],
          },
        }); // configs

      await handleSet(createMockContext('personality-1', 'premium-config'));

      // Should NOT call the set override API
      expect(callGatewayApi).toHaveBeenCalledTimes(2); // Only wallet and configs

      // Should show error embed
      const embedCall = mockEditReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toContain('Premium Model Not Available');
      expect(embedData.description).toContain('Guest Mode');
      expect(embedData.description).toContain('/settings apikey set');
    });

    it('should allow guest mode users to use free models', async () => {
      vi.mocked(callGatewayApi)
        .mockResolvedValueOnce({ ok: true, data: { keys: [] } }) // wallet - guest mode
        .mockResolvedValueOnce({
          ok: true,
          data: {
            configs: [
              {
                id: 'free-config',
                name: 'Free Config',
                model: 'google/gemini-2.0-flash-exp:free', // Free model
              },
            ],
          },
        }) // configs
        .mockResolvedValueOnce({
          ok: true,
          data: {
            override: {
              personalityId: 'personality-1',
              personalityName: 'Test Bot',
              configId: 'free-config',
              configName: 'Free Config',
            },
          },
        });

      await handleSet(createMockContext('personality-1', 'free-config'));

      // Should call the set override API
      expect(callGatewayApi).toHaveBeenCalledWith('/user/model-override', {
        method: 'PUT',
        userId: 'user-123',
        body: { personalityId: 'personality-1', configId: 'free-config' },
      });
    });

    it('should handle API error when setting override', async () => {
      vi.mocked(callGatewayApi)
        .mockResolvedValueOnce({
          ok: true,
          data: { keys: [{ provider: 'openrouter', isActive: true }] },
        })
        .mockResolvedValueOnce({ ok: true, data: { configs: [] } })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          error: 'Personality not found',
        });

      await handleSet(createMockContext('personality-1', 'config-1'));

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ Failed to set preset: Personality not found',
      });
    });

    it('should handle generic errors', async () => {
      vi.mocked(callGatewayApi).mockRejectedValue(new Error('Network error'));

      await handleSet(createMockContext('personality-1', 'config-1'));

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ An error occurred. Please try again later.',
      });
    });

    it('should handle wallet having inactive keys as guest mode', async () => {
      vi.mocked(callGatewayApi)
        .mockResolvedValueOnce({
          ok: true,
          data: { keys: [{ provider: 'openrouter', isActive: false }] }, // Key exists but inactive
        })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            configs: [
              {
                id: 'premium-config',
                name: 'Premium Config',
                model: 'anthropic/claude-sonnet-4',
              },
            ],
          },
        });

      await handleSet(createMockContext('personality-1', 'premium-config'));

      // Should block premium model (user is in guest mode despite having key)
      const embedCall = mockEditReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toContain('Premium Model Not Available');
    });

    it('should handle wallet API failure gracefully', async () => {
      vi.mocked(callGatewayApi)
        .mockResolvedValueOnce({ ok: false, status: 500, error: 'Internal error' }) // wallet fails
        .mockResolvedValueOnce({ ok: true, data: { configs: [] } }) // configs
        .mockResolvedValueOnce({
          ok: true,
          data: {
            override: {
              personalityId: 'personality-1',
              personalityName: 'Test Bot',
              configId: 'config-1',
              configName: 'Test Config',
            },
          },
        });

      await handleSet(createMockContext('personality-1', 'config-1'));

      // When wallet check fails, hasActiveWallet will be false (treated as guest mode)
      // But since config check also needs to find the config, it will proceed
      expect(mockEditReply).toHaveBeenCalled();
    });
  });
});
