/**
 * Tests for composeGenerationFailureResult in isolation.
 *
 * The end-to-end error path (z.ai fail → OpenRouter fail → composed failure
 * result through process()) is covered in GenerationStep.test.ts; these tests
 * pin the composer's own contract: pristine-message classification, fallback
 * story folding, diagnostic recording, and the failure-result shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { DiagnosticCollector } from '../../../../services/DiagnosticCollector.js';
import type { GenerationContext } from '../types.js';
import {
  composeGenerationFailureResult,
  type GenerationFailureOptions,
} from './generationFailureResult.js';
import { storeDiagnosticLog } from './diagnosticStorage.js';

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

vi.mock('./diagnosticStorage.js', () => ({
  storeDiagnosticLog: vi.fn(),
}));

/** The registered symbol runWithAutoPromotionFallback attaches both-fail info under. */
const FALLBACK_FAILURE_INFO = Symbol.for('tzurot.fallbackFailureInfo');

function buildOptions(error: unknown): GenerationFailureOptions {
  const diagnosticCollector = {
    recordPartialLlmResponse: vi.fn(),
    recordError: vi.fn(),
  } as unknown as DiagnosticCollector;

  const context = {
    job: {
      id: 'job-1',
      data: {
        requestId: 'req-1',
        personality: { errorMessage: 'persona-configured error line' },
      },
    },
    startTime: Date.now(),
  } as unknown as GenerationContext;

  return {
    error,
    context,
    prisma: {} as PrismaClient,
    diagnosticCollector,
    effectivePersonality: { model: 'glm-4.7' } as GenerationFailureOptions['effectivePersonality'],
    configSource: 'personality',
    provider: 'zai-coding' as GenerationFailureOptions['provider'],
    isGuestMode: false,
  };
}

describe('composeGenerationFailureResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('composes a failure result with a pristine message when no fallback was attempted', () => {
    const options = buildOptions(new Error('OpenRouter timeout'));

    const result = composeGenerationFailureResult(options);

    expect(result.result?.success).toBe(false);
    expect(result.result?.error).toBe('OpenRouter timeout');
    expect(result.result?.personalityErrorMessage).toBe('persona-configured error line');
    expect(result.result?.metadata?.providerUsed).toBe('zai-coding');
    expect(result.result?.metadata?.modelUsed).toBe('glm-4.7');
    // No fallback attempt → the footer chain field stays absent.
    expect(result.result?.metadata?.fallbackProviderAttempted).toBeUndefined();
  });

  it('folds the fallback story into message + metadata on a both-routes-failed error', () => {
    const error = new Error('Rate limit cached');
    (error as unknown as Record<PropertyKey, unknown>)[FALLBACK_FAILURE_INFO] = {
      summary: 'OpenRouter 402 credit check',
      provider: 'openrouter',
    };
    const options = buildOptions(error);

    const result = composeGenerationFailureResult(options);

    // Message tells the whole story, and the same compound lands on
    // technicalMessage (the field bot-client actually renders).
    expect(result.result?.error).toBe(
      'Rate limit cached — fallback via OpenRouter also failed: OpenRouter 402 credit check'
    );
    expect(result.result?.errorInfo?.technicalMessage).toContain(
      'fallback via OpenRouter also failed'
    );
    // Footer seam: both routes named so the chain can render.
    expect(result.result?.metadata?.providerUsed).toBe('zai-coding');
    expect(result.result?.metadata?.fallbackProviderAttempted).toBe('openrouter');
  });

  it('records the failure in the diagnostic collector and stores the log', () => {
    const options = buildOptions(new Error('boom'));

    composeGenerationFailureResult(options);

    expect(options.diagnosticCollector.recordPartialLlmResponse).toHaveBeenCalledWith({
      rawContent: '[error — see error data]',
      modelUsed: 'glm-4.7',
    });
    expect(options.diagnosticCollector.recordError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom', failedAtStage: 'GenerationStep' })
    );
    expect(vi.mocked(storeDiagnosticLog)).toHaveBeenCalledWith(
      options.prisma,
      options.diagnosticCollector,
      'glm-4.7',
      'zai-coding'
    );
  });
});
