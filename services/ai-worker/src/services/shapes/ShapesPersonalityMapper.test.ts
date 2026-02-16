/**
 * Tests for ShapesPersonalityMapper
 */

import { describe, it, expect, vi } from 'vitest';
import { mapShapesConfigToPersonality } from './ShapesPersonalityMapper.js';
import type { ShapesIncPersonalityConfig } from '@tzurot/common-types';

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
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

function createSampleConfig(
  overrides: Partial<ShapesIncPersonalityConfig> = {}
): ShapesIncPersonalityConfig {
  return {
    id: 'shape-uuid-123',
    name: 'Test Shape',
    username: 'test-shape',
    avatar: 'https://example.com/avatar.png',
    jailbreak: 'You are a mysterious test character.',
    user_prompt: 'Talk in a mysterious way.',
    personality_traits: 'mysterious, thoughtful',
    engine_model: 'openai/gpt-4o',
    engine_temperature: 0.8,
    stm_window: 15,
    ltm_enabled: true,
    ltm_threshold: 0.4,
    ltm_max_retrieved_summaries: 8,
    ...overrides,
  };
}

describe('mapShapesConfigToPersonality', () => {
  describe('system prompt mapping', () => {
    it('should map jailbreak to system prompt content', () => {
      const config = createSampleConfig({ jailbreak: 'Custom system prompt here.' });
      const result = mapShapesConfigToPersonality(config, 'test-slug');

      expect(result.systemPrompt.content).toBe('Custom system prompt here.');
      expect(result.systemPrompt.name).toBe('shapes-import-test-slug');
    });

    it('should provide fallback when jailbreak is empty', () => {
      const config = createSampleConfig({ jailbreak: '' });
      const result = mapShapesConfigToPersonality(config, 'test-slug');

      expect(result.systemPrompt.content).toBe('You are Test Shape.');
    });
  });

  describe('personality mapping', () => {
    it('should map basic personality fields', () => {
      const config = createSampleConfig();
      const result = mapShapesConfigToPersonality(config, 'test-slug');

      expect(result.personality.name).toBe('Test Shape');
      expect(result.personality.slug).toBe('test-slug');
      expect(result.personality.characterInfo).toBe('Talk in a mysterious way.');
      expect(result.personality.personalityTraits).toBe('mysterious, thoughtful');
    });

    it('should map optional personality fields', () => {
      const config = createSampleConfig({
        personality_tone: 'sarcastic',
        personality_age: '25',
        personality_appearance: 'tall and dark',
        personality_likes: 'cats',
        personality_dislikes: 'dogs',
        personality_conversational_goals: 'be helpful',
        personality_conversational_examples: 'User: hi\nBot: hello',
        error_message: 'Oops!',
      });
      const result = mapShapesConfigToPersonality(config, 'test-slug');

      expect(result.personality.personalityTone).toBe('sarcastic');
      expect(result.personality.personalityAge).toBe('25');
      expect(result.personality.personalityAppearance).toBe('tall and dark');
      expect(result.personality.personalityLikes).toBe('cats');
      expect(result.personality.personalityDislikes).toBe('dogs');
      expect(result.personality.conversationalGoals).toBe('be helpful');
      expect(result.personality.conversationalExamples).toBe('User: hi\nBot: hello');
      expect(result.personality.errorMessage).toBe('Oops!');
    });

    it('should map undefined/empty optional fields to null', () => {
      const config = createSampleConfig({
        personality_tone: undefined,
        personality_age: '',
      });
      const result = mapShapesConfigToPersonality(config, 'test-slug');

      expect(result.personality.personalityTone).toBeNull();
      expect(result.personality.personalityAge).toBeNull();
    });

    it('should collect custom fields', () => {
      const config = createSampleConfig({
        keywords: ['magic', 'dark'],
        favorite_reacts: ['🖤', '✨'],
        search_description: 'A test character',
        personality_history: 'Born in a test suite.',
      });
      const result = mapShapesConfigToPersonality(config, 'test-slug');

      expect(result.personality.customFields).not.toBeNull();
      expect(result.personality.customFields?.keywords).toEqual(['magic', 'dark']);
      expect(result.personality.customFields?.favoriteReacts).toEqual(['🖤', '✨']);
      expect(result.personality.customFields?.searchDescription).toBe('A test character');
      expect(result.personality.customFields?.personalityHistory).toBe('Born in a test suite.');
    });

    it('should track import source in custom fields', () => {
      const config = createSampleConfig();
      const result = mapShapesConfigToPersonality(config, 'test-slug');

      expect(result.personality.customFields?.importSource).toBe('shapes_inc');
      expect(result.personality.customFields?.shapesUsername).toBe('test-shape');
      expect(result.personality.customFields?.shapesId).toBe('shape-uuid-123');
    });
  });

  describe('LLM config mapping', () => {
    it('should map engine model', () => {
      const config = createSampleConfig({ engine_model: 'anthropic/claude-sonnet-4' });
      const result = mapShapesConfigToPersonality(config, 'test-slug');

      expect(result.llmConfig.model).toBe('anthropic/claude-sonnet-4');
      expect(result.llmConfig.provider).toBe('openrouter');
    });

    it('should map engine parameters to advancedParameters', () => {
      const config = createSampleConfig({
        engine_temperature: 0.9,
        engine_top_p: 0.95,
        engine_frequency_penalty: 0.3,
      });
      const result = mapShapesConfigToPersonality(config, 'test-slug');

      expect(result.llmConfig.advancedParameters).toEqual(
        expect.objectContaining({
          temperature: 0.9,
          top_p: 0.95,
          frequency_penalty: 0.3,
        })
      );
    });

    it('should map memory settings', () => {
      const config = createSampleConfig({
        ltm_max_retrieved_summaries: 10,
        ltm_threshold: 0.5,
        stm_window: 25,
      });
      const result = mapShapesConfigToPersonality(config, 'test-slug');

      expect(result.llmConfig.memoryLimit).toBe(10);
      expect(result.llmConfig.memoryScoreThreshold).toBe(0.5);
      expect(result.llmConfig.maxMessages).toBe(25);
    });

    it('should use defaults for missing engine model', () => {
      const config = createSampleConfig({ engine_model: '' });
      const result = mapShapesConfigToPersonality(config, 'test-slug');

      expect(result.llmConfig.model).toBe('openai/gpt-4o');
    });
  });

  describe('deterministic UUIDs', () => {
    it('should generate consistent IDs for the same slug', () => {
      const config = createSampleConfig();
      const result1 = mapShapesConfigToPersonality(config, 'test-slug');
      const result2 = mapShapesConfigToPersonality(config, 'test-slug');

      expect(result1.personality.id).toBe(result2.personality.id);
      expect(result1.systemPrompt.id).toBe(result2.systemPrompt.id);
      expect(result1.llmConfig.id).toBe(result2.llmConfig.id);
    });

    it('should generate different IDs for different slugs', () => {
      const config = createSampleConfig();
      const result1 = mapShapesConfigToPersonality(config, 'slug-a');
      const result2 = mapShapesConfigToPersonality(config, 'slug-b');

      expect(result1.personality.id).not.toBe(result2.personality.id);
    });
  });
});
