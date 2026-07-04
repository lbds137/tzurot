/**
 * Tests for Preset Global Free Default Handler
 *
 * Tests /preset global free-default subcommand:
 * - Successful free tier default setting
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

const { handleGlobalSetFreeDefault } = await import('./free-default.js');

interface OwnerClientStub {
  setGlobalLlmConfigFreeDefault: ReturnType<typeof vi.fn>;
}

describe('Preset Global Set Free Default Handler', () => {
  const mockEditReply = vi.fn();
  let stub: OwnerClientStub;

  const createMockContext = (configId: string, kind?: string) =>
    ({
      user: { id: 'owner-123' },
      interaction: {
        user: { id: 'owner-123' },
        options: {
          // The `slot` option is optional (getString('slot', false)); everything
          // else (the `preset` option) resolves to the configId under test.
          getString: vi.fn((name: string, _required?: boolean) =>
            name === 'slot' ? (kind ?? null) : configId
          ),
        },
      },
      editReply: mockEditReply,
    }) as unknown as Parameters<typeof handleGlobalSetFreeDefault>[0];

  beforeEach(() => {
    vi.clearAllMocks();
    stub = { setGlobalLlmConfigFreeDefault: vi.fn() };
    clientsForMock.mockReturnValue({ ownerClient: asOwnerClient(stub) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleGlobalSetFreeDefault', () => {
    it('should successfully set free tier default', async () => {
      const context = createMockContext('config-456');
      stub.setGlobalLlmConfigFreeDefault.mockResolvedValue(
        makeOk({ success: true, configName: 'Gemini Flash Free' })
      );

      await handleGlobalSetFreeDefault(context);

      // No kind option → defaults to text (the admin route gates by kind).
      expect(stub.setGlobalLlmConfigFreeDefault).toHaveBeenCalledWith('config-456', {
        kind: 'text',
      });

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });

      const embedCall = mockEditReply.mock.calls[0][0] as { embeds: EmbedBuilder[] };
      const embedData = embedCall.embeds[0].toJSON();

      expect(embedData.title).toBe('Free Tier Default Preset Updated');
      expect(embedData.description).toContain('Gemini Flash Free');
      expect(embedData.description).toContain('Guest users');
    });

    it('should pass kind=vision through to the promote call', async () => {
      const context = createMockContext('vision-config', 'vision');
      stub.setGlobalLlmConfigFreeDefault.mockResolvedValue(
        makeOk({ success: true, configName: 'Gemini Vision Free' })
      );

      await handleGlobalSetFreeDefault(context);

      expect(stub.setGlobalLlmConfigFreeDefault).toHaveBeenCalledWith('vision-config', {
        kind: 'vision',
      });
    });

    it('should handle API error response', async () => {
      const context = createMockContext('invalid-config');
      stub.setGlobalLlmConfigFreeDefault.mockResolvedValue(
        makeErr(400, 'Config must be a free model')
      );

      await handleGlobalSetFreeDefault(context);

      expect(mockEditReply).toHaveBeenCalledWith({ content: '❌ Config must be a free model' });
    });

    it('should handle network errors', async () => {
      const context = createMockContext('config-123');
      stub.setGlobalLlmConfigFreeDefault.mockRejectedValue(new Error('DNS resolution failed'));

      await handleGlobalSetFreeDefault(context);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ An error occurred. Please try again later.',
      });
    });
  });
});
