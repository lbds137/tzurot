import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as gatewayClient from '../../../utils/userGatewayClient.js';
import { handleUnlockModelsUpsell, checkGuestModePremiumAccess } from './guestModeValidation.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import type { GatewayUser } from '../../../utils/userGatewayClient.js';

function mkUser(discordId = 'user-1'): GatewayUser {
  return { discordId, username: 'test-user', displayName: 'Test User' };
}

vi.mock('../../../utils/userGatewayClient.js', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/userGatewayClient.js')>(
    '../../../utils/userGatewayClient.js'
  );
  return {
    ...actual,
    callGatewayApi: vi.fn(),
  };
});

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
    // Reset the queue — after the serial-fetch refactor, the paid-user path
    // consumes only one `callGatewayApi` mock (wallet) instead of two
    // (wallet + configs). Without a full reset between tests, leftover
    // `mockResolvedValueOnce` entries would bleed across tests and mis-mock
    // later calls. `mockReset()` clears both call history and the queue.
    vi.mocked(gatewayClient.callGatewayApi).mockReset();
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
      vi.mocked(gatewayClient.callGatewayApi).mockResolvedValueOnce({
        ok: true,
        data: { keys: [{ provider: 'openrouter', isActive: true }] },
      } as never);

      const result = await checkGuestModePremiumAccess(createMockContext(), 'config-1', mkUser());
      expect(result.blocked).toBe(false);
      expect(result).toMatchObject({ blocked: false, reason: 'paid' });
      // Guard against accidental revert to Promise.all — paid path should
      // short-circuit after wallet fetch and never call `/user/llm-config`.
      expect(vi.mocked(gatewayClient.callGatewayApi)).toHaveBeenCalledTimes(1);
    });

    it('should not block guest user selecting free model', async () => {
      vi.mocked(gatewayClient.callGatewayApi)
        .mockResolvedValueOnce({ ok: true, data: { keys: [] } } as never)
        .mockResolvedValueOnce({
          ok: true,
          data: { configs: [{ id: 'config-1', name: 'Free Config', model: 'free-gpt' }] },
        } as never);

      const result = await checkGuestModePremiumAccess(createMockContext(), 'config-1', mkUser());
      expect(result.blocked).toBe(false);
      expect(result).toMatchObject({ blocked: false, reason: 'guest-free-model' });
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

      const result = await checkGuestModePremiumAccess(createMockContext(), 'config-1', mkUser());
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
        mkUser()
      );
      expect(result.blocked).toBe(false);
      expect(result).toMatchObject({ blocked: false, reason: 'guest-free-model' });
    });

    it('should fail-open with reason=check-failed when configs API fails in guest mode', async () => {
      // Wallet succeeded as "no keys" → we're in guest mode. But configs
      // endpoint failed, so we can't decide if the selected config is
      // premium or free. Fail-open with the accurate `check-failed` reason,
      // not the misleading `guest-free-model` that the fallthrough used to
      // produce.
      vi.mocked(gatewayClient.callGatewayApi)
        .mockResolvedValueOnce({ ok: true, data: { keys: [] } } as never)
        .mockResolvedValueOnce({
          ok: false,
          error: 'Gateway timeout',
          status: 504,
        } as never);

      const result = await checkGuestModePremiumAccess(createMockContext(), 'config-1', mkUser());
      expect(result.blocked).toBe(false);
      expect(result).toMatchObject({ blocked: false, reason: 'check-failed' });
      expect(mockEditReply).not.toHaveBeenCalled();
    });

    it('should fail-open when wallet API fails (ai-worker will enforce authoritatively)', async () => {
      // Simulate a transient /wallet/list failure. The historic bug was that
      // this was treated identically to "no keys", locking out users with
      // active paid keys. Fix: fail-open with a warn log, trust the
      // downstream ai-worker gate.
      vi.mocked(gatewayClient.callGatewayApi)
        .mockResolvedValueOnce({
          ok: false,
          error: 'Gateway timeout',
          status: 504,
        } as never)
        .mockResolvedValueOnce({
          ok: true,
          data: {
            configs: [{ id: 'config-1', name: 'Premium Config', model: 'claude-sonnet' }],
          },
        } as never);

      const result = await checkGuestModePremiumAccess(createMockContext(), 'config-1', mkUser());
      expect(result.blocked).toBe(false);
      expect(result).toMatchObject({ blocked: false, reason: 'check-failed' });
      // Critically: we must NOT have shown the "Premium Model Not Available"
      // embed — that's the user-visible false-positive the fix targets.
      expect(mockEditReply).not.toHaveBeenCalled();
    });
  });
});
