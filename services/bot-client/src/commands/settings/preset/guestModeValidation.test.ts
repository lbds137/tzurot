import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as gatewayClient from '../../../utils/userGatewayClient.js';
import { handleUnlockModelsUpsell, checkGuestModePremiumAccess } from './guestModeValidation.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';

vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
  GATEWAY_TIMEOUTS: { DEFERRED: 10000 },
}));

vi.mock('./autocomplete.js', () => ({
  UNLOCK_MODELS_VALUE: '__UNLOCK_ALL_MODELS__',
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    isFreeModel: vi.fn((model: string) => model.startsWith('free-')),
  };
});

describe('guestModeValidation', () => {
  const mockEditReply = vi.fn();

  function createMockContext(): DeferredCommandContext {
    return {
      editReply: mockEditReply,
      user: { id: 'user-123' },
    } as unknown as DeferredCommandContext;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleUnlockModelsUpsell', () => {
    it('should return false for non-unlock config IDs', async () => {
      const result = await handleUnlockModelsUpsell(createMockContext(), 'config-123', 'user-1');
      expect(result).toBe(false);
      expect(mockEditReply).not.toHaveBeenCalled();
    });

    it('should show upsell embed and return true for unlock ID', async () => {
      const result = await handleUnlockModelsUpsell(
        createMockContext(),
        '__UNLOCK_ALL_MODELS__',
        'user-1'
      );
      expect(result).toBe(true);
      expect(mockEditReply).toHaveBeenCalled();
    });
  });

  describe('checkGuestModePremiumAccess', () => {
    it('should not block when user has active wallet keys', async () => {
      vi.mocked(gatewayClient.callGatewayApi)
        .mockResolvedValueOnce({
          ok: true,
          data: { keys: [{ provider: 'openrouter', isActive: true }] },
        } as never)
        .mockResolvedValueOnce({ ok: true, data: { configs: [] } } as never);

      const result = await checkGuestModePremiumAccess(createMockContext(), 'config-1', 'user-1');
      expect(result.isGuestMode).toBe(false);
      expect(result.blocked).toBe(false);
    });

    it('should not block guest user selecting free model', async () => {
      vi.mocked(gatewayClient.callGatewayApi)
        .mockResolvedValueOnce({ ok: true, data: { keys: [] } } as never)
        .mockResolvedValueOnce({
          ok: true,
          data: { configs: [{ id: 'config-1', name: 'Free Config', model: 'free-gpt' }] },
        } as never);

      const result = await checkGuestModePremiumAccess(createMockContext(), 'config-1', 'user-1');
      expect(result.isGuestMode).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('should block guest user selecting premium model', async () => {
      vi.mocked(gatewayClient.callGatewayApi)
        .mockResolvedValueOnce({ ok: true, data: { keys: [] } } as never)
        .mockResolvedValueOnce({
          ok: true,
          data: {
            configs: [{ id: 'config-1', name: 'Premium Config', model: 'claude-sonnet' }],
          },
        } as never);

      const result = await checkGuestModePremiumAccess(createMockContext(), 'config-1', 'user-1');
      expect(result.isGuestMode).toBe(true);
      expect(result.blocked).toBe(true);
      expect(mockEditReply).toHaveBeenCalled();
    });

    it('should not block when config is not found', async () => {
      vi.mocked(gatewayClient.callGatewayApi)
        .mockResolvedValueOnce({ ok: true, data: { keys: [] } } as never)
        .mockResolvedValueOnce({
          ok: true,
          data: { configs: [{ id: 'other-config', name: 'Other', model: 'claude-sonnet' }] },
        } as never);

      const result = await checkGuestModePremiumAccess(
        createMockContext(),
        'config-not-found',
        'user-1'
      );
      expect(result.isGuestMode).toBe(true);
      expect(result.blocked).toBe(false);
    });
  });
});
