/**
 * Tests for Preset Command Handlers (browse, set, clear)
 *
 * Note: These handlers use editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSet } from './set.js';
import { handleClear } from './clear.js';
import {
  mockSetModelOverrideResponse,
  mockDeleteModelOverrideResponse,
  mockListWalletKeysResponse,
  mockListLlmConfigsResponse,
} from '@tzurot/test-factories';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

// Test UUIDs (RFC 4122 compliant)
const PERSONALITY_ID_1 = '11111111-1111-5111-8111-111111111111';
const CONFIG_ID_1 = '33333333-3333-5333-8333-333333333333';

// Mock common-types
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
  listWalletKeys: vi.fn(),
  listUserLlmConfigs: vi.fn(),
  setModelOverride: vi.fn(),
  deleteModelOverride: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
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
    stub.listWalletKeys.mockReset();
    stub.listUserLlmConfigs.mockReset();
    stub.setModelOverride.mockReset();
    stub.deleteModelOverride.mockReset();
  });

  // Browse (the former list) coverage lives in ./browse.test.ts and
  // ../../../utils/overrideBrowse.test.ts — the interactive select→clear flow
  // moved to the shared override browser.

  describe('handleSet', () => {
    function createMockContext(
      personalityId = PERSONALITY_ID_1,
      configId = CONFIG_ID_1,
      slot?: string
    ) {
      return {
        user: { id: '123456789', username: 'testuser' },
        interaction: {
          options: {
            getString: (name: string) => {
              if (name === 'character') return personalityId;
              if (name === 'preset') return configId;
              if (name === 'slot') return slot ?? null;
              return null;
            },
          },
        },
        editReply: mockEditReply,
      } as unknown as Parameters<typeof handleSet>[0];
    }

    it('should set model override', async () => {
      stub.listWalletKeys.mockResolvedValue(
        makeOk(mockListWalletKeysResponse([{ isActive: true }]))
      );
      stub.listUserLlmConfigs.mockResolvedValue(
        makeOk(
          mockListLlmConfigsResponse([
            { id: CONFIG_ID_1, name: 'Fast', model: 'openai/gpt-4o-mini' },
          ])
        )
      );
      stub.setModelOverride.mockResolvedValue(
        makeOk(
          mockSetModelOverrideResponse({
            override: {
              personalityId: PERSONALITY_ID_1,
              personalityName: 'Lilith',
              configId: CONFIG_ID_1,
              configName: 'Fast',
            },
          })
        )
      );

      await handleSet(createMockContext());

      // No slot option → defaults to the text (chat) slot.
      expect(stub.setModelOverride).toHaveBeenCalledWith(
        { personalityId: PERSONALITY_ID_1, configId: CONFIG_ID_1 },
        { kind: 'text' }
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

    it('routes the chosen slot to the gateway when kind:vision is selected', async () => {
      // Mirrors set.test.ts's vision-slot case at the shared-handler level: the
      // slot option must reach setModelOverride, or a vision override silently
      // lands in the text slot.
      stub.listWalletKeys.mockResolvedValue(
        makeOk(mockListWalletKeysResponse([{ isActive: true }]))
      );
      stub.listUserLlmConfigs.mockResolvedValue(
        makeOk(
          mockListLlmConfigsResponse([
            { id: CONFIG_ID_1, name: 'Sharp Eyes', model: 'google/gemini-2.0-flash' },
          ])
        )
      );
      stub.setModelOverride.mockResolvedValue(
        makeOk(
          mockSetModelOverrideResponse({
            override: {
              personalityId: PERSONALITY_ID_1,
              personalityName: 'Lilith',
              configId: CONFIG_ID_1,
              configName: 'Sharp Eyes',
            },
          })
        )
      );

      await handleSet(createMockContext(PERSONALITY_ID_1, CONFIG_ID_1, 'vision'));

      expect(stub.setModelOverride).toHaveBeenCalledWith(
        { personalityId: PERSONALITY_ID_1, configId: CONFIG_ID_1 },
        { kind: 'vision' }
      );
    });

    it('should handle not found error', async () => {
      stub.listWalletKeys.mockResolvedValue(
        makeOk(mockListWalletKeysResponse([{ isActive: true }]))
      );
      stub.setModelOverride.mockResolvedValue(makeErr(404, 'Personality not found'));

      await handleSet(createMockContext('invalid', 'c1'));

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to set preset'),
      });
    });
  });

  describe('handleClear', () => {
    function createMockContext(personalityId = PERSONALITY_ID_1) {
      return {
        user: { id: '123456789', username: 'testuser' },
        interaction: {
          options: {
            getString: (name: string) => {
              if (name === 'character') return personalityId;
              return null;
            },
          },
        },
        editReply: mockEditReply,
      } as unknown as Parameters<typeof handleClear>[0];
    }

    it('should clear model override', async () => {
      stub.deleteModelOverride.mockResolvedValue(makeOk(mockDeleteModelOverrideResponse()));

      await handleClear(createMockContext());

      // No slot → clears both slots (the gateway's `all` sentinel).
      expect(stub.deleteModelOverride).toHaveBeenCalledWith(PERSONALITY_ID_1, { kind: 'all' });
      expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
        '🔄 Preset Override Removed',
        'The character will now use its default preset.'
      );
    });

    it('should handle not found error', async () => {
      stub.deleteModelOverride.mockResolvedValue(makeErr(404, 'No override found'));

      await handleClear(createMockContext());

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed to clear preset'),
      });
    });

    it('should handle exceptions', async () => {
      stub.deleteModelOverride.mockRejectedValue(new Error('Network error'));

      await handleClear(createMockContext());

      expect(mockEditReply).toHaveBeenCalledWith({
        content: expect.stringContaining('An error occurred'),
      });
    });
  });
});
