/**
 * Tests for the model-capability pattern fallbacks.
 *
 * ModelCapabilityChecker.test.ts already exercises these through the public
 * capability API with Redis unavailable — that stays the behavioural coverage.
 * These tests pin the predicates directly, so a pattern-list edit is attributable
 * to this module rather than surfacing as a confusing failure one layer up.
 */

import { describe, it, expect } from 'vitest';
import {
  listZaiCodingPlanModels,
  zaiCodingPlanModelCapabilities,
} from '@tzurot/common-types/constants/ai';
import {
  hasVisionSupportFallback,
  hasReasoningSupportFallback,
} from './modelCapabilityPatterns.js';

describe('hasVisionSupportFallback', () => {
  it.each([
    'openai/gpt-4-vision-preview',
    'openai/gpt-4o',
    'anthropic/claude-3-opus',
    'anthropic/claude-4-sonnet',
    'google/gemini-2.0-flash',
    'google/gemini-2-flash',
    'google/gemma-3-27b-it',
    'meta-llama/llama-3.2-90b-vision-instruct',
    'qwen/qwen-2-vl-7b',
    'qwen/qwen3.5-plus',
    'mistralai/pixtral-12b',
    'opengvlab/internvl3-78b',
    // The vision-flagged z.ai coding-plan models, with and without the prefix
    // the z.ai-direct route carries.
    'glm-5.3-flash',
    'z-ai/glm-5.3-flash',
    'glm-5.4',
    'z-ai/glm-5.4',
    'z-ai/glm-5.4:free',
  ])('detects %s as vision-capable', model => {
    expect(hasVisionSupportFallback(model)).toBe(true);
  });

  it.each([
    'openai/gpt-3.5-turbo',
    'meta-llama/llama-3-70b-instruct',
    'qwen/qwen3-32b',
    'deepseek/deepseek-r1',
    // GLM siblings the vision term must NOT reach: a different flash generation,
    // and the base 5.3 line the flash variant is named after.
    'z-ai/glm-4.7-flash',
    'z-ai/glm-5.3',
    // Hypothetical text-only glm-5.4 variants the exact glm-5.4 term must not
    // reach (a substring term would match both).
    'z-ai/glm-5.4-turbo',
    'glm-5.4-air',
    // Dated snapshot of glm-5.4: the exact rule does not recognize it, so it
    // falls through as not-vision (fail-closed).
    'z-ai/glm-5.4-20261201',
    // Boundary cases for the exact rule: a `/` anchor (xglm-5.4 is not a
    // provider-prefixed glm-5.4) and whole-id equality (glm-5.4x is not glm-5.4).
    'z-ai/xglm-5.4',
    'glm-5.4x',
  ])('does not claim %s is vision-capable', model => {
    expect(hasVisionSupportFallback(model)).toBe(false);
  });

  it('is case-insensitive — the caller may pass a raw catalog ID', () => {
    expect(hasVisionSupportFallback('Anthropic/Claude-3-Opus')).toBe(true);
  });
});

describe('catalog ↔ VISION_MODEL_PATTERNS parity', () => {
  // Drift guard: a z.ai coding-plan catalog edit that flips a model's
  // supportsVision flag must be mirrored in the degraded-mode fallback patterns,
  // or the two resolution paths disagree silently.
  it('every catalog member declaring vision satisfies hasVisionSupportFallback', () => {
    // Non-vacuity: the loop below asserts nothing if no member declares vision.
    expect(
      listZaiCodingPlanModels().some(
        ({ model }) => zaiCodingPlanModelCapabilities(model)?.supportsVision === true
      )
    ).toBe(true);
    for (const { model } of listZaiCodingPlanModels()) {
      const vision = zaiCodingPlanModelCapabilities(model)?.supportsVision === true;
      if (vision) {
        expect({ model, fallback: hasVisionSupportFallback(model) }).toEqual({
          model,
          fallback: true,
        });
      }
    }
  });

  it('every catalog member without vision does not satisfy hasVisionSupportFallback', () => {
    // Non-vacuity: the loop below asserts nothing if every member declares vision.
    expect(
      listZaiCodingPlanModels().some(
        ({ model }) => zaiCodingPlanModelCapabilities(model)?.supportsVision !== true
      )
    ).toBe(true);
    for (const { model } of listZaiCodingPlanModels()) {
      const vision = zaiCodingPlanModelCapabilities(model)?.supportsVision === true;
      if (!vision) {
        expect({ model, fallback: hasVisionSupportFallback(model) }).toEqual({
          model,
          fallback: false,
        });
      }
    }
  });
});

describe('hasReasoningSupportFallback', () => {
  it.each([
    'deepseek/deepseek-r1',
    'deepseek/deepseek-v3',
    'qwen/qwq-32b',
    'qwen/qwen3-235b',
    'openai/gpt-5',
    'openai/gpt-oss-120b',
    'anthropic/claude-3.7-sonnet',
    'anthropic/claude-sonnet-4.5',
    'google/gemini-2.5-pro',
    'moonshotai/kimi-k2',
    'z-ai/glm-4.6',
    'x-ai/grok-4',
  ])('detects %s as reasoning-capable', model => {
    expect(hasReasoningSupportFallback(model)).toBe(true);
  });

  it.each(['openai/gpt-4o', 'meta-llama/llama-3-70b-instruct', 'mistralai/pixtral-12b'])(
    'does not claim %s is reasoning-capable',
    model => {
      expect(hasReasoningSupportFallback(model)).toBe(false);
    }
  );

  it('is case-insensitive — the caller may pass a raw catalog ID', () => {
    expect(hasReasoningSupportFallback('DeepSeek/DeepSeek-R1')).toBe(true);
  });
});

describe('the two lists are independent', () => {
  it('a vision-only model is not reported as reasoning-capable', () => {
    expect(hasVisionSupportFallback('mistralai/pixtral-12b')).toBe(true);
    expect(hasReasoningSupportFallback('mistralai/pixtral-12b')).toBe(false);
  });

  it('a reasoning-only model is not reported as vision-capable', () => {
    expect(hasReasoningSupportFallback('deepseek/deepseek-r1')).toBe(true);
    expect(hasVisionSupportFallback('deepseek/deepseek-r1')).toBe(false);
  });
});
