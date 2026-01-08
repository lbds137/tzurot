/**
 * Tests for Me Model Set Handler
 *
 * Tests the /me model set command which allows users to set
 * a model override for a specific personality. Covers:
 * - Unlock models upsell flow
 * - Successful override setting
 * - Guest mode restrictions (premium model blocking)
 * - API error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleSet } from './set.js';
import * as userGatewayClient from '../../../utils/userGatewayClient.js';
import * as commandHelpers from '../../../utils/commandHelpers.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';

// Mock dependencies
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

vi.mock('../../../utils/commandHelpers.js', () => ({
  replyWithError: vi.fn(),
  handleCommandError: vi.fn(),
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

describe('Me Model Set Handler', () => {
  const createMockInteraction = (personalityId: string, presetId: string) =>
    ({
      user: { id: 'user-123' },
      options: {
        getString: vi.fn((name: string, _required?: boolean) => {
          if (name === 'personality') return personalityId;
          if (name === 'preset') return presetId;
          return null;
        }),
      },
      editReply: vi.fn(),
    }) as unknown as ChatInputCommandInteraction;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleSet', () => {
    it('should show unlock models upsell when __unlock_all_models__ is selected', async () => {
      const mockInteraction = createMockInteraction('personality-1', '__unlock_all_models__');

      await handleSet(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });

      const embedCall = vi.mocked(mockInteraction.editReply).mock.calls[0][0] as {
        embeds: EmbedBuilder[];
      };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toContain('Unlock All Models');
      expect(embedData.description).toContain('Guest Mode');
      expect(embedData.description).toContain('/wallet set');

      // Should not call any API
      expect(userGatewayClient.callGatewayApi).not.toHaveBeenCalled();
    });

    it('should successfully set model override', async () => {
      const mockInteraction = createMockInteraction('personality-1', 'config-1');

      vi.mocked(userGatewayClient.callGatewayApi)
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

      await handleSet(mockInteraction);

      // Verify set override API call
      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledWith('/user/model-override', {
        method: 'PUT',
        userId: 'user-123',
        body: { personalityId: 'personality-1', configId: 'config-1' },
      });

      // Verify success embed
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });

      const embedCall = vi.mocked(mockInteraction.editReply).mock.calls[0][0] as {
        embeds: EmbedBuilder[];
      };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toContain('Preset Override Set');
      expect(embedData.description).toContain('Test Bot');
      expect(embedData.description).toContain('Fast Claude');
    });

    it('should block guest mode users from using premium models', async () => {
      const mockInteraction = createMockInteraction('personality-1', 'premium-config');

      vi.mocked(userGatewayClient.callGatewayApi)
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

      await handleSet(mockInteraction);

      // Should NOT call the set override API
      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledTimes(2); // Only wallet and configs

      // Should show error embed
      const embedCall = vi.mocked(mockInteraction.editReply).mock.calls[0][0] as {
        embeds: EmbedBuilder[];
      };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toContain('Premium Model Not Available');
      expect(embedData.description).toContain('Guest Mode');
      expect(embedData.description).toContain('/wallet set');
    });

    it('should allow guest mode users to use free models', async () => {
      const mockInteraction = createMockInteraction('personality-1', 'free-config');

      vi.mocked(userGatewayClient.callGatewayApi)
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

      await handleSet(mockInteraction);

      // Should call the set override API
      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledWith('/user/model-override', {
        method: 'PUT',
        userId: 'user-123',
        body: { personalityId: 'personality-1', configId: 'free-config' },
      });
    });

    it('should handle API error when setting override', async () => {
      const mockInteraction = createMockInteraction('personality-1', 'config-1');

      vi.mocked(userGatewayClient.callGatewayApi)
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

      await handleSet(mockInteraction);

      expect(commandHelpers.replyWithError).toHaveBeenCalledWith(
        mockInteraction,
        'Failed to set preset: Personality not found'
      );
    });

    it('should handle generic errors with handleCommandError', async () => {
      const mockInteraction = createMockInteraction('personality-1', 'config-1');
      const testError = new Error('Network error');

      vi.mocked(userGatewayClient.callGatewayApi).mockRejectedValue(testError);

      await handleSet(mockInteraction);

      expect(commandHelpers.handleCommandError).toHaveBeenCalledWith(mockInteraction, testError, {
        userId: 'user-123',
        command: 'Preset Set',
      });
    });

    it('should handle wallet having inactive keys as guest mode', async () => {
      const mockInteraction = createMockInteraction('personality-1', 'premium-config');

      vi.mocked(userGatewayClient.callGatewayApi)
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

      await handleSet(mockInteraction);

      // Should block premium model (user is in guest mode despite having key)
      const embedCall = vi.mocked(mockInteraction.editReply).mock.calls[0][0] as {
        embeds: EmbedBuilder[];
      };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toContain('Premium Model Not Available');
    });

    it('should handle wallet API failure gracefully', async () => {
      const mockInteraction = createMockInteraction('personality-1', 'config-1');

      vi.mocked(userGatewayClient.callGatewayApi)
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

      await handleSet(mockInteraction);

      // When wallet check fails, hasActiveWallet will be false (treated as guest mode)
      // But since config check also needs to find the config, it will proceed
      expect(mockInteraction.editReply).toHaveBeenCalled();
    });
  });
});
