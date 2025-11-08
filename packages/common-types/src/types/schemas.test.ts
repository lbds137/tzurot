/**
 * Schema Validation Tests
 *
 * These tests prevent schema drift bugs by ensuring:
 * 1. All expected fields pass validation
 * 2. Fields aren't accidentally stripped during validation
 * 3. The inferred TypeScript types match expectations
 */

import { describe, it, expect } from 'vitest';
import { loadedPersonalitySchema, generateRequestSchema } from './schemas.js';

describe('loadedPersonalitySchema', () => {
  it('should validate a complete personality object', () => {
    const validPersonality = {
      id: 'test-id',
      name: 'Test',
      displayName: 'Test Personality',
      slug: 'test',
      systemPrompt: 'You are a test personality',
      model: 'google/gemini-2.5-pro',
      visionModel: 'qwen/qwen3-vl-235b-a22b-instruct',
      temperature: 0.8,
      maxTokens: 2048,
      topP: 0.9,
      topK: 40,
      frequencyPenalty: 0.1,
      presencePenalty: 0.1,
      contextWindowTokens: 131072,
      memoryScoreThreshold: 0.7,
      memoryLimit: 20,
      avatarUrl: 'https://example.com/avatar.png',
      characterInfo: 'Test character',
      personalityTraits: 'Friendly',
      personalityTone: 'Casual',
      personalityAge: '25',
      personalityAppearance: 'Tall',
      personalityLikes: 'Coffee',
      personalityDislikes: 'Tea',
      conversationalGoals: 'Be helpful',
      conversationalExamples: 'Example 1',
    };

    const result = loadedPersonalitySchema.safeParse(validPersonality);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validPersonality);
    }
  });

  it('should NOT strip visionModel field (regression test for vision model bug)', () => {
    const personality = {
      id: 'test-id',
      name: 'COLD',
      displayName: 'COLD',
      slug: 'cold',
      systemPrompt: 'Test prompt',
      model: 'google/gemini-2.5-pro',
      visionModel: 'qwen/qwen3-vl-235b-a22b-instruct', // THIS MUST NOT BE STRIPPED
      temperature: 0.8,
      maxTokens: 2048,
      contextWindowTokens: 131072,
      characterInfo: 'Test',
      personalityTraits: 'Test',
    };

    const result = loadedPersonalitySchema.safeParse(personality);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visionModel).toBe('qwen/qwen3-vl-235b-a22b-instruct');
      expect(result.data).toHaveProperty('visionModel');
    }
  });

  it('should allow optional fields to be undefined', () => {
    const minimalPersonality = {
      id: 'test-id',
      name: 'Test',
      displayName: 'Test',
      slug: 'test',
      systemPrompt: 'Test',
      model: 'test-model',
      temperature: 0.8,
      maxTokens: 2048,
      contextWindowTokens: 131072,
      characterInfo: 'Test',
      personalityTraits: 'Test',
      // Optional fields omitted
    };

    const result = loadedPersonalitySchema.safeParse(minimalPersonality);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visionModel).toBeUndefined();
      expect(result.data.topP).toBeUndefined();
      expect(result.data.personalityTone).toBeUndefined();
    }
  });

  it('should reject missing required fields', () => {
    const invalidPersonality = {
      id: 'test-id',
      name: 'Test',
      // Missing required fields like displayName, systemPrompt, etc.
    };

    const result = loadedPersonalitySchema.safeParse(invalidPersonality);
    expect(result.success).toBe(false);
  });
});

describe('generateRequestSchema', () => {
  it('should validate request with personality containing visionModel', () => {
    const validRequest = {
      personality: {
        id: 'test-id',
        name: 'Test',
        displayName: 'Test',
        slug: 'test',
        systemPrompt: 'Test',
        model: 'google/gemini-2.5-pro',
        visionModel: 'qwen/qwen3-vl-235b-a22b-instruct',
        temperature: 0.8,
        maxTokens: 2048,
        contextWindowTokens: 131072,
        characterInfo: 'Test',
        personalityTraits: 'Test',
      },
      message: 'Hello',
      context: {
        userId: 'user-123',
        channelId: 'channel-123',
      },
    };

    const result = generateRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      // CRITICAL: Ensure visionModel survives the full request validation
      expect(result.data.personality.visionModel).toBe('qwen/qwen3-vl-235b-a22b-instruct');
    }
  });

  it('should pass personality through API gateway validation without stripping fields', () => {
    // Simulate what bot-client sends
    const requestFromBotClient = {
      personality: {
        id: 'cold-id',
        name: 'COLD',
        displayName: 'COLD',
        slug: 'cold-kerach-batuach',
        systemPrompt: 'You are COLD',
        model: 'google/gemini-2.5-pro',
        visionModel: 'qwen/qwen3-vl-235b-a22b-instruct', // From database
        temperature: 0.8,
        maxTokens: 2048,
        topP: 0.9,
        contextWindowTokens: 131072,
        characterInfo: 'Test',
        personalityTraits: 'Cold',
        avatarUrl: 'https://example.com/avatar.png',
      },
      message: 'test',
      context: {
        userId: 'user-123',
        channelId: 'channel-123',
      },
    };

    // Validate as api-gateway would
    const result = generateRequestSchema.safeParse(requestFromBotClient);
    expect(result.success).toBe(true);

    if (result.success) {
      const validated = result.data;

      // CRITICAL CHECKS: These fields must survive validation
      expect(validated.personality.visionModel).toBe('qwen/qwen3-vl-235b-a22b-instruct');
      expect(validated.personality.slug).toBe('cold-kerach-batuach');
      expect(validated.personality.contextWindowTokens).toBe(131072);
      expect(validated.personality.topP).toBe(0.9);
      expect(validated.personality.avatarUrl).toBe('https://example.com/avatar.png');

      // Ensure object structure is preserved
      expect(validated.personality).toHaveProperty('visionModel');
      expect(validated.personality).toHaveProperty('slug');
      expect(validated.personality).toHaveProperty('contextWindowTokens');
    }
  });
});
