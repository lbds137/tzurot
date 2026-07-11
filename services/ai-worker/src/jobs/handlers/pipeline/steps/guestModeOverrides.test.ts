import { describe, it, expect, vi } from 'vitest';
import { AIProvider, GUEST_MODE, ZAI_FREE_TIER_MODEL } from '@tzurot/common-types/constants/ai';
import type { LlmConfigResolver } from '@tzurot/config-resolver';
import type { ZaiFreeTierAdmission } from '../../../../services/ZaiFreeTierAdmission.js';
import { applyGuestModeOverrides } from './guestModeOverrides.js';
import type { GenerationContext } from '../types.js';

vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

type EffectivePersonality = NonNullable<GenerationContext['config']>['effectivePersonality'];

const PAID_PERSONALITY = {
  id: 'p1',
  name: 'Testy',
  model: 'anthropic/claude-sonnet-4',
  provider: 'openrouter',
  visionModel: 'paid/vision-model',
} as unknown as EffectivePersonality;

function resolverWith(freeModel: string | null): LlmConfigResolver {
  return {
    getFreeDefaultConfig: vi
      .fn()
      .mockResolvedValue(freeModel === null ? null : { model: freeModel }),
  } as unknown as LlmConfigResolver;
}

function admission(admitted: boolean, key: string | undefined = 'sk-plan'): ZaiFreeTierAdmission {
  return {
    admit: vi.fn().mockResolvedValue({ admitted, reason: admitted ? 'ok' : 'quota' }),
    systemKey: vi.fn().mockReturnValue(admitted ? key : undefined),
  } as unknown as ZaiFreeTierAdmission;
}

