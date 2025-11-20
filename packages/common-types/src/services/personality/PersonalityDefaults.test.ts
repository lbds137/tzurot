/**
 * PersonalityDefaults Unit Tests
 * Tests placeholder replacement and config merging logic
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { replacePlaceholders, deriveAvatarUrl, mapToPersonality } from './PersonalityDefaults.js';
import type { DatabasePersonality, LlmConfig } from './PersonalityValidator.js';

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

    beforeEach(() => {
      vi.resetModules();
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
      vi.clearAllMocks();
    });

    it('should derive avatar URL from PUBLIC_GATEWAY_URL', () => {
      process.env.PUBLIC_GATEWAY_URL = 'https://public.example.com';
      const result = deriveAvatarUrl('test-bot', mockLogger);
      expect(result).toBe('https://public.example.com/avatars/test-bot.png');
    });

    it('should fallback to GATEWAY_URL if PUBLIC_GATEWAY_URL not set', () => {
      delete process.env.PUBLIC_GATEWAY_URL;
      process.env.GATEWAY_URL = 'http://localhost:3000';
      const result = deriveAvatarUrl('test-bot', mockLogger);
      expect(result).toBe('http://localhost:3000/avatars/test-bot.png');
    });

    it('should return undefined and log warning if no URL configured', () => {
      delete process.env.PUBLIC_GATEWAY_URL;
      delete process.env.GATEWAY_URL;
      const result = deriveAvatarUrl('test-bot', mockLogger);
      expect(result).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('mapToPersonality', () => {
    const mockLogger = {
      warn: vi.fn(),
    };

    beforeEach(() => {
      process.env.GATEWAY_URL = 'http://localhost:3000';
      vi.clearAllMocks();
    });

    it('should map database personality with personality-specific config', () => {
      const dbPersonality: DatabasePersonality = {
        id: 'test-id',
        name: 'TestBot',
        displayName: 'Test Bot',
        slug: 'test-bot',
        systemPrompt: {
          content: 'You are a helpful assistant named {assistant}',
        },
        defaultConfigLink: {
          llmConfig: {
            model: 'anthropic/claude-sonnet-4.5',
            visionModel: 'anthropic/claude-sonnet-4.5',
            temperature: 0.7 as any,
            topP: null,
            topK: null,
            frequencyPenalty: null,
            presencePenalty: null,
            maxTokens: 4096,
            memoryScoreThreshold: 0.7 as any,
            memoryLimit: 10,
            contextWindowTokens: 200000,
          },
        },
        characterInfo: 'A helpful AI assistant',
        personalityTraits: 'Friendly and knowledgeable',
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
      };

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
      expect(result.avatarUrl).toBe('http://localhost:3000/avatars/test-bot.png');
    });

    it('should use global default config when personality has no specific config', () => {
      const dbPersonality: DatabasePersonality = {
        id: 'test-id',
        name: 'TestBot',
        displayName: null,
        slug: 'test-bot',
        systemPrompt: null,
        defaultConfigLink: null,
        characterInfo: 'A helpful AI assistant',
        personalityTraits: 'Friendly',
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
      };

      const globalConfig: LlmConfig = {
        model: 'global-model',
        visionModel: 'global-vision-model',
        temperature: 0.8,
        maxTokens: 2048,
        topP: undefined,
        topK: undefined,
        frequencyPenalty: undefined,
        presencePenalty: undefined,
        memoryScoreThreshold: 0.6,
        memoryLimit: 20,
        contextWindowTokens: 100000,
      };

      const result = mapToPersonality(dbPersonality, globalConfig, mockLogger);

      expect(result.model).toBe('global-model');
      expect(result.visionModel).toBe('global-vision-model');
      expect(result.temperature).toBe(0.8);
      expect(result.maxTokens).toBe(2048);
      expect(result.displayName).toBe('TestBot'); // Falls back to name
    });

    it('should replace placeholders in all character fields', () => {
      const dbPersonality: DatabasePersonality = {
        id: 'test-id',
        name: 'TestBot',
        displayName: null,
        slug: 'test-bot',
        systemPrompt: {
          content: 'I am {assistant}',
        },
        defaultConfigLink: null,
        characterInfo: '{assistant} is helpful',
        personalityTraits: '{assistant} is friendly',
        personalityTone: '{assistant} speaks casually',
        personalityAge: '{assistant} is ageless',
        personalityAppearance: '{assistant} has a blue avatar',
        personalityLikes: '{assistant} likes coding',
        personalityDislikes: '{assistant} dislikes bugs',
        conversationalGoals: 'Help {{user}} learn',
        conversationalExamples: '{assistant}: How can I help?',
      };

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
  });
});
