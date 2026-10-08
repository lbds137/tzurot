/**
 * Piggyback denial → footer metadata SEAM test.
 *
 * The unit suites around this flag each mock their neighbor: AuthStep tests
 * mock the admission gate, GenerationStep tests hand-craft `auth`, and the
 * passthrough tests feed hand-built metadata. Nothing else proves the flag
 * a REAL admission denial sets in guestModeOverrides survives the whole
 * AuthStep → GenerationStep chain and arrives in the result metadata the
 * delivery layer reads.
 *
 * This file runs the REAL steps in order:
 *
 *   AuthStep.process → applyGuestModeOverrides → ZaiFreeTierAdmission.admit
 *     (REAL, on a fake in-memory Redis — the kill-switch flag denies before
 *     the meter's HTTP endpoint is ever consulted)
 *   → GenerationStep.process (REAL, RAG service mocked)
 *
 * External boundaries ONLY are substituted: the API-key/config resolvers, the
 * RAG service, Prisma, and Redis. The admission gate is the REAL service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { AIProvider, ZAI_FREE_TIER_MODEL } from '@tzurot/common-types/constants/ai';
import { ZAI_FREE_TIER_KILL_SWITCH_KEY } from '@tzurot/common-types/constants/redis-keys';
import { JobType } from '@tzurot/common-types/constants/queue';
import { type LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import type { LlmConfigResolver } from '@tzurot/config-resolver';
import { AuthStep } from './AuthStep.js';
import { GenerationStep } from './GenerationStep.js';
import type { GenerationContext } from '../types.js';
import type { ConversationalRAGService } from '../../../../services/ConversationalRAGService.js';
import type { RAGResponse } from '../../../../services/ConversationalRAGTypes.js';
import type { ApiKeyResolver } from '../../../../services/ApiKeyResolver.js';
import { NoApiKeyAvailableError } from '../../../../services/ApiKeyResolver.js';
import { ZaiFreeTierAdmission } from '../../../../services/ZaiFreeTierAdmission.js';
import { ZaiPlanMeter } from '../../../../services/ZaiPlanMeter.js';
import {
  FreeTierRequestQuota,
  ZAI_FREE_TIER_KEYS,
} from '../../../../services/FreeTierRequestQuota.js';

vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

/**
 * Minimal in-memory Redis fake covering exactly the commands the admission
 * chain issues (same shape as zaiFreeTierAdmissionChain.test.ts's fake).
 */
class FakeRedis {
  readonly strings = new Map<string, string>();
  readonly zsets = new Map<string, Map<string, number>>();

  async exists(key: string): Promise<number> {
    return this.strings.has(key) || this.zsets.has(key) ? 1 : 0;
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null> {
    if (args.includes('NX') && this.strings.has(key)) {
      return null;
    }
    this.strings.set(key, value);
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    const next = Number(this.strings.get(key) ?? '0') + 1;
    this.strings.set(key, String(next));
    return next;
  }

  async expire(_key: string, _seconds: number): Promise<number> {
    return 1;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    const zset = this.zsets.get(key) ?? new Map<string, number>();
    const isNew = !zset.has(member);
    zset.set(member, score);
    this.zsets.set(key, zset);
    return isNew ? 1 : 0;
  }

  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }

  async zscore(key: string, member: string): Promise<string | null> {
    const score = this.zsets.get(key)?.get(member);
    return score === undefined ? null : String(score);
  }

  async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    const zset = this.zsets.get(key);
    if (zset === undefined) {
      return 0;
    }
    const lo = min === '-inf' ? -Infinity : Number(min);
    const hi = max === '+inf' ? Infinity : Number(max);
    let removed = 0;
    for (const [member, score] of zset) {
      if (score >= lo && score <= hi) {
        zset.delete(member);
        removed++;
      }
    }
    return removed;
  }

  asRedis(): Redis {
    return this as unknown as Redis;
  }
}

const NOW = 1_700_000_000_000;
const PLAN_KEY = 'sk-coding-plan';

/** The piggyback model in its `z-ai/`-prefixed form — derived so the id never drifts. */
const PREFIXED_ZAI = `z-ai/${ZAI_FREE_TIER_MODEL}`;

const PIGGYBACK_PERSONALITY: LoadedPersonality = {
  id: 'personality-seam-1',
  name: 'SeamBot',
  displayName: 'Seam Bot',
  slug: 'seambot',
  ownerId: 'owner-uuid-seam',
  systemPrompt: 'You are a seam test bot.',
  model: PREFIXED_ZAI,
  provider: 'openrouter',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 8192,
  voiceEnabled: false,
  errorMessage: 'Sorry, something went wrong.',
} as LoadedPersonality;

function createMockJobData(): LLMGenerationJobData {
  return {
    requestId: 'seam-req-001',
    jobType: JobType.LLMGeneration,
    personality: PIGGYBACK_PERSONALITY,
    message: 'Hello, seam?',
    context: {
      kind: 'envelope',
      userId: 'guest-42',
      userName: 'GuestUser',
      channelId: 'channel-seam-1',
    },
    responseDestination: {
      type: 'discord',
      channelId: 'channel-seam-1',
    },
  };
}

function createMockJob(): Job<LLMGenerationJobData> {
  return {
    id: 'job-seam-1',
    data: createMockJobData(),
  } as Job<LLMGenerationJobData>;
}