describe('applyGuestModeOverrides', () => {
  it('keeps an already-free model untouched', async () => {
    const personality = { ...PAID_PERSONALITY, model: 'meta/model:free' };
    const result = await applyGuestModeOverrides({}, personality, 'u1', 'r1');

    expect(result.personality.model).toBe('meta/model:free');
    expect(result.zaiSystemKey).toBeUndefined();
  });

  it('uses an actually-free free-default config', async () => {
    const result = await applyGuestModeOverrides(
      { configResolver: resolverWith('gemma/free-model:free') },
      PAID_PERSONALITY,
      'u1',
      'r1'
    );

    expect(result.personality.model).toBe('gemma/free-model:free');
  });

  it('never lets a misconfigured PAID free-default reach the system OpenRouter key', async () => {
    const result = await applyGuestModeOverrides(
      { configResolver: resolverWith('anthropic/claude-opus-4') },
      PAID_PERSONALITY,
      'u1',
      'r1'
    );

    expect(result.personality.model).toBe(GUEST_MODE.DEFAULT_MODEL);
  });

  it('clears a non-free vision model on the guest override', async () => {
    const result = await applyGuestModeOverrides(
      { configResolver: resolverWith(null) },
      PAID_PERSONALITY,
      'u1',
      'r1'
    );

    expect(result.personality.visionModel).toBeUndefined();
  });

  describe('z.ai piggyback as the guest PERSONAL selection (conditionally free)', () => {
    const PERSONAL_ZAI = { ...PAID_PERSONALITY, model: 'z-ai/glm-4.5-air' };

    it('admitted: upgrades WITHOUT consulting the global free default', async () => {
      const gate = admission(true);
      const resolver = resolverWith('gemma/other-model:free');
      const result = await applyGuestModeOverrides(
        { configResolver: resolver, zaiFreeTierAdmission: gate },
        PERSONAL_ZAI,
        'u1',
        'r1'
      );

      expect(result.personality.model).toBe(ZAI_FREE_TIER_MODEL);
      expect(result.personality.provider).toBe(AIProvider.ZaiCoding);
      expect(result.zaiSystemKey).toBe('sk-plan');
      // The personal selection drives the chain — the global default is never fetched
      expect(vi.mocked(resolver.getFreeDefaultConfig)).not.toHaveBeenCalled();
    });

    it('denied: the model leaves the pool and the cascade continues to the global free default', async () => {
      const result = await applyGuestModeOverrides(
        {
          configResolver: resolverWith('gemma/other-model:free'),
          zaiFreeTierAdmission: admission(false),
        },
        PERSONAL_ZAI,
        'u1',
        'r1'
      );

      expect(result.personality.model).toBe('gemma/other-model:free');
      expect(result.zaiSystemKey).toBeUndefined();
    });

    it('denied with the global default ALSO the piggyback model: router, admission evaluated ONCE', async () => {
      // A denied verdict removes the model for the whole request — no second
      // admit() call (admission consumes quota when it admits).
      const gate = admission(false);
      const result = await applyGuestModeOverrides(
        { configResolver: resolverWith('z-ai/glm-4.5-air'), zaiFreeTierAdmission: gate },
        PERSONAL_ZAI,
        'u1',
        'r1'
      );

      expect(result.personality.model).toBe(GUEST_MODE.DEFAULT_MODEL);
      expect(vi.mocked(gate.admit)).toHaveBeenCalledTimes(1);
    });

    it('denied with no usable global default: last-resort router', async () => {
      const result = await applyGuestModeOverrides(
        { configResolver: resolverWith(null), zaiFreeTierAdmission: admission(false) },
        PERSONAL_ZAI,
        'u1',
        'r1'
      );

      expect(result.personality.model).toBe(GUEST_MODE.DEFAULT_MODEL);
    });

    it('no admission gate wired (ships dark): falls through the ladder to the router', async () => {
      const result = await applyGuestModeOverrides({}, PERSONAL_ZAI, 'u1', 'r1');

      expect(result.personality.model).toBe(GUEST_MODE.DEFAULT_MODEL);
    });

    it('admitted but key vanished (race with config): leaves the pool like any non-admit outcome', async () => {
      const gate = {
        admit: vi.fn().mockResolvedValue({ admitted: true, reason: 'ok' }),
        systemKey: vi.fn().mockReturnValue(undefined),
      } as unknown as ZaiFreeTierAdmission;
      const result = await applyGuestModeOverrides(
        { configResolver: resolverWith('gemma/other-model:free'), zaiFreeTierAdmission: gate },
        PERSONAL_ZAI,
        'u1',
        'r1'
      );

      // Fall-through continues the cascade to the global free default
      expect(result.personality.model).toBe('gemma/other-model:free');
      expect(result.zaiSystemKey).toBeUndefined();
    });

    it('clears a non-free vision model on the fall-through override', async () => {
      const result = await applyGuestModeOverrides(
        { zaiFreeTierAdmission: admission(false) },
        PERSONAL_ZAI,
        'u1',
        'r1'
      );

      expect(result.personality.visionModel).toBeUndefined();
    });
  });

  describe('z.ai piggyback (free default = z-ai/glm-4.5-air)', () => {
    it('admitted: upgrades to the BARE model on zai-coding with the plan key', async () => {
      const gate = admission(true);
      const result = await applyGuestModeOverrides(
        { configResolver: resolverWith('z-ai/glm-4.5-air'), zaiFreeTierAdmission: gate },
        PAID_PERSONALITY,
        'u1',
        'r1'
      );

      expect(result.personality.model).toBe(ZAI_FREE_TIER_MODEL);
      expect(result.personality.provider).toBe(AIProvider.ZaiCoding);
      expect(result.zaiSystemKey).toBe('sk-plan');
      expect(vi.mocked(gate.admit)).toHaveBeenCalledWith('u1', 'r1');
    });

    it('denied: degrades silently to the dynamic free router', async () => {
      const result = await applyGuestModeOverrides(
        {
          configResolver: resolverWith('z-ai/glm-4.5-air'),
          zaiFreeTierAdmission: admission(false),
        },
        PAID_PERSONALITY,
        'u1',
        'r1'
      );

      expect(result.personality.model).toBe(GUEST_MODE.DEFAULT_MODEL);
      expect(result.zaiSystemKey).toBeUndefined();
    });

    it('no admission gate wired (ships dark): degrades to the router', async () => {
      const result = await applyGuestModeOverrides(
        { configResolver: resolverWith('z-ai/glm-4.5-air') },
        PAID_PERSONALITY,
        'u1',
        'r1'
      );

      expect(result.personality.model).toBe(GUEST_MODE.DEFAULT_MODEL);
    });

    it('admitted but key vanished (race with config): degrades to the router', async () => {
      const gate = {
        admit: vi.fn().mockResolvedValue({ admitted: true, reason: 'ok' }),
        systemKey: vi.fn().mockReturnValue(undefined),
      } as unknown as ZaiFreeTierAdmission;
      const result = await applyGuestModeOverrides(
        { configResolver: resolverWith('z-ai/glm-4.5-air'), zaiFreeTierAdmission: gate },
        PAID_PERSONALITY,
        'u1',
        'r1'
      );

      expect(result.personality.model).toBe(GUEST_MODE.DEFAULT_MODEL);
    });
  });
});
