/**
 * Tests for GenerationStep prerequisite validation.
 *
 * The same prerequisite errors are also asserted via integration in
 * GenerationStep.test.ts ("should throw error if config/auth/preparedContext
 * is missing"). These tests pin down the helper's contract directly.
 */

import { describe, it, expect } from 'vitest';
import type { Job } from 'bullmq';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type LLMGenerationJobData } from '@tzurot/common-types/types/jobs';
import { validatePrerequisites } from './generationStepValidation.js';
import type { GenerationContext } from '../types.js';

const fakeJob = {} as Job<LLMGenerationJobData>;

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
