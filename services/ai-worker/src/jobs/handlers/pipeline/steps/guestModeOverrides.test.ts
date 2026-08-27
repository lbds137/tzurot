import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { AIProvider, ZAI_FREE_TIER_MODEL } from '@tzurot/common-types/constants/ai';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import type { LlmConfigResolver } from '@tzurot/config-resolver';
import type { ZaiFreeTierAdmission } from '../../../../services/ZaiFreeTierAdmission.js';
import { applyGuestModeOverrides } from './guestModeOverrides.js';
import type { GenerationContext } from '../types.js';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

type EffectivePersonality = NonNullable<GenerationContext['config']>['effectivePersonality'];

/**
 * A free floor that DIFFERS from the registry fallback — proves the code reads
 * the live setting, not a constant that coincidentally equals the fallback
 * (the retired LIVE_TEXT_FLOOR and the fallback were the same value).
 */
const LIVE_TEXT_FLOOR = 'divergent/text-floor:free';

/** The piggyback model in its `z-ai/`-prefixed form — derived so the id never drifts. */
const PREFIXED_ZAI = `z-ai/${ZAI_FREE_TIER_MODEL}`;

beforeAll(() => {
  registerSystemSettings({
    get: (key: string) => (key === 'fallbackTextModelFree' ? LIVE_TEXT_FLOOR : undefined),
  } as unknown as SystemSettingsService);
});

