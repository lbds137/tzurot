import { describe, it, expect } from 'vitest';
import { MessageRole } from '../constants/message.js';
import {
  normalizeRole,
  isRoleMatch,
  normalizeTimestamp,
  extractTimestampMs,
  normalizeConversationMessage,
  normalizeConversationHistory,
  type LooseConversationMessage,
} from './messageNormalization.js';

describe('messageNormalization', () => {
  describe('normalizeRole', () => {
    it('should normalize lowercase roles', () => {
      expect(normalizeRole('user')).toBe(MessageRole.User);
      expect(normalizeRole('assistant')).toBe(MessageRole.Assistant);
      expect(normalizeRole('system')).toBe(MessageRole.System);
    });

    it('should normalize uppercase roles (legacy format)', () => {
      expect(normalizeRole('User')).toBe(MessageRole.User);
      expect(normalizeRole('Assistant')).toBe(MessageRole.Assistant);
      expect(normalizeRole('System')).toBe(MessageRole.System);
    });

    it('should normalize all-caps roles', () => {
      expect(normalizeRole('USER')).toBe(MessageRole.User);
      expect(normalizeRole('ASSISTANT')).toBe(MessageRole.Assistant);
      expect(normalizeRole('SYSTEM')).toBe(MessageRole.System);
    });

    it('should normalize mixed case roles', () => {
      expect(normalizeRole('uSeR')).toBe(MessageRole.User);
      expect(normalizeRole('AsSiStAnT')).toBe(MessageRole.Assistant);
    });

    it('should throw for invalid roles', () => {
      expect(() => normalizeRole('invalid')).toThrow('Invalid message role');
      expect(() => normalizeRole('')).toThrow('Invalid message role');
      expect(() => normalizeRole('bot')).toThrow('Invalid message role');
    });
  });

  describe('isRoleMatch', () => {
    it('should match exact lowercase roles', () => {
      expect(isRoleMatch('user', MessageRole.User)).toBe(true);
      expect(isRoleMatch('assistant', MessageRole.Assistant)).toBe(true);
      expect(isRoleMatch('system', MessageRole.System)).toBe(true);
    });

    it('should match legacy capitalized roles', () => {
      expect(isRoleMatch('User', MessageRole.User)).toBe(true);
      expect(isRoleMatch('Assistant', MessageRole.Assistant)).toBe(true);
      expect(isRoleMatch('System', MessageRole.System)).toBe(true);
    });

    it('should match MessageRole enum values', () => {
      expect(isRoleMatch(MessageRole.User, MessageRole.User)).toBe(true);
      expect(isRoleMatch(MessageRole.Assistant, MessageRole.Assistant)).toBe(true);
    });

    it('should not match different roles', () => {
      expect(isRoleMatch('user', MessageRole.Assistant)).toBe(false);
      expect(isRoleMatch('assistant', MessageRole.User)).toBe(false);
      expect(isRoleMatch('User', MessageRole.System)).toBe(false);
    });
  });

  describe('normalizeTimestamp', () => {
    it('should return ISO string unchanged', () => {
      const isoString = '2024-01-15T10:30:00.000Z';
      expect(normalizeTimestamp(isoString)).toBe(isoString);
    });

    it('should convert Date object to ISO string', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      expect(normalizeTimestamp(date)).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should return undefined for null', () => {
      expect(normalizeTimestamp(null)).toBeUndefined();
    });

    it('should return undefined for undefined', () => {
      expect(normalizeTimestamp(undefined)).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      expect(normalizeTimestamp('')).toBeUndefined();
    });

    it('should return undefined for invalid date string', () => {
      expect(normalizeTimestamp('not-a-date')).toBeUndefined();
    });

    it('should handle Invalid Date objects', () => {
      expect(normalizeTimestamp(new Date('invalid'))).toBeUndefined();
    });
  });

  describe('extractTimestampMs', () => {
    it('should extract milliseconds from Date object', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const result = extractTimestampMs(date);
      expect(result).toBe(date.getTime());
    });

    it('should extract milliseconds from ISO string', () => {
      const isoString = '2024-01-15T10:30:00.000Z';
      const result = extractTimestampMs(isoString);
      expect(result).toBe(new Date(isoString).getTime());
    });

    it('should return null for null', () => {
      expect(extractTimestampMs(null)).toBeNull();
    });

    it('should return null for undefined', () => {
      expect(extractTimestampMs(undefined)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(extractTimestampMs('')).toBeNull();
    });

    it('should return null for invalid date string', () => {
      expect(extractTimestampMs('not-a-date')).toBeNull();
    });

    it('should return null for Invalid Date objects', () => {
      expect(extractTimestampMs(new Date('invalid'))).toBeNull();
    });
  });

  describe('normalizeConversationMessage', () => {
    it('should normalize a message with capitalized role', () => {
      const msg: LooseConversationMessage = {
        role: 'User',
        content: 'Hello',
      };

      const result = normalizeConversationMessage(msg);

      expect(result.role).toBe('user');
      expect(result.content).toBe('Hello');
    });

    it('should normalize a message with Date createdAt', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const msg: LooseConversationMessage = {
        role: 'user',
        content: 'Hello',
        createdAt: date,
      };

      const result = normalizeConversationMessage(msg);

      expect(result.createdAt).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should preserve all other fields', () => {
      const msg: LooseConversationMessage = {
        id: 'msg-123',
        role: 'Assistant',
        content: 'Hi there!',
        tokenCount: 5,
        createdAt: '2024-01-15T10:30:00.000Z',
        personaId: 'persona-456',
        personaName: 'Alice',
        discordUsername: 'alice123',
        messageMetadata: { key: 'value' },
      };

      const result = normalizeConversationMessage(msg);

      expect(result).toEqual({
        id: 'msg-123',
        role: 'assistant',
        content: 'Hi there!',
        tokenCount: 5,
        createdAt: '2024-01-15T10:30:00.000Z',
        personaId: 'persona-456',
        personaName: 'Alice',
        discordUsername: 'alice123',
        messageMetadata: { key: 'value' },
      });
    });

    it('should handle undefined createdAt', () => {
      const msg: LooseConversationMessage = {
        role: 'user',
        content: 'Hello',
      };

      const result = normalizeConversationMessage(msg);

      expect(result.createdAt).toBeUndefined();
    });

    it('should throw for invalid role', () => {
      const msg: LooseConversationMessage = {
        role: 'invalid',
        content: 'Hello',
      };

      expect(() => normalizeConversationMessage(msg)).toThrow('Invalid message role');
    });
  });

  describe('normalizeConversationHistory', () => {
    it('should normalize an array of messages', () => {
      const messages: LooseConversationMessage[] = [
        { role: 'User', content: 'Hello' },
        { role: 'Assistant', content: 'Hi!' },
        { role: 'user', content: 'How are you?' },
      ];

      const result = normalizeConversationHistory(messages);

      expect(result).toHaveLength(3);
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('assistant');
      expect(result[2].role).toBe('user');
    });

    it('should handle empty array', () => {
      const result = normalizeConversationHistory([]);
      expect(result).toEqual([]);
    });

    it('should normalize mixed Date and string timestamps', () => {
      const messages: LooseConversationMessage[] = [
        { role: 'user', content: 'A', createdAt: new Date('2024-01-15T10:00:00Z') },
        { role: 'assistant', content: 'B', createdAt: '2024-01-15T10:01:00Z' },
        { role: 'user', content: 'C' },
      ];

      const result = normalizeConversationHistory(messages);

      expect(result[0].createdAt).toBe('2024-01-15T10:00:00.000Z');
      expect(result[1].createdAt).toBe('2024-01-15T10:01:00Z');
      expect(result[2].createdAt).toBeUndefined();
    });

    it('should throw on first invalid role', () => {
      const messages: LooseConversationMessage[] = [
        { role: 'user', content: 'Valid' },
        { role: 'invalid', content: 'Invalid' },
        { role: 'assistant', content: 'Never reached' },
      ];

      expect(() => normalizeConversationHistory(messages)).toThrow('Invalid message role');
    });
  });
});
