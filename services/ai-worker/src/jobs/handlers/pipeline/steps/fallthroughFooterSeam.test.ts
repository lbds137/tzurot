/**
 * Coding-plan → OpenRouter fallthrough → footer metadata SEAM test.
 *
 * The unit suites around this flag each mock their neighbor: AuthStep tests
 * inspect `context.auth`, GenerationStep tests hand-craft `auth`, and the
 * delivery tests feed hand-built metadata. This file runs the REAL steps in
 * order to prove `route.fallthroughTriggered` survives the whole
 * ProviderRouter → AuthStep → toResolvedAuth → GenerationStep →
 * llmGenerationResultSchema → buildModelFooterText chain.
 *
 * External boundaries ONLY are substituted: ProviderRouter, the API-key/config
 * resolvers, the RAG service, and Prisma. `buildResultMetadataPassthrough`
 * lives in `services/bot-client` (unreachable across the `no-cross-service-imports`
 * boundary), so this test mirrors `piggybackFooterSeam.test.ts` by reading the
 * schema-parsed `LLMGenerationResult.metadata` directly at the service seam
 * and feeding it into `buildModelFooterText` (shared in `@tzurot/common-types`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { AIProvider, buildModelInfoUrl } from '@tzurot/common-types/constants/ai';
import { buildModelFooterText } from '@tzurot/common-types/constants/discord';
import { JobType } from '@tzurot/common-types/constants/queue';
import { type LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import { llmGenerationResultSchema } from '@tzurot/common-types/types/schemas/generation';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import type { LlmConfigResolver } from '@tzurot/config-resolver';
import { AuthStep } from './AuthStep.js';
import { GenerationStep } from './GenerationStep.js';
import type { GenerationContext } from '../types.js';
import type { ConversationalRAGService } from '../../../../services/ConversationalRAGService.js';
import type { RAGResponse } from '../../../../services/ConversationalRAGTypes.js';
import {
  NoApiKeyAvailableError,
  type ApiKeyResolver,
} from '../../../../services/ApiKeyResolver.js';
import type { ProviderRouter, ResolvedRoute } from '../../../../services/ProviderRouter.js';

vi.mock('@tzurot/common-types/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const FIXTURE_OR_USER_KEY = 'fixture-or-user-key';
const FALLTHROUGH_MODEL = 'z-ai/glm-4.7';

const FALLTHROUGH_PERSONALITY: LoadedPersonality = {
  id: 'personality-seam-fallthrough-1',
  name: 'SeamBot',
  displayName: 'Seam Bot',
  slug: 'seambot',
  ownerId: 'owner-uuid-seam',
  systemPrompt: 'You are a seam test bot.',
  model: 'glm-4.7',
  provider: 'zai-coding',
  temperature: 0.7,
  maxTokens: 2000,
  contextWindowTokens: 8192,
  voiceEnabled: false,
  errorMessage: 'Sorry, something went wrong.',
} as LoadedPersonality;

function createMockJobData(): LLMGenerationJobData {
  return {
    requestId: 'seam-fallthrough-req-001',
    jobType: JobType.LLMGeneration,
    personality: FALLTHROUGH_PERSONALITY,
    message: 'Hello, seam?',
    context: {
      kind: 'envelope',
      userId: 'user-seam-42',
      userName: 'SeamUser',
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
    id: 'job-seam-fallthrough-1',
    data: createMockJobData(),
  } as Job<LLMGenerationJobData>;
}

function createMockApiKeyResolver(): ApiKeyResolver {
  return {
    resolveApiKey: vi.fn().mockImplementation((_userId: string, provider: AIProvider) =>
      provider === AIProvider.OpenRouter
        ? Promise.resolve({
            apiKey: FIXTURE_OR_USER_KEY,
            provider: AIProvider.OpenRouter,
            source: 'user',
            isGuestMode: false,
          })
        : Promise.reject(new NoApiKeyAvailableError(`No API key available for ${provider}.`))
    ),
    tryResolveUserKey: vi.fn().mockResolvedValue(null),
    invalidateUserCache: vi.fn(),
    clearCache: vi.fn(),
    resolveSystemOpenRouterKey: vi.fn().mockResolvedValue('fixture-or-system-key'),
    resolveUserOpenRouterKey: vi.fn().mockResolvedValue(FIXTURE_OR_USER_KEY),
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
    modelUsed: FALLTHROUGH_MODEL,
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

function createMockProviderRouter(fallthroughTriggered: boolean): ProviderRouter {
  const route: ResolvedRoute = {
    effectiveProvider: AIProvider.OpenRouter,
    effectiveModel: FALLTHROUGH_MODEL,
    apiKey: FIXTURE_OR_USER_KEY,
    isGuestMode: false,
    fallthroughTriggered,
    wasAutoPromoted: false,
  };
  return {
    resolveRoute: vi.fn().mockResolvedValue(route),
  } as unknown as ProviderRouter;
}

describe('coding-plan → OpenRouter fallthrough → footer metadata (AuthStep → GenerationStep seam)', () => {
  let ragService: ConversationalRAGService;

  beforeEach(() => {
    ragService = createMockRAGService();
  });

  async function runChain(providerRouter: ProviderRouter): Promise<GenerationContext> {
    const authStep = new AuthStep(
      createMockApiKeyResolver(),
      createMockConfigResolver(),
      providerRouter
    );
    const generationStep = new GenerationStep(ragService, createMockPrisma());

    const initial: GenerationContext = {
      job: createMockJob(),
      startTime: Date.now(),
      config: { effectivePersonality: FALLTHROUGH_PERSONALITY, configSource: 'personality' },
      preparedContext: {
        conversationHistory: [],
        rawConversationHistory: [],
        participants: [],
      },
    };

    const afterAuth = await authStep.process(initial);
    return generationStep.process(afterAuth);
  }

  it('a fallthrough route carries fallthroughTriggered through AuthStep, GenerationStep, and schema parse into the model footer', async () => {
    const router = createMockProviderRouter(true);
    const context = await runChain(router);

    expect(router.resolveRoute).toHaveBeenCalledWith('zai-coding', 'glm-4.7', 'user-seam-42');
    expect(context.result?.success).toBe(true);
    expect(context.result?.content).toBe('seam answer');
    expect(context.result?.metadata?.fallthroughTriggered).toBe(true);
    expect(context.result?.metadata?.providerUsed).toBe(AIProvider.OpenRouter);
    expect(context.result?.metadata?.modelUsed).toBe(FALLTHROUGH_MODEL);

    const parsed = llmGenerationResultSchema.parse(context.result);
    expect(parsed.metadata?.fallthroughTriggered).toBe(true);

    const modelUsed = parsed.metadata?.modelUsed ?? '';
    const modelUrl = buildModelInfoUrl(modelUsed, parsed.metadata?.providerUsed);
    const footer = buildModelFooterText(modelUsed, modelUrl, {
      provider: parsed.metadata?.providerUsed,
      fallthroughTriggered: parsed.metadata?.fallthroughTriggered,
    });

    expect(footer).toContain('• via OpenRouter (no coding plan key)');
    expect(footer).toBe(
      'Model: [z-ai/glm-4.7](<https://openrouter.ai/z-ai/glm-4.7>) • via OpenRouter (no coding plan key)'
    );
  });

  it('a non-fallthrough OpenRouter route leaves fallthroughTriggered absent and ends the footer with plain via OpenRouter', async () => {
    const router = createMockProviderRouter(false);
    const context = await runChain(router);

    expect(router.resolveRoute).toHaveBeenCalledWith('zai-coding', 'glm-4.7', 'user-seam-42');
    expect(context.result?.success).toBe(true);
    expect(context.result?.metadata?.fallthroughTriggered).toBeUndefined();
    expect(context.result?.metadata?.providerUsed).toBe(AIProvider.OpenRouter);

    const parsed = llmGenerationResultSchema.parse(context.result);
    expect(parsed.metadata?.fallthroughTriggered).toBeUndefined();

    const modelUsed = parsed.metadata?.modelUsed ?? '';
    const modelUrl = buildModelInfoUrl(modelUsed, parsed.metadata?.providerUsed);
    const footer = buildModelFooterText(modelUsed, modelUrl, {
      provider: parsed.metadata?.providerUsed,
      fallthroughTriggered: parsed.metadata?.fallthroughTriggered,
    });

    expect(footer.endsWith('• via OpenRouter')).toBe(true);
    expect(footer).not.toContain('(no coding plan key)');
    expect(footer).toBe(
      'Model: [z-ai/glm-4.7](<https://openrouter.ai/z-ai/glm-4.7>) • via OpenRouter'
    );
  });
});
