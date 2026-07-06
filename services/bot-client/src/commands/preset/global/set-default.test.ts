/**
 * Tests for Preset Global Set Default Handler
 *
 * Tests /preset global set-default subcommand:
 * - Successful default setting
 * - API error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import { makeOk, makeErr, asOwnerClient } from '../../../test/gatewayClientStubs.js';

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

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

const { handleGlobalSetDefault } = await import('./set-default.js');

interface OwnerClientStub {
  setGlobalLlmConfigDefault: ReturnType<typeof vi.fn>;
}

describe('Preset Global Set Default Handler', () => {
  const mockEditReply = vi.fn();
  let stub: OwnerClientStub;

  const createMockContext = (configId: string, slot?: string) =>
    ({
      user: { id: 'owner-123' },
      interaction: {
        user: { id: 'owner-123' },
        options: {
          // The `slot` option is optional (getString('slot', false)); everything
          // else (the `preset` option) resolves to the configId under test.
          getString: vi.fn((name: string, _required?: boolean) =>
            name === 'slot' ? (slot ?? null) : configId
          ),
        },
      },
      editReply: mockEditReply,
    }) as unknown as Parameters<typeof handleGlobalSetDefault>[0];

  beforeEach(() => {
    vi.clearAllMocks();
    stub = { setGlobalLlmConfigDefault: vi.fn() };
    clientsForMock.mockReturnValue({ ownerClient: asOwnerClient(stub) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleGlobalSetDefault', () => {
    it('should successfully set system default', async () => {
      const context = createMockContext('config-123');
      stub.setGlobalLlmConfigDefault.mockResolvedValue(
        makeOk({ success: true, configName: 'Claude Opus' })
      );

      await handleGlobalSetDefault(context);

      // No slot option → defaults to text (the admin route gates by slot).
      expect(stub.setGlobalLlmConfigDefault).toHaveBeenCalledWith('config-123', { slot: 'text' });

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });

      const embedCall = mockEditReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
      const embedData = embedCall.embeds[0].toJSON();

      expect(embedData.title).toBe('System Default Preset Updated');
      expect(embedData.description).toContain('Claude Opus');
      expect(embedData.description).toContain('system default');
    });

    it('should pass slot=vision through to the promote call', async () => {
      const context = createMockContext('vision-config', 'vision');
      stub.setGlobalLlmConfigDefault.mockResolvedValue(
        makeOk({ success: true, configName: 'GPT-4 Vision' })
      );

      await handleGlobalSetDefault(context);

      expect(stub.setGlobalLlmConfigDefault).toHaveBeenCalledWith('vision-config', {
        slot: 'vision',
      });
    });

    it('should handle API error response', async () => {
      const context = createMockContext('invalid-config');
      stub.setGlobalLlmConfigDefault.mockResolvedValue(makeErr(404, 'Config not found'));

      await handleGlobalSetDefault(context);

      expect(mockEditReply).toHaveBeenCalledWith({ content: '❌ Config not found' });
    });

    it('should handle network errors', async () => {
      const context = createMockContext('config-123');
      stub.setGlobalLlmConfigDefault.mockRejectedValue(new Error('Connection timeout'));

      await handleGlobalSetDefault(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ An error occurred. Please try again later.',
      });
    });
  });
});
