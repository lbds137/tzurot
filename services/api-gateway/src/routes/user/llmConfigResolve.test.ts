/**
 * Tests for LLM Config Resolve Handler
 *
 * Schema validation tests for the resolve body schema.
 * Handler integration is tested via llm-config.test.ts (route-level tests).
 */

import { describe, it, expect } from 'vitest';
import { resolveConfigBodySchema } from './llmConfigResolve.js';

describe('resolveConfigBodySchema', () => {
  const validBody = {
    personalityId: 'some-uuid',
    personalityConfig: { id: 'p1', name: 'Test', model: 'gpt-4' },
  };

  it('should accept valid body without channelId', () => {
    const result = resolveConfigBodySchema.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it('should accept valid body with channelId', () => {
    const result = resolveConfigBodySchema.safeParse({
      ...validBody,
      channelId: '999888777666555444',
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing personalityId', () => {
    const result = resolveConfigBodySchema.safeParse({
      personalityConfig: validBody.personalityConfig,
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing personalityConfig', () => {
    const result = resolveConfigBodySchema.safeParse({
      personalityId: validBody.personalityId,
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid channelId format', () => {
    const result = resolveConfigBodySchema.safeParse({
      ...validBody,
      channelId: 'not-a-snowflake',
    });
    expect(result.success).toBe(false);
  });

  it('should allow additional personalityConfig fields via passthrough', () => {
    const result = resolveConfigBodySchema.safeParse({
      ...validBody,
      personalityConfig: {
        ...validBody.personalityConfig,
        systemPrompt: 'You are a helpful assistant',
        temperature: 0.7,
      },
    });
    expect(result.success).toBe(true);
  });
});
