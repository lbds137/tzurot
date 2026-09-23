/**
 * Tests for persistSuccessDiagnostic in isolation.
 *
 * Pins the seam args crossing into storeDiagnosticLog: the served provider
 * (result.metadata.providerUsed, falling back to the auth-resolved provider,
 * then 'unknown') and the success/collector guards.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import type { GenerationContext } from '../types.js';
import { persistSuccessDiagnostic } from './successDiagnostic.js';
import { storeDiagnosticLog } from './diagnosticStorage.js';

vi.mock('./diagnosticStorage.js', () => ({
  storeDiagnosticLog: vi.fn(),
}));

const mockStoreDiagnosticLog = vi.mocked(storeDiagnosticLog);
const prisma = {} as unknown as PrismaClient;
const collector = {} as unknown as GenerationContext['diagnosticCollector'];

function buildContext(overrides: Partial<GenerationContext> = {}): GenerationContext {
  return {
    job: { id: 'job-1' } as unknown as GenerationContext['job'],
    startTime: Date.now(),
    diagnosticCollector: collector,
    result: {
      requestId: 'req-1',
      success: true,
      content: 'hi',
      metadata: {
        modelUsed: 'z-ai/glm-5.1',
        providerUsed: AIProvider.OpenRouter,
      },
    },
    auth: {
      provider: AIProvider.ZaiCoding,
    } as unknown as GenerationContext['auth'],
    ...overrides,
  } as unknown as GenerationContext;
}

describe('persistSuccessDiagnostic', () => {
  it('stores with the served provider from result.metadata.providerUsed over the auth provider', () => {
    const context = buildContext();

    persistSuccessDiagnostic(prisma, context);

    expect(mockStoreDiagnosticLog).toHaveBeenCalledWith(
      prisma,
      collector,
      'z-ai/glm-5.1',
      AIProvider.OpenRouter
    );
  });

  it('falls back to the auth-resolved provider when metadata.providerUsed is absent', () => {
    const context = buildContext({
      result: {
        requestId: 'req-1',
        success: true,
        content: 'hi',
        metadata: { modelUsed: 'z-ai/glm-5.1' },
      } as unknown as GenerationContext['result'],
    });

    persistSuccessDiagnostic(prisma, context);

    expect(mockStoreDiagnosticLog).toHaveBeenCalledWith(
      prisma,
      collector,
      'z-ai/glm-5.1',
      AIProvider.ZaiCoding
    );
  });

  it('falls back to "unknown" for both model and provider when neither is available', () => {
    const context = buildContext({
      result: {
        requestId: 'req-1',
        success: true,
        content: 'hi',
      } as unknown as GenerationContext['result'],
      auth: {} as unknown as GenerationContext['auth'],
    });

    persistSuccessDiagnostic(prisma, context);

    expect(mockStoreDiagnosticLog).toHaveBeenCalledWith(prisma, collector, 'unknown', 'unknown');
  });

  it('does not store when the result is unsuccessful', () => {
    const context = buildContext({
      result: {
        requestId: 'req-1',
        success: false,
        error: 'boom',
      } as unknown as GenerationContext['result'],
    });

    persistSuccessDiagnostic(prisma, context);

    expect(mockStoreDiagnosticLog).not.toHaveBeenCalled();
  });

  it('does not store when diagnosticCollector is undefined', () => {
    const context = buildContext({ diagnosticCollector: undefined });

    persistSuccessDiagnostic(prisma, context);

    expect(mockStoreDiagnosticLog).not.toHaveBeenCalled();
  });
});
