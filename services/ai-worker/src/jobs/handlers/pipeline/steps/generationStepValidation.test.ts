/**
 * Tests for GenerationStep prerequisite validation.
 *
 * The same prerequisite errors are also asserted via integration in
 * GenerationStep.test.ts ("should throw error if config/auth/preparedContext
 * is missing"). These tests pin down the helper's contract directly.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Job } from 'bullmq';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import { validatePrerequisites, enforceGuestFreeTierQuota } from './generationStepValidation.js';
import {
  type FreeTierRequestQuota,
  FREE_TIER_QUOTA_ERROR_MESSAGE,
} from '../../../../services/FreeTierRequestQuota.js';
import type { GenerationContext } from '../types.js';

// The bot owner (`owner-1`) bypasses the guest free-tier meter.
vi.mock('@tzurot/common-types/utils/ownerMiddleware', () => ({
  isBotOwner: (id: string) => id === 'owner-1',
}));

const fakeJob = {} as Job<LLMGenerationJobData>;

function mockQuota(allowed = true): FreeTierRequestQuota {
  return {
    tryConsume: vi.fn().mockResolvedValue({ allowed, reason: allowed ? 'ok' : 'user' }),
  } as unknown as FreeTierRequestQuota;
}

describe('validatePrerequisites', () => {
  it('should throw when config is missing', () => {
    expect(() =>
      validatePrerequisites({
        job: fakeJob,
        startTime: 0,
        auth: {
          apiKey: 'k',
          provider: AIProvider.OpenRouter,
          isGuestMode: false,
          audioProviderKeys: new Map(),
        },
        preparedContext: { conversationHistory: [], rawConversationHistory: [], participants: [] },
      } satisfies GenerationContext)
    ).toThrow(/ConfigStep must run before GenerationStep/);
  });

  it('should throw when auth is missing', () => {
    expect(() =>
      validatePrerequisites({
        job: fakeJob,
        startTime: 0,
        config: {
          effectivePersonality: {} as any,
          configSource: 'personality',
        },
        preparedContext: { conversationHistory: [], rawConversationHistory: [], participants: [] },
      } satisfies GenerationContext)
    ).toThrow(/AuthStep must run before GenerationStep/);
  });

  it('should throw when preparedContext is missing', () => {
    expect(() =>
      validatePrerequisites({
        job: fakeJob,
        startTime: 0,
        config: {
          effectivePersonality: {} as any,
          configSource: 'personality',
        },
        auth: {
          apiKey: 'k',
          provider: AIProvider.OpenRouter,
          isGuestMode: false,
          audioProviderKeys: new Map(),
        },
      } satisfies GenerationContext)
    ).toThrow(/ContextStep must run before GenerationStep/);
  });

  it('should not throw when all prerequisites are present', () => {
    expect(() =>
      validatePrerequisites({
        job: fakeJob,
        startTime: 0,
        config: {
          effectivePersonality: {} as any,
          configSource: 'personality',
        },
        auth: {
          apiKey: 'k',
          provider: AIProvider.OpenRouter,
          isGuestMode: false,
          audioProviderKeys: new Map(),
        },
        preparedContext: { conversationHistory: [], rawConversationHistory: [], participants: [] },
      } satisfies GenerationContext)
    ).not.toThrow();
  });
});

describe('enforceGuestFreeTierQuota', () => {
  it('SKIPS the OpenRouter meter for a z.ai-served guest (the coding-plan pool was charged at admission)', async () => {
    const quota = {
      tryConsume: vi.fn(),
    } as unknown as FreeTierRequestQuota;

    await enforceGuestFreeTierQuota(quota, true, 'user-1', 'req-1', AIProvider.ZaiCoding);

    expect(vi.mocked(quota.tryConsume)).not.toHaveBeenCalled();
  });

  it('is a no-op when the quota is unwired (undefined) — never throws, never consumes', async () => {
    // The wiring-absent path (test fixtures / quota not injected).
    await expect(
      enforceGuestFreeTierQuota(undefined, true, 'user-1', 'req-1')
    ).resolves.toBeUndefined();
  });

  it('meters a guest with (userId, requestId) and does not throw when allowed', async () => {
    const quota = mockQuota(true);
    await enforceGuestFreeTierQuota(quota, true, 'user-1', 'req-1');
    expect(quota.tryConsume).toHaveBeenCalledWith('user-1', 'req-1');
  });

  it('throws the FREE_TIER_QUOTA sentinel when a guest is over their share', async () => {
    const quota = mockQuota(false);
    await expect(enforceGuestFreeTierQuota(quota, true, 'user-1', 'req-1')).rejects.toThrow(
      FREE_TIER_QUOTA_ERROR_MESSAGE
    );
  });

  it('does NOT meter a non-guest (BYOK runs on the user’s own key)', async () => {
    const quota = mockQuota(true);
    await enforceGuestFreeTierQuota(quota, false, 'user-1', 'req-1');
    expect(quota.tryConsume).not.toHaveBeenCalled();
  });

  it('does NOT meter the bot owner even as a guest', async () => {
    const quota = mockQuota(true);
    await enforceGuestFreeTierQuota(quota, true, 'owner-1', 'req-1');
    expect(quota.tryConsume).not.toHaveBeenCalled();
  });
});
