/**
 * Schema Validation Tests
 *
 * These tests prevent schema drift bugs by ensuring:
 * 1. All expected fields pass validation
 * 2. Fields aren't accidentally stripped during validation
 * 3. The inferred TypeScript types match expectations
 */

import { describe, it, expect } from 'vitest';
import {
  loadedPersonalitySchema,
  generateRequestSchema,
  apiConversationMessageSchema,
} from './schemas/index.js';
import { MessageRole } from '../constants/index.js';

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

describe('apiConversationMessageSchema', () => {
  /**
   * CRITICAL: This test prevents schema drift for conversation history fields.
   * When adding fields to ConversationMessage or the bot-client's history builder,
   * add them here AND to the schema to ensure they survive API validation.
   *
   * Bug reference: isForwarded was missing from schema, causing forwarded messages
   * in extended context to lose their forwarded="true" attribute in the prompt XML.
   */
  it('should preserve all conversation message fields through validation', () => {
    // Simulate what MessageContextBuilder sends through the API
    const messageWithAllFields = {
      id: 'msg-123',
      role: MessageRole.User,
      content: 'Hello world',
      createdAt: '2026-02-04T12:00:00.000Z',
      tokenCount: 42,
      personaId: 'persona-123',
      personaName: 'TestUser',
      discordUsername: 'testuser#1234',
      discordMessageId: ['discord-msg-1', 'discord-msg-2'],
      isForwarded: true, // CRITICAL: Must not be stripped
      messageMetadata: {
        referencedMessages: [],
        imageDescriptions: [{ filename: 'test.png', description: 'A test image' }],
      },
      personalityId: 'personality-123',
      personalityName: 'TestBot',
    };

    const result = apiConversationMessageSchema.safeParse(messageWithAllFields);
    expect(result.success).toBe(true);

    if (result.success) {
      // CRITICAL FIELD CHECKS - add new fields here when extending the schema
      expect(result.data.id).toBe('msg-123');
      expect(result.data.role).toBe(MessageRole.User);
      expect(result.data.content).toBe('Hello world');
      expect(result.data.createdAt).toBe('2026-02-04T12:00:00.000Z');
      expect(result.data.tokenCount).toBe(42);
      expect(result.data.personaId).toBe('persona-123');
      expect(result.data.personaName).toBe('TestUser');
      expect(result.data.discordUsername).toBe('testuser#1234');
      expect(result.data.discordMessageId).toEqual(['discord-msg-1', 'discord-msg-2']);
      expect(result.data.isForwarded).toBe(true); // Regression test for schema drift bug
      expect(result.data.messageMetadata).toBeDefined();
      expect(result.data.personalityId).toBe('personality-123');
      expect(result.data.personalityName).toBe('TestBot');
    }
  });

  it('should NOT strip isForwarded field (regression test for forwarded message bug)', () => {
    const forwardedMessage = {
      role: MessageRole.User,
      content: 'This was forwarded',
      isForwarded: true,
    };

    const result = apiConversationMessageSchema.safeParse(forwardedMessage);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.isForwarded).toBe(true);
      expect(result.data).toHaveProperty('isForwarded');
    }
  });

  it('should allow isForwarded to be false or undefined', () => {
    const notForwarded = {
      role: MessageRole.User,
      content: 'Regular message',
      isForwarded: false,
    };

    const result1 = apiConversationMessageSchema.safeParse(notForwarded);
    expect(result1.success).toBe(true);
    if (result1.success) {
      expect(result1.data.isForwarded).toBe(false);
    }

    const noForwardedField = {
      role: MessageRole.User,
      content: 'Regular message',
    };

    const result2 = apiConversationMessageSchema.safeParse(noForwardedField);
    expect(result2.success).toBe(true);
    if (result2.success) {
      expect(result2.data.isForwarded).toBeUndefined();
    }
  });

  /**
   * CRITICAL: This test ensures reactions in messageMetadata survive schema validation.
   * Reactions are added by extended context processing and must flow through to ai-worker.
   */
  it('should NOT strip reactions from messageMetadata (regression test for reactions bug)', () => {
    const messageWithReactions = {
      role: MessageRole.User,
      content: 'Great news everyone!',
      messageMetadata: {
        reactions: [
          {
            emoji: '👍',
            isCustom: false,
            reactors: [
              { personaId: 'discord:user1', displayName: 'Alice' },
              { personaId: 'discord:user2', displayName: 'Bob' },
            ],
          },
          {
            emoji: ':pepe:',
            isCustom: true,
            reactors: [{ personaId: 'discord:user3', displayName: 'Carol' }],
          },
        ],
      },
    };

    const result = apiConversationMessageSchema.safeParse(messageWithReactions);
    expect(result.success).toBe(true);

    if (result.success) {
      // messageMetadata should be preserved
      expect(result.data.messageMetadata).toBeDefined();

      // Reactions should survive z.record(z.string(), z.unknown()) validation
      const metadata = result.data.messageMetadata as Record<string, unknown>;
      expect(metadata.reactions).toBeDefined();

      // Verify structure is preserved (not just existence)
      const reactions = metadata.reactions as Array<{
        emoji: string;
        isCustom?: boolean;
        reactors: Array<{ personaId: string; displayName: string }>;
      }>;
      expect(reactions).toHaveLength(2);
      expect(reactions[0].emoji).toBe('👍');
      expect(reactions[0].reactors).toHaveLength(2);
      expect(reactions[0].reactors[0].displayName).toBe('Alice');
      expect(reactions[1].emoji).toBe(':pepe:');
      expect(reactions[1].isCustom).toBe(true);
    }
  });

  it('should preserve other messageMetadata fields alongside reactions', () => {
    const messageWithMixedMetadata = {
      role: MessageRole.User,
      content: 'Check this out',
      messageMetadata: {
        referencedMessages: [
          {
            discordMessageId: 'ref-123',
            authorUsername: 'testuser',
            authorDisplayName: 'Test User',
            content: 'Original message',
            embeds: '',
            timestamp: '2026-02-04T10:00:00.000Z',
            locationContext: 'Server > Channel',
          },
        ],
        reactions: [
          {
            emoji: '❤️',
            reactors: [{ personaId: 'discord:user1', displayName: 'Alice' }],
          },
        ],
        embedsXml: ['<embed title="Test"/>'],
        voiceTranscripts: ['Hello from voice'],
      },
    };

    const result = apiConversationMessageSchema.safeParse(messageWithMixedMetadata);
    expect(result.success).toBe(true);

    if (result.success) {
      const metadata = result.data.messageMetadata as Record<string, unknown>;

      // All fields should be preserved
      expect(metadata.referencedMessages).toBeDefined();
      expect(metadata.reactions).toBeDefined();
      expect(metadata.embedsXml).toBeDefined();
      expect(metadata.voiceTranscripts).toBeDefined();

      // Verify reactions specifically
      const reactions = metadata.reactions as Array<{
        emoji: string;
        reactors: Array<{ personaId: string; displayName: string }>;
      }>;
      expect(reactions).toHaveLength(1);
      expect(reactions[0].emoji).toBe('❤️');
    }
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
