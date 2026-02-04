/**
 * PersonalityDefaults Unit Tests
 * Tests placeholder replacement and config merging logic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { replacePlaceholders, deriveAvatarUrl, mapToPersonality } from './PersonalityDefaults.js';
import type { DatabasePersonality } from './PersonalityValidator.js';
import type { MappedLlmConfig } from '../LlmConfigMapper.js';

/**
 * Factory function to create a complete DatabasePersonality mock with sensible defaults.
 * Override specific fields as needed in individual tests.
 */
function createMockDatabasePersonality(
  overrides: Partial<DatabasePersonality> = {}
): DatabasePersonality {
  return {
    id: 'test-id',
    name: 'TestBot',
    displayName: null,
    slug: 'test-bot',
    isPublic: true,
    ownerId: 'owner-123',
    updatedAt: new Date('2024-01-21T12:00:00.000Z'),
    extendedContext: null,
    extendedContextMaxMessages: null,
    extendedContextMaxAge: null,
    extendedContextMaxImages: null,
    systemPrompt: null,
    defaultConfigLink: null,
    characterInfo: 'A helpful AI assistant',
    personalityTraits: 'Friendly and knowledgeable',
    personalityTone: null,
    personalityAge: null,
    personalityAppearance: null,
    personalityLikes: null,
    personalityDislikes: null,
    conversationalGoals: null,
    conversationalExamples: null,
    errorMessage: null,
    ...overrides,
  };
}

