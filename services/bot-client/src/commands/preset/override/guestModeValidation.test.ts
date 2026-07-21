import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUnlockModelsUpsell, checkGuestModePremiumAccess } from './guestModeValidation.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { makeOk, makeErr, asUserClient } from '../../../test/gatewayClientStubs.js';

const stub = {
  actor: 'user-1',
  listWalletKeys: vi.fn(),
  listUserLlmConfigs: vi.fn(),
};

function userClient(actorId = 'user-1') {
  return asUserClient({ ...stub, actor: actorId });
}

vi.mock('./autocomplete.js', () => ({
  UNLOCK_MODELS_VALUE: '__UNLOCK_ALL_MODELS__',
}));

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
    stub.listWalletKeys.mockReset();
    stub.listUserLlmConfigs.mockReset();
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
      stub.listWalletKeys.mockResolvedValue(
        makeOk({ keys: [{ provider: 'openrouter', isActive: true }] })
      );

      const result = await checkGuestModePremiumAccess(
        createMockContext(),
        'config-1',
        userClient()
      );
      expect(result.blocked).toBe(false);
      expect(result).toMatchObject({ blocked: false, reason: 'paid' });
      // Paid path: configs not fetched
      expect(stub.listUserLlmConfigs).not.toHaveBeenCalled();
    });

    it('should not block guest user selecting free model', async () => {
      stub.listWalletKeys.mockResolvedValue(makeOk({ keys: [] }));
      stub.listUserLlmConfigs.mockResolvedValue(
        makeOk({
          configs: [{ id: 'config-1', name: 'Free Config', model: 'meta/llama-scout:free' }],
        })
      );

      const result = await checkGuestModePremiumAccess(
        createMockContext(),
        'config-1',
        userClient()
      );
      expect(result.blocked).toBe(false);
      expect(result).toMatchObject({ blocked: false, reason: 'guest-free-model' });
    });

    it('does not block a guest selecting the z.ai piggyback preset (conditionally free)', async () => {
      // GLM-4.5-Air is free-tier ELIGIBLE (admission decides at runtime) —
      // the picker gate must not bounce it as premium.
      stub.listWalletKeys.mockResolvedValue(makeOk({ keys: [] }));
      stub.listUserLlmConfigs.mockResolvedValue(
        makeOk({ configs: [{ id: 'config-1', name: 'GLM 4.5 Air', model: 'z-ai/glm-4.5-air' }] })
      );

      const result = await checkGuestModePremiumAccess(
        createMockContext(),
        'config-1',
        userClient()
      );
      expect(result.blocked).toBe(false);
      expect(mockEditReply).not.toHaveBeenCalled();
    });

    it('should block guest user selecting premium model', async () => {
      stub.listWalletKeys.mockResolvedValue(makeOk({ keys: [] }));
      stub.listUserLlmConfigs.mockResolvedValue(
        makeOk({ configs: [{ id: 'config-1', name: 'Premium Config', model: 'claude-sonnet' }] })
      );

      const result = await checkGuestModePremiumAccess(
        createMockContext(),
        'config-1',
        userClient()
      );
      expect(result.blocked).toBe(true);
      expect(mockEditReply).toHaveBeenCalled();
    });

    it('should not block when config is not found', async () => {
      stub.listWalletKeys.mockResolvedValue(makeOk({ keys: [] }));
      stub.listUserLlmConfigs.mockResolvedValue(
        makeOk({ configs: [{ id: 'other-config', name: 'Other', model: 'claude-sonnet' }] })
      );

      const result = await checkGuestModePremiumAccess(
        createMockContext(),
        'config-not-found',
        userClient()
      );
      expect(result.blocked).toBe(false);
      expect(result).toMatchObject({ blocked: false, reason: 'guest-free-model' });
    });

    it('should fail-open with reason=check-failed when configs API fails in guest mode', async () => {
      stub.listWalletKeys.mockResolvedValue(makeOk({ keys: [] }));
      stub.listUserLlmConfigs.mockResolvedValue(makeErr(504, 'Gateway timeout'));

      const result = await checkGuestModePremiumAccess(
        createMockContext(),
        'config-1',
        userClient()
      );
      expect(result.blocked).toBe(false);
      expect(result).toMatchObject({ blocked: false, reason: 'check-failed' });
      expect(mockEditReply).not.toHaveBeenCalled();
    });

    it('should fail-open when wallet API fails (ai-worker will enforce authoritatively)', async () => {
      stub.listWalletKeys.mockResolvedValue(makeErr(504, 'Gateway timeout'));

      const result = await checkGuestModePremiumAccess(
        createMockContext(),
        'config-1',
        userClient()
      );
      expect(result.blocked).toBe(false);
      expect(result).toMatchObject({ blocked: false, reason: 'check-failed' });
      // Critically: we must NOT have shown the "Premium Model Not Available"
      // embed — that's the user-visible false-positive the fix targets.
      expect(mockEditReply).not.toHaveBeenCalled();
    });
  });
});
