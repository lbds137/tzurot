/**
 * Tests for the personality schemas — currently the vision tier params,
 * whose bounds mirror schemas/llmAdvancedParams.ts (SamplingParamsSchema /
 * max_tokens). If a bound changes on one side, change it on both.
 */

import { describe, it, expect } from 'vitest';
import {
  visionTierParamsSchema,
  VISION_TIER_PARAM_KEYS,
  pickVisionTierParams,
} from './personality.js';

describe('visionTierParamsSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(visionTierParamsSchema.parse({})).toEqual({});
  });

  it('accepts a fully-populated in-range config', () => {
    const params = {
      temperature: 0.7,
      maxTokens: 1024,
      topP: 0.9,
      topK: 40,
      minP: 0.05,
      topA: 0.2,
      frequencyPenalty: 0.5,
      presencePenalty: -0.5,
      repetitionPenalty: 1.1,
      seed: 42,
    };
    expect(visionTierParamsSchema.parse(params)).toEqual(params);
  });

  it('accepts boundary values', () => {
    expect(visionTierParamsSchema.parse({ temperature: 0 })).toEqual({ temperature: 0 });
    expect(visionTierParamsSchema.parse({ temperature: 2 })).toEqual({ temperature: 2 });
    expect(visionTierParamsSchema.parse({ frequencyPenalty: -2 })).toEqual({
      frequencyPenalty: -2,
    });
    expect(visionTierParamsSchema.parse({ presencePenalty: 2 })).toEqual({ presencePenalty: 2 });
    expect(visionTierParamsSchema.parse({ topK: 0 })).toEqual({ topK: 0 });
    expect(visionTierParamsSchema.parse({ repetitionPenalty: 0 })).toEqual({
      repetitionPenalty: 0,
    });
  });

  it.each([
    ['temperature', -0.1],
    ['temperature', 2.1],
    ['topP', -0.1],
    ['topP', 1.1],
    ['minP', -0.1],
    ['minP', 1.1],
    ['topA', -0.1],
    ['topA', 1.1],
    ['frequencyPenalty', -2.1],
    ['frequencyPenalty', 2.1],
    ['presencePenalty', 2.1],
    ['repetitionPenalty', -0.1],
    ['repetitionPenalty', 2.1],
    ['topK', -1],
    ['maxTokens', 0],
    ['maxTokens', -5],
  ])('rejects out-of-range %s = %d', (field, value) => {
    expect(() => visionTierParamsSchema.parse({ [field]: value })).toThrow();
  });

  it.each([
    ['maxTokens', 100.5],
    ['topK', 1.5],
    ['seed', 1.5],
  ])('rejects non-integer %s = %d', (field, value) => {
    expect(() => visionTierParamsSchema.parse({ [field]: value })).toThrow();
  });

  it('rejects non-numeric values', () => {
    expect(() => visionTierParamsSchema.parse({ temperature: 'hot' })).toThrow();
  });
});

describe('VISION_TIER_PARAM_KEYS', () => {
  it('derives every schema field (schema and key list cannot drift)', () => {
    expect(new Set(VISION_TIER_PARAM_KEYS)).toEqual(
      new Set([
        'temperature',
        'maxTokens',
        'topP',
        'topK',
        'minP',
        'topA',
        'frequencyPenalty',
        'presencePenalty',
        'repetitionPenalty',
        'seed',
      ])
    );
  });
});

describe('pickVisionTierParams', () => {
  it('returns undefined when no vision-callable param is set', () => {
    expect(pickVisionTierParams({})).toBeUndefined();
  });

  it('picks only the explicitly-set params', () => {
    expect(pickVisionTierParams({ temperature: 0.5, topP: undefined })).toEqual({
      temperature: 0.5,
    });
  });
});
