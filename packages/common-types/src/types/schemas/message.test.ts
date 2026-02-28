/**
 * Message Schema Tests
 *
 * Validates Zod schemas for conversation messages and cross-channel history types.
 */

import { describe, it, expect } from 'vitest';
import { MessageRole } from '../../constants/index.js';
import {
  crossChannelMessageSchema,
  crossChannelHistoryGroupSchema,
  type CrossChannelMessage,
  type CrossChannelHistoryGroupEntry,
} from './message.js';

describe('crossChannelMessageSchema', () => {
  it('should accept a valid message with all fields', () => {
    const msg: CrossChannelMessage = {
      id: 'msg-1',
      role: MessageRole.User,
      content: 'Hello from another channel',
      tokenCount: 10,
      createdAt: '2026-02-26T10:00:00.000Z',
      personaId: 'persona-1',
      personaName: 'Alice',
      discordUsername: 'alice#1234',
      personalityId: 'pers-1',
      personalityName: 'TestBot',
    };

    const result = crossChannelMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it('should accept a minimal message with only required fields', () => {
    const msg = {
      role: MessageRole.Assistant,
      content: 'Response',
    };

    const result = crossChannelMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBeUndefined();
      expect(result.data.tokenCount).toBeUndefined();
      expect(result.data.createdAt).toBeUndefined();
      expect(result.data.personaId).toBeUndefined();
      expect(result.data.personaName).toBeUndefined();
      expect(result.data.discordUsername).toBeUndefined();
      expect(result.data.personalityId).toBeUndefined();
      expect(result.data.personalityName).toBeUndefined();
    }
  });

  it('should reject invalid role value', () => {
    const msg = {
      role: 'invalid-role',
      content: 'Hello',
    };

    const result = crossChannelMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('should reject missing content', () => {
    const msg = {
      role: MessageRole.User,
    };

    const result = crossChannelMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it('should reject missing role', () => {
    const msg = {
      content: 'Hello',
    };

    const result = crossChannelMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });
});

describe('crossChannelHistoryGroupSchema', () => {
  it('should accept a valid guild group', () => {
    const group: CrossChannelHistoryGroupEntry = {
      channelEnvironment: {
        type: 'guild',
        guild: { id: 'g-1', name: 'Test Server' },
        channel: { id: 'ch-1', name: 'general', type: 'text' },
      },
      messages: [
        { role: MessageRole.User, content: 'Hello', personaName: 'Alice' },
        { role: MessageRole.Assistant, content: 'Hi there' },
      ],
    };

    const result = crossChannelHistoryGroupSchema.safeParse(group);
    expect(result.success).toBe(true);
  });

  it('should accept a valid DM group', () => {
    const group: CrossChannelHistoryGroupEntry = {
      channelEnvironment: {
        type: 'dm',
        channel: { id: 'dm-1', name: 'Direct Message', type: 'dm' },
      },
      messages: [{ role: MessageRole.User, content: 'DM message' }],
    };

    const result = crossChannelHistoryGroupSchema.safeParse(group);
    expect(result.success).toBe(true);
  });

  it('should reject invalid channelEnvironment type', () => {
    const group = {
      channelEnvironment: {
        type: 'invalid',
        channel: { id: 'ch-1', name: 'test', type: 'text' },
      },
      messages: [{ role: MessageRole.User, content: 'Hello' }],
    };

    const result = crossChannelHistoryGroupSchema.safeParse(group);
    expect(result.success).toBe(false);
  });

  it('should reject missing channel in environment', () => {
    const group = {
      channelEnvironment: { type: 'guild' },
      messages: [{ role: MessageRole.User, content: 'Hello' }],
    };

    const result = crossChannelHistoryGroupSchema.safeParse(group);
    expect(result.success).toBe(false);
  });

  it('should accept group with empty messages array', () => {
    const group = {
      channelEnvironment: {
        type: 'dm',
        channel: { id: 'dm-1', name: 'DM', type: 'dm' },
      },
      messages: [],
    };

    const result = crossChannelHistoryGroupSchema.safeParse(group);
    expect(result.success).toBe(true);
  });

  it('should reject when messages contain invalid role', () => {
    const group = {
      channelEnvironment: {
        type: 'dm',
        channel: { id: 'dm-1', name: 'DM', type: 'dm' },
      },
      messages: [{ role: 'invalid', content: 'Hello' }],
    };

    const result = crossChannelHistoryGroupSchema.safeParse(group);
    expect(result.success).toBe(false);
  });

  it('should accept guild environment with optional thread and category', () => {
    const group = {
      channelEnvironment: {
        type: 'guild',
        guild: { id: 'g-1', name: 'Server' },
        category: { id: 'cat-1', name: 'General' },
        channel: { id: 'ch-1', name: 'general', type: 'text' },
        thread: {
          id: 'thread-1',
          name: 'My Thread',
          parentChannel: { id: 'ch-1', name: 'general', type: 'text' },
        },
      },
      messages: [{ role: MessageRole.User, content: 'Thread message' }],
    };

    const result = crossChannelHistoryGroupSchema.safeParse(group);
    expect(result.success).toBe(true);
  });
});