afterAll(() => resetSystemSettingsRegistration());

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

    expect(result.personality.model).toBe(LIVE_TEXT_FLOOR);
  });

  it('degrades a STALE free-default (a retired piggyback id) to the free floor', async () => {
    // The deploy window: ZAI_FREE_TIER_MODEL moves in code ahead of the DB
    // free-default preset, so the stored id is briefly neither `:free` nor the
    // current piggyback. It must take the misconfigured-paid branch — the
    // retired id is a plain PAID OpenRouter model and must never reach the
    // system OpenRouter key.
    const gate = admission(true);
    const result = await applyGuestModeOverrides(
      { configResolver: resolverWith('z-ai/glm-4.7'), zaiFreeTierAdmission: gate },
      PAID_PERSONALITY,
      'u1',
      'r1'
    );

    expect(result.personality.model).toBe(LIVE_TEXT_FLOOR);
    expect(result.zaiSystemKey).toBeUndefined();
    // No admission attempt: a retired id is not the piggyback, so no guest
    // quota share is consumed on its behalf.
    expect(vi.mocked(gate.admit)).not.toHaveBeenCalled();
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
    const PERSONAL_ZAI = { ...PAID_PERSONALITY, model: PREFIXED_ZAI };

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
        { configResolver: resolverWith(PREFIXED_ZAI), zaiFreeTierAdmission: gate },
        PERSONAL_ZAI,
        'u1',
        'r1'
      );

      expect(result.personality.model).toBe(LIVE_TEXT_FLOOR);
      expect(vi.mocked(gate.admit)).toHaveBeenCalledTimes(1);
    });

    it('denied with no usable global default: last-resort router', async () => {
      const result = await applyGuestModeOverrides(
        { configResolver: resolverWith(null), zaiFreeTierAdmission: admission(false) },
        PERSONAL_ZAI,
        'u1',
        'r1'
      );

      expect(result.personality.model).toBe(LIVE_TEXT_FLOOR);
    });

    it('no admission gate wired (ships dark): falls through the ladder to the router', async () => {
      const result = await applyGuestModeOverrides({}, PERSONAL_ZAI, 'u1', 'r1');

      expect(result.personality.model).toBe(LIVE_TEXT_FLOOR);
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
      // Quota was consumed by the successful admit — the fall-through must be
      // OBSERVABLE, not indistinguishable from a plain denial
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { userId: 'u1' },
        expect.stringContaining('system key vanished')
      );
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

  describe('z.ai piggyback (free default = the prefixed piggyback id)', () => {
    it('admitted: upgrades to the BARE model on zai-coding with the plan key', async () => {
      const gate = admission(true);
      const result = await applyGuestModeOverrides(
        { configResolver: resolverWith(PREFIXED_ZAI), zaiFreeTierAdmission: gate },
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
          configResolver: resolverWith(PREFIXED_ZAI),
          zaiFreeTierAdmission: admission(false),
        },
        PAID_PERSONALITY,
        'u1',
        'r1'
      );

      expect(result.personality.model).toBe(LIVE_TEXT_FLOOR);
      expect(result.zaiSystemKey).toBeUndefined();
    });

    it('no admission gate wired (ships dark): degrades to the router', async () => {
      const result = await applyGuestModeOverrides(
        { configResolver: resolverWith(PREFIXED_ZAI) },
        PAID_PERSONALITY,
        'u1',
        'r1'
      );

      expect(result.personality.model).toBe(LIVE_TEXT_FLOOR);
    });

    it('admitted but key vanished (race with config): degrades to the router', async () => {
      const gate = {
        admit: vi.fn().mockResolvedValue({ admitted: true, reason: 'ok' }),
        systemKey: vi.fn().mockReturnValue(undefined),
      } as unknown as ZaiFreeTierAdmission;
      const result = await applyGuestModeOverrides(
        { configResolver: resolverWith(PREFIXED_ZAI), zaiFreeTierAdmission: gate },
        PAID_PERSONALITY,
        'u1',
        'r1'
      );

      expect(result.personality.model).toBe(LIVE_TEXT_FLOOR);
    });
  });

  describe('footer announce carrier (guest_mode)', () => {
    it('carries no note when the configured model was already free', async () => {
      const personality = { ...PAID_PERSONALITY, model: 'meta/model:free' };
      const result = await applyGuestModeOverrides({}, personality, 'u1', 'r1');

      expect(result.quotaFallback).toBeUndefined();
    });

    it('announces the free-default substitution from the configured model', async () => {
      const result = await applyGuestModeOverrides(
        { configResolver: resolverWith('gemma/free-model:free') },
        PAID_PERSONALITY,
        'u1',
        'r1'
      );

      expect(result.quotaFallback).toEqual({
        fromModel: 'anthropic/claude-sonnet-4',
        toModel: 'gemma/free-model:free',
        category: 'guest_mode',
        mode: 'proactive',
      });
    });

    it('names the floor as the destination when the free default degrades', async () => {
      // Event (b) of the task: no second category — the accurate toModel is
      // what tells the user they landed on the hard floor.
      const result = await applyGuestModeOverrides(
        { configResolver: resolverWith('anthropic/claude-opus-4') },
        PAID_PERSONALITY,
        'u1',
        'r1'
      );

      expect(result.quotaFallback).toEqual({
        fromModel: 'anthropic/claude-sonnet-4',
        toModel: LIVE_TEXT_FLOOR,
        category: 'guest_mode',
        mode: 'proactive',
      });
    });

    it('announces the piggyback upgrade reached from the global free default', async () => {
      const result = await applyGuestModeOverrides(
        { configResolver: resolverWith(PREFIXED_ZAI), zaiFreeTierAdmission: admission(true) },
        PAID_PERSONALITY,
        'u1',
        'r1'
      );

      expect(result.quotaFallback).toEqual({
        fromModel: 'anthropic/claude-sonnet-4',
        toModel: ZAI_FREE_TIER_MODEL,
        category: 'guest_mode',
        mode: 'proactive',
      });
    });

    it('announces the prefix normalization on a personally-selected piggyback model', async () => {
      const result = await applyGuestModeOverrides(
        { zaiFreeTierAdmission: admission(true) },
        { ...PAID_PERSONALITY, model: PREFIXED_ZAI } as EffectivePersonality,
        'u1',
        'r1'
      );

      expect(result.quotaFallback).toEqual({
        fromModel: PREFIXED_ZAI,
        toModel: ZAI_FREE_TIER_MODEL,
        category: 'guest_mode',
        mode: 'proactive',
      });
    });

    it('carries no note when the piggyback upgrade leaves the model identical', async () => {
      // A guest who selected the BARE piggyback id: the provider changes but
      // the model string does not, so there is no substitution to announce.
      const result = await applyGuestModeOverrides(
        { zaiFreeTierAdmission: admission(true) },
        { ...PAID_PERSONALITY, model: ZAI_FREE_TIER_MODEL } as EffectivePersonality,
        'u1',
        'r1'
      );

      expect(result.personality.model).toBe(ZAI_FREE_TIER_MODEL);
      expect(result.quotaFallback).toBeUndefined();
    });
  });
});