describe('PersonalityDefaults', () => {
  describe('replacePlaceholders', () => {
    it('should normalize {user} placeholder', () => {
      const result = replacePlaceholders('Hello {user}!', 'TestBot');
      expect(result).toBe('Hello {user}!');
    });

    it('should replace {{user}} with {user}', () => {
      const result = replacePlaceholders('Hello {{user}}!', 'TestBot');
      expect(result).toBe('Hello {user}!');
    });

    it('should replace {assistant} with personality name', () => {
      const result = replacePlaceholders('I am {assistant}', 'TestBot');
      expect(result).toBe('I am TestBot');
    });

    it('should replace {shape} with personality name', () => {
      const result = replacePlaceholders('I am {shape}', 'TestBot');
      expect(result).toBe('I am TestBot');
    });

    it('should replace {{char}} with personality name', () => {
      const result = replacePlaceholders('I am {{char}}', 'TestBot');
      expect(result).toBe('I am TestBot');
    });

    it('should replace {personality} with personality name', () => {
      const result = replacePlaceholders('I am {personality}', 'TestBot');
      expect(result).toBe('I am TestBot');
    });

    it('should handle multiple placeholders', () => {
      const result = replacePlaceholders(
        'Hello {{user}}, I am {assistant}. I am also {shape}.',
        'TestBot'
      );
      expect(result).toBe('Hello {user}, I am TestBot. I am also TestBot.');
    });

    it('should return undefined for null input', () => {
      const result = replacePlaceholders(null, 'TestBot');
      expect(result).toBeUndefined();
    });

    it('should return undefined for undefined input', () => {
      const result = replacePlaceholders(undefined, 'TestBot');
      expect(result).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      const result = replacePlaceholders('', 'TestBot');
      expect(result).toBeUndefined();
    });
  });

  describe('deriveAvatarUrl', () => {
    const originalEnv = process.env;
    const mockLogger = {
      warn: vi.fn(),
    };
    // Fixed timestamp for deterministic tests
    const testDate = new Date('2024-01-21T12:00:00.000Z');
    const expectedTimestamp = testDate.getTime(); // 1705838400000

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
      vi.clearAllMocks();
    });

    it('should derive avatar URL with path-based cache-busting from PUBLIC_GATEWAY_URL', () => {
      process.env.PUBLIC_GATEWAY_URL = 'https://public.example.com';
      const result = deriveAvatarUrl('test-bot', testDate, mockLogger);
      expect(result).toBe(`https://public.example.com/avatars/test-bot-${expectedTimestamp}.png`);
    });

    it('should fallback to GATEWAY_URL if PUBLIC_GATEWAY_URL not set', () => {
      delete process.env.PUBLIC_GATEWAY_URL;
      process.env.GATEWAY_URL = 'http://localhost:3000';
      const result = deriveAvatarUrl('test-bot', testDate, mockLogger);
      expect(result).toBe(`http://localhost:3000/avatars/test-bot-${expectedTimestamp}.png`);
    });

    it('should return undefined and log warning if no URL configured', () => {
      delete process.env.PUBLIC_GATEWAY_URL;
      delete process.env.GATEWAY_URL;
      const result = deriveAvatarUrl('test-bot', testDate, mockLogger);
      expect(result).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should include different timestamps for different update times', () => {
      process.env.PUBLIC_GATEWAY_URL = 'https://example.com';
      const date1 = new Date('2024-01-01T00:00:00.000Z');
      const date2 = new Date('2024-06-15T00:00:00.000Z');

      const result1 = deriveAvatarUrl('cold', date1, mockLogger);
      const result2 = deriveAvatarUrl('cold', date2, mockLogger);

      expect(result1).not.toBe(result2);
      expect(result1).toContain(`cold-${date1.getTime()}.png`);
      expect(result2).toContain(`cold-${date2.getTime()}.png`);
    });
  });

  describe('mapToPersonality', () => {
    const mockLogger = {
      warn: vi.fn(),
    };
    // Fixed timestamp for deterministic tests
    const testDate = new Date('2024-01-21T12:00:00.000Z');
    const expectedTimestamp = testDate.getTime();

    beforeEach(() => {
      process.env.GATEWAY_URL = 'http://localhost:3000';
      vi.clearAllMocks();
    });

    it('should map database personality with personality-specific config', () => {
      const dbPersonality = createMockDatabasePersonality({
        displayName: 'Test Bot',
        updatedAt: testDate,
        systemPrompt: {
          content: 'You are a helpful assistant named {assistant}',
        },
        defaultConfigLink: {
          llmConfig: {
            model: 'anthropic/claude-sonnet-4.5',
            visionModel: 'anthropic/claude-sonnet-4.5',
            advancedParameters: {
              temperature: 0.7,
              max_tokens: 4096,
            },
            memoryScoreThreshold: { toNumber: () => 0.7 } as never,
            memoryLimit: 10,
            contextWindowTokens: 200000,
            maxMessages: 50,
            maxAge: null,
            maxImages: 10,
          },
        },
      });

      const result = mapToPersonality(dbPersonality, null, mockLogger);

      expect(result.id).toBe('test-id');
      expect(result.name).toBe('TestBot');
      expect(result.displayName).toBe('Test Bot');
      expect(result.slug).toBe('test-bot');
      expect(result.systemPrompt).toBe('You are a helpful assistant named TestBot');
      expect(result.model).toBe('anthropic/claude-sonnet-4.5');
      expect(result.visionModel).toBe('anthropic/claude-sonnet-4.5');
      expect(result.temperature).toBe(0.7);
      expect(result.maxTokens).toBe(4096);
      // Avatar URL includes path-based cache-busting (timestamp in filename)
      expect(result.avatarUrl).toBe(
        `http://localhost:3000/avatars/test-bot-${expectedTimestamp}.png`
      );
    });

    it('should use global default config when personality has no specific config', () => {
      const dbPersonality = createMockDatabasePersonality({
        updatedAt: testDate,
        personalityTraits: 'Friendly',
      });

      const globalConfig: MappedLlmConfig = {
        model: 'global-model',
        visionModel: 'global-vision-model',
        temperature: 0.8,
        maxTokens: 2048,
        memoryScoreThreshold: 0.6,
        memoryLimit: 20,
        contextWindowTokens: 100000,
        maxMessages: 50,
        maxAge: null,
        maxImages: 10,
      };

      const result = mapToPersonality(dbPersonality, globalConfig, mockLogger);

      expect(result.model).toBe('global-model');
      expect(result.visionModel).toBe('global-vision-model');
      expect(result.temperature).toBe(0.8);
      expect(result.maxTokens).toBe(2048);
      expect(result.displayName).toBe('TestBot'); // Falls back to name
    });

    it('should preserve Unicode displayName with SMP characters', () => {
      // SMP characters like Mathematical Bold Italic are codepoints > U+FFFF
      // They require UTF-16 surrogate pairs in JavaScript
      const unicodeDisplayName = '𝑷𝒆𝒓𝒔𝒆𝒑𝒉𝒐𝒏𝒆 ☠🥀'; // Mathematical Bold Italic + emojis
      const dbPersonality = createMockDatabasePersonality({
        name: 'persephone',
        displayName: unicodeDisplayName,
        slug: 'persephone',
        updatedAt: testDate,
      });

      const result = mapToPersonality(dbPersonality, null, mockLogger);

      // Verify displayName is preserved exactly (not replaced with name)
      expect(result.displayName).toBe(unicodeDisplayName);
      expect(result.displayName).not.toBe('persephone');

      // Verify the SMP characters are preserved (codepoint > U+FFFF means surrogate pairs)
      const firstCodepoint = result.displayName.codePointAt(0);
      expect(firstCodepoint).toBeGreaterThan(0xffff); // SMP character preserved
    });

    it('should fall back to name when displayName is null', () => {
      const dbPersonality = createMockDatabasePersonality({
        name: 'FallbackBot',
        slug: 'fallback-bot',
        updatedAt: testDate,
      });

      const result = mapToPersonality(dbPersonality, null, mockLogger);

      expect(result.displayName).toBe('FallbackBot');
    });

    it('should include reasoning config from personality LlmConfig', () => {
      const dbPersonality = createMockDatabasePersonality({
        name: 'ReasoningBot',
        slug: 'reasoning-bot',
        updatedAt: testDate,
        defaultConfigLink: {
          llmConfig: {
            model: 'deepseek/deepseek-r1',
            visionModel: null,
            advancedParameters: {
              temperature: 0.7,
              top_p: 0.95,
              show_thinking: true,
              reasoning: {
                effort: 'medium',
                enabled: true,
                exclude: false,
              },
            },
            memoryScoreThreshold: { toNumber: () => 0.5 } as never,
            memoryLimit: 10,
            contextWindowTokens: 131072,
            maxMessages: 50,
            maxAge: null,
            maxImages: 10,
          },
        },
      });

      const result = mapToPersonality(dbPersonality, null, mockLogger);

      // CRITICAL: reasoning must flow through to LoadedPersonality
      // This was the root cause of beta.60-62 thinking breakage
      expect(result.reasoning).toBeDefined();
      expect(result.reasoning?.effort).toBe('medium');
      expect(result.reasoning?.enabled).toBe(true);
      expect(result.reasoning?.exclude).toBe(false);
      expect(result.showThinking).toBe(true);
    });

    it('should include reasoning config from global default when personality has none', () => {
      const dbPersonality = createMockDatabasePersonality({
        name: 'NoConfigBot',
        slug: 'no-config-bot',
        updatedAt: testDate,
      });

      const globalConfig: MappedLlmConfig = {
        model: 'global-model',
        visionModel: null,
        temperature: 0.8,
        maxTokens: 2048,
        memoryScoreThreshold: 0.6,
        memoryLimit: 20,
        contextWindowTokens: 100000,
        maxMessages: 50,
        maxAge: null,
        maxImages: 10,
        showThinking: true,
        reasoning: {
          effort: 'high',
          enabled: true,
        },
      };

      const result = mapToPersonality(dbPersonality, globalConfig, mockLogger);

      // Should inherit reasoning from global config
      expect(result.reasoning).toBeDefined();
      expect(result.reasoning?.effort).toBe('high');
      expect(result.showThinking).toBe(true);
    });

    it('should replace placeholders in all character fields', () => {
      const dbPersonality = createMockDatabasePersonality({
        updatedAt: testDate,
        systemPrompt: {
          content: 'I am {assistant}',
        },
        characterInfo: '{assistant} is helpful',
        personalityTraits: '{assistant} is friendly',
        personalityTone: '{assistant} speaks casually',
        personalityAge: '{assistant} is ageless',
        personalityAppearance: '{assistant} has a blue avatar',
        personalityLikes: '{assistant} likes coding',
        personalityDislikes: '{assistant} dislikes bugs',
        conversationalGoals: 'Help {{user}} learn',
        conversationalExamples: '{assistant}: How can I help?',
      });

      const result = mapToPersonality(dbPersonality, null, mockLogger);

      expect(result.systemPrompt).toBe('I am TestBot');
      expect(result.characterInfo).toBe('TestBot is helpful');
      expect(result.personalityTraits).toBe('TestBot is friendly');
      expect(result.personalityTone).toBe('TestBot speaks casually');
      expect(result.personalityAge).toBe('TestBot is ageless');
      expect(result.personalityAppearance).toBe('TestBot has a blue avatar');
      expect(result.personalityLikes).toBe('TestBot likes coding');
      expect(result.personalityDislikes).toBe('TestBot dislikes bugs');
      expect(result.conversationalGoals).toBe('Help {user} learn');
      expect(result.conversationalExamples).toBe('TestBot: How can I help?');
    });

    it('should include context settings from personality LlmConfig', () => {
      const dbPersonality = createMockDatabasePersonality({
        name: 'ContextBot',
        slug: 'context-bot',
        updatedAt: testDate,
        defaultConfigLink: {
          llmConfig: {
            model: 'test-model',
            visionModel: null,
            advancedParameters: {
              temperature: 0.7,
              max_tokens: 4096,
            },
            memoryScoreThreshold: { toNumber: () => 0.5 } as never,
            memoryLimit: 10,
            contextWindowTokens: 131072,
            maxMessages: 25,
            maxAge: 3600,
            maxImages: 5,
          },
        },
      });

      const result = mapToPersonality(dbPersonality, null, mockLogger);

      // Context settings should flow from personality LlmConfig
      expect(result.maxMessages).toBe(25);
      expect(result.maxAge).toBe(3600);
      expect(result.maxImages).toBe(5);
    });

    it('should inherit context settings from global config when not set on personality', () => {
      const dbPersonality = createMockDatabasePersonality({
        name: 'InheritBot',
        slug: 'inherit-bot',
        updatedAt: testDate,
        // No defaultConfigLink - should use global config
      });

      const globalConfig: MappedLlmConfig = {
        model: 'global-model',
        visionModel: null,
        temperature: 0.7,
        maxTokens: 2048,
        memoryScoreThreshold: 0.5,
        memoryLimit: 10,
        contextWindowTokens: 100000,
        maxMessages: 100,
        maxAge: 7200,
        maxImages: 15,
      };

      const result = mapToPersonality(dbPersonality, globalConfig, mockLogger);

      // Should inherit from global config
      expect(result.maxMessages).toBe(100);
      expect(result.maxAge).toBe(7200);
      expect(result.maxImages).toBe(15);
    });

    it('should use undefined for context settings when neither personality nor global config provides them', () => {
      const dbPersonality = createMockDatabasePersonality({
        name: 'DefaultBot',
        slug: 'default-bot',
        updatedAt: testDate,
      });

      const result = mapToPersonality(dbPersonality, null, mockLogger);

      // No config provided - should be undefined
      expect(result.maxMessages).toBeUndefined();
      expect(result.maxAge).toBeUndefined();
      expect(result.maxImages).toBeUndefined();
    });
  });
});
