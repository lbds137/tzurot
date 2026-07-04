import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import { makeOk, makeErr, asOwnerClient } from '../../../test/gatewayClientStubs.js';
import { handleGlobalPresetUpdate, type GlobalPresetUpdateConfig } from './globalPresetHelpers.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

// The bound promote call is supplied per-config; the test stub records it.
const mockPromote = vi.fn();

const testConfig: GlobalPresetUpdateConfig = {
  promote: (ownerClient, id) => mockPromote(ownerClient, id),
  embedTitle: 'Default Set',
  embedDescription: (name: string) => `Set **${name}** as default`,
  logMessage: 'Set default',
  errorLogMessage: 'Failed to set default',
};

describe('globalPresetHelpers', () => {
  const mockEditReply = vi.fn();
  const ownerStub = { actor: 'owner-1' };

  function createMockContext(): DeferredCommandContext {
    return {
      editReply: mockEditReply,
      user: { id: 'user-123' },
      interaction: { user: { id: 'user-123' } },
    } as unknown as DeferredCommandContext;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    clientsForMock.mockReturnValue({ ownerClient: asOwnerClient(ownerStub) });
  });

  describe('handleGlobalPresetUpdate', () => {
    it('should show success embed on successful API call', async () => {
      mockPromote.mockResolvedValue(makeOk({ success: true, configName: 'Claude Sonnet' }));

      await handleGlobalPresetUpdate(createMockContext(), 'config-1', testConfig);

      expect(mockPromote).toHaveBeenCalledWith(asOwnerClient(ownerStub), 'config-1');
      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      });
    });

    it('should show error message on API failure', async () => {
      mockPromote.mockResolvedValue(makeErr(500, 'Server error'));

      await handleGlobalPresetUpdate(createMockContext(), 'config-1', testConfig);

      expect(mockEditReply).toHaveBeenCalledWith({ content: '❌ Server error' });
    });

    it('should show generic error on exception', async () => {
      mockPromote.mockRejectedValue(new Error('Network error'));

      await handleGlobalPresetUpdate(createMockContext(), 'config-1', testConfig);

      expect(mockEditReply).toHaveBeenCalledWith({
        content: '❌ An error occurred. Please try again later.',
      });
    });
  });
});
