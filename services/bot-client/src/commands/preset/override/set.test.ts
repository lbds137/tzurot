/**
 * Tests for Me Preset Set Handler
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSet } from './set.js';
import { EmbedBuilder } from 'discord.js';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

const stub = {
  listWalletKeys: vi.fn(),
  listUserLlmConfigs: vi.fn(),
  setModelOverride: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('Me Preset Set Handler', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stub.listWalletKeys.mockReset();
    stub.listUserLlmConfigs.mockReset();
    stub.setModelOverride.mockReset();
  });

  function createMockContext(personalityId: string, presetId: string, slot?: string) {
    return {
      user: { id: 'user-123', username: 'testuser' },
      interaction: {
        options: {
          getString: (name: string, _required?: boolean) => {
            if (name === 'character') return personalityId;
            if (name === 'preset') return presetId;
            if (name === 'slot') return slot ?? null;
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

      // Should not call the gateway
      expect(stub.listWalletKeys).not.toHaveBeenCalled();
      expect(stub.setModelOverride).not.toHaveBeenCalled();
    });

    it('should successfully set model override (paid user, short-circuits config fetch)', async () => {
      stub.listWalletKeys.mockResolvedValue(
        makeOk({ keys: [{ provider: 'openrouter', isActive: true }] })
      );
      stub.setModelOverride.mockResolvedValue(
        makeOk({
          override: {
            personalityId: 'personality-1',
            personalityName: 'Test Bot',
            configId: 'config-1',
            configName: 'Fast Claude',
          },
        })
      );

      await handleSet(createMockContext('personality-1', 'config-1'));

      // No slot option → defaults to the text (chat) slot.
      expect(stub.setModelOverride).toHaveBeenCalledWith(
        { personalityId: 'personality-1', configId: 'config-1' },
        { slot: 'text' }
      );

      const embedCall = mockEditReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toContain('Preset Override Set');
      expect(embedData.description).toContain('Test Bot');
      expect(embedData.description).toContain('Fast Claude');
      // Default (text) slot is named in the confirmation.
      expect(embedData.description).toContain('for chat messages');

      // Paid path: wallet check short-circuits, configs not fetched
      expect(stub.listUserLlmConfigs).not.toHaveBeenCalled();
    });

    it('sends the vision slot when slot:vision is chosen (the vision-set fix)', async () => {
      stub.listWalletKeys.mockResolvedValue(
        makeOk({ keys: [{ provider: 'openrouter', isActive: true }] })
      );
      stub.setModelOverride.mockResolvedValue(
        makeOk({
          override: {
            personalityId: 'personality-1',
            personalityName: 'Test Bot',
            configId: 'vision-config',
            configName: 'Gemini Vision',
          },
        })
      );

      await handleSet(createMockContext('personality-1', 'vision-config', 'vision'));

      // The slot must reach the gateway — without it, a vision override silently
      // lands in the text slot (the bug this fix closes).
      expect(stub.setModelOverride).toHaveBeenCalledWith(
        { personalityId: 'personality-1', configId: 'vision-config' },
        { slot: 'vision' }
      );

      // The confirmation names the vision slot.
      const embedData = (
        mockEditReply.mock.calls[0][0] as { embeds: EmbedBuilder[] }
      ).embeds[0].toJSON();
      expect(embedData.description).toContain('for vision (image) messages');
    });

    it('should block guest mode users from using premium models', async () => {
      stub.listWalletKeys.mockResolvedValue(makeOk({ keys: [] }));
      stub.listUserLlmConfigs.mockResolvedValue(
        makeOk({
          configs: [
            {
              id: 'premium-config',
              name: 'Premium Config',
              model: 'anthropic/claude-sonnet-4', // Not a free model
            },
          ],
        })
      );

      await handleSet(createMockContext('personality-1', 'premium-config'));

      expect(stub.setModelOverride).not.toHaveBeenCalled();

      const embedCall = mockEditReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toContain('Premium Model Not Available');
      expect(embedData.description).toContain('Guest Mode');
      expect(embedData.description).toContain('/settings apikey set');
    });

    it('should allow guest mode users to use free models', async () => {
      stub.listWalletKeys.mockResolvedValue(makeOk({ keys: [] }));
      stub.listUserLlmConfigs.mockResolvedValue(
        makeOk({
          configs: [
            {
              id: 'free-config',
              name: 'Free Config',
              model: 'google/gemini-2.0-flash-exp:free',
            },
          ],
        })
      );
      stub.setModelOverride.mockResolvedValue(
        makeOk({
          override: {
            personalityId: 'personality-1',
            personalityName: 'Test Bot',
            configId: 'free-config',
            configName: 'Free Config',
          },
        })
      );

      await handleSet(createMockContext('personality-1', 'free-config'));

      expect(stub.setModelOverride).toHaveBeenCalledWith(
        { personalityId: 'personality-1', configId: 'free-config' },
        { slot: 'text' }
      );
    });

    it('should handle API error when setting override', async () => {
      stub.listWalletKeys.mockResolvedValue(
        makeOk({ keys: [{ provider: 'openrouter', isActive: true }] })
      );
      stub.setModelOverride.mockResolvedValue(makeErr(404, 'Personality not found'));

      await handleSet(createMockContext('personality-1', 'config-1'));

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ Personality not found',
      });
    });

    it('should handle generic errors', async () => {
      stub.listWalletKeys.mockRejectedValue(new Error('Network error'));

      await handleSet(createMockContext('personality-1', 'config-1'));

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ Failed to set the override. Please try again.',
      });
    });

    it('should handle wallet having inactive keys as guest mode', async () => {
      stub.listWalletKeys.mockResolvedValue(
        makeOk({ keys: [{ provider: 'openrouter', isActive: false }] })
      );
      stub.listUserLlmConfigs.mockResolvedValue(
        makeOk({
          configs: [
            {
              id: 'premium-config',
              name: 'Premium Config',
              model: 'anthropic/claude-sonnet-4',
              provider: 'openrouter',
            },
          ],
        })
      );

      await handleSet(createMockContext('personality-1', 'premium-config'));

      const embedCall = mockEditReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
      const embed = embedCall.embeds[0];
      const embedData = embed.toJSON();

      expect(embedData.title).toContain('Premium Model Not Available');
    });

    it('should handle wallet API failure gracefully (fail-open)', async () => {
      stub.listWalletKeys.mockResolvedValue(makeErr(500, 'Internal error'));
      stub.setModelOverride.mockResolvedValue(
        makeOk({
          override: {
            personalityId: 'personality-1',
            personalityName: 'Test Bot',
            configId: 'config-1',
            configName: 'Test Config',
          },
        })
      );

      await handleSet(createMockContext('personality-1', 'config-1'));

      // When wallet check fails, we fail-open — setModelOverride is invoked.
      expect(mockEditReply).toHaveBeenCalled();
    });

    it('rejects the autocomplete-error sentinel before calling the gateway', async () => {
      await handleSet(createMockContext('__autocomplete_error__', 'config-1'));

      expect(stub.setModelOverride).not.toHaveBeenCalled();
      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Autocomplete was unavailable'),
      });
    });
  });
});
