/**
 * Tests for LLM Config Resolve Handler
 *
 * Schema validation tests for the resolve body schema.
 * Handler integration is tested via llm-config.test.ts (route-level tests).
 */

import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { LlmConfigResolver, ConfigCascadeResolver } from '@tzurot/config-resolver';
import { createResolveHandler, resolveConfigBodySchema } from './llmConfigResolve.js';
import type { AuthenticatedRequest } from '../../types.js';

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

describe('createResolveHandler injection', () => {
  it('resolves through the injected (shared) LlmConfigResolver, not a fresh one', async () => {
    // The convergence guard: when index.ts passes the shared, pub/sub-invalidated
    // resolver, the handler must use THAT instance — otherwise the endpoint would
    // silently fall back to a second, un-invalidated cache (the bug this closes).
    const resolveConfig = vi
      .fn()
      .mockResolvedValue({ config: { model: 'm' }, source: 'user-default' });
    const resolveOverrides = vi.fn().mockResolvedValue({});
    const injectedLlm = { resolveConfig } as unknown as LlmConfigResolver;
    const injectedCascade = { resolveOverrides } as unknown as ConfigCascadeResolver;

    const handler = createResolveHandler({} as PrismaClient, injectedCascade, injectedLlm);

    const req = {
      userId: 'discord-123',
      body: { personalityId: 'p1', personalityConfig: { id: 'p1', name: 'Test', model: 'm' } },
    } as unknown as AuthenticatedRequest;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;

    await handler(req, res);

    expect(resolveConfig).toHaveBeenCalledWith(
      'discord-123',
      'p1',
      expect.objectContaining({ model: 'm' })
    );
    expect(resolveOverrides).toHaveBeenCalledWith('discord-123', 'p1', undefined);
  });
});