function createMockApiKeyResolver(): ApiKeyResolver {
  return {
    // LLM path: a guest on the OpenRouter system key. Audio providers: no
    // BYOK key (the expected NoApiKeyAvailableError control flow).
    resolveApiKey: vi.fn().mockImplementation((_userId: string, provider: AIProvider) =>
      provider === AIProvider.OpenRouter
        ? Promise.resolve({
            apiKey: 'sk-system-openrouter',
            provider: AIProvider.OpenRouter,
            source: 'system',
            isGuestMode: true,
          })
        : Promise.reject(new NoApiKeyAvailableError(`No API key available for ${provider}.`))
    ),
    // No z.ai-coding key → the real ProviderRouter does NOT auto-promote the
    // prefixed model; the guest ladder handles it.
    tryResolveUserKey: vi.fn().mockResolvedValue(null),
    invalidateUserCache: vi.fn(),
    clearCache: vi.fn(),
    resolveSystemOpenRouterKey: vi.fn().mockResolvedValue('sk-system-openrouter'),
    resolveUserOpenRouterKey: vi.fn().mockResolvedValue(undefined),
  } as unknown as ApiKeyResolver;
}

function createMockConfigResolver(): LlmConfigResolver {
  return {
    getFreeDefaultConfig: vi
      .fn()
      .mockResolvedValue({ model: 'gemma/fallback:free', provider: 'openrouter' }),
  } as unknown as LlmConfigResolver;
}

function createMockRAGService(): ConversationalRAGService {
  const ragResponse: RAGResponse = {
    content: 'seam answer',
    retrievedMemories: 0,
    tokensIn: 1,
    tokensOut: 1,
    modelUsed: 'gemma/fallback:free',
  };
  return {
    generateResponse: vi.fn().mockResolvedValue(ragResponse),
    storeDeferredMemory: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConversationalRAGService;
}

function createMockPrisma(): PrismaClient {
  return {
    user: { findUnique: vi.fn().mockResolvedValue(null) },
    llmDiagnosticLog: { create: vi.fn().mockResolvedValue(undefined) },
  } as unknown as PrismaClient;
}

/** The REAL admission gate on the in-memory Redis; `killSwitch` presets the flag. */
function buildRealAdmission(redis: FakeRedis, killSwitch: boolean): ZaiFreeTierAdmission {
  if (killSwitch) {
    redis.strings.set(ZAI_FREE_TIER_KILL_SWITCH_KEY, '1');
  }
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        limits: [{ type: 'TOKENS_LIMIT', percentage: 10, nextResetTime: NOW + 60_000 }],
      },
    }),
  });
  const meter = new ZaiPlanMeter(
    PLAN_KEY,
    redis.asRedis(),
    fetchImpl as unknown as typeof fetch,
    () => NOW
  );
  const quota = new FreeTierRequestQuota(
    redis.asRedis(),
    { globalDailyBudget: 10, windowMinutes: 60, minPerWindow: 1, maxPerWindow: 5 },
    () => NOW,
    ZAI_FREE_TIER_KEYS
  );
  return new ZaiFreeTierAdmission(redis.asRedis(), quota, meter, {
    enabled: () => true,
    apiKey: PLAN_KEY,
    headroomPercent: () => 75,
  });
}

describe('piggyback denial → footer metadata (AuthStep → GenerationStep seam)', () => {
  let redis: FakeRedis;
  let ragService: ConversationalRAGService;

  beforeEach(() => {
    redis = new FakeRedis();
    ragService = createMockRAGService();
  });

  async function runChain(admission: ZaiFreeTierAdmission): Promise<GenerationContext> {
    const authStep = new AuthStep(
      createMockApiKeyResolver(),
      createMockConfigResolver(),
      undefined,
      undefined,
      {
        zaiFreeTierAdmission: admission,
      }
    );
    const generationStep = new GenerationStep(ragService, createMockPrisma());

    const initial: GenerationContext = {
      job: createMockJob(),
      startTime: Date.now(),
      config: { effectivePersonality: PIGGYBACK_PERSONALITY, configSource: 'personality' },
      preparedContext: {
        conversationHistory: [],
        rawConversationHistory: [],
        participants: [],
      },
    };

    const afterAuth = await authStep.process(initial);
    return generationStep.process(afterAuth);
  }

  it('a REAL admission denial (kill switch) carries BOTH flag fields into the result metadata', async () => {
    const result = await runChain(buildRealAdmission(redis, true));

    // The generation itself SUCCEEDED on the fallback free model — the note
    // is a footer annotation, not an error path.
    expect(result.result?.success).toBe(true);
    expect(result.result?.content).toBe('seam answer');

    // The seam: the boolean and the denied model id arrive TOGETHER, spelled
    // as the request carried them (the prefixed form, pre-substitution).
    expect(result.result?.metadata?.piggybackSkipped).toBe(true);
    expect(result.result?.metadata?.piggybackModel).toBe(PREFIXED_ZAI);

    // The fallback that actually served is the free ladder's target, and the
    // guest substitution announce rode alongside.
    expect(result.result?.metadata?.modelUsed).toBe('gemma/fallback:free');
    expect(result.result?.metadata?.quotaFallback?.category).toBe('guest_mode');
  });

  it('an admitted request (no kill switch) carries NEITHER field into the result metadata', async () => {
    const result = await runChain(buildRealAdmission(redis, false));

    expect(result.result?.success).toBe(true);
    expect(result.result?.metadata?.piggybackSkipped).toBeUndefined();
    expect(result.result?.metadata?.piggybackModel).toBeUndefined();
    // The upgrade actually happened — the personality was rewritten to the
    // bare piggyback id on the coding-plan key before generation ran.
    // (metadata.modelUsed echoes the RAG response, so the admission evidence
    // is asserted on the auth/config seam, not there.)
    expect(result.config?.effectivePersonality.model).toBe(ZAI_FREE_TIER_MODEL);
    expect(result.auth?.apiKey).toBe(PLAN_KEY);
    expect(result.auth?.provider).toBe(AIProvider.ZaiCoding);
  });
});
