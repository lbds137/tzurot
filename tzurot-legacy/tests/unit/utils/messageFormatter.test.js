/**
 * Test suite for messageFormatter module
 */

const { EmbedBuilder } = require('discord.js');
const {
  prepareMessageData,
} = require('../../../src/utils/messageFormatter');

// Mock dependencies
jest.mock('../../../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));


describe('messageFormatter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Note: Tests for message splitting functions moved to messageSplitting.test.js

  describe('prepareMessageData', () => {
    it('should prepare basic message data', () => {
      const result = prepareMessageData(
        'Hello world',
        'TestUser',
        'https://example.com/avatar.jpg',
        false,
        null
      );

      expect(result).toEqual({
        content: 'Hello world',
        username: 'TestUser',
        avatarURL: 'https://example.com/avatar.jpg',
        allowedMentions: { parse: ['users', 'roles'] },
      });
    });

    it('should handle thread messages', () => {
      const result = prepareMessageData(
        'Thread message',
        'TestUser',
        'https://example.com/avatar.jpg',
        true,
        'thread123'
      );

      expect(result).toEqual({
        content: 'Thread message',
        username: 'TestUser',
        avatarURL: 'https://example.com/avatar.jpg',
        allowedMentions: { parse: ['users', 'roles'] },
        threadId: 'thread123',
        _isThread: true,
        _originalChannel: undefined,
      });
    });

    it('should include embeds when provided', () => {
      const embed = new EmbedBuilder()
        .setTitle('Test Embed')
        .setDescription('Test Description');

      const result = prepareMessageData(
        'Message with embed',
        'TestUser',
        'https://example.com/avatar.jpg',
        false,
        null,
        { embed }
      );

      expect(result.content).toBe('Message with embed');
      expect(result.username).toBe('TestUser');
      expect(result.avatarURL).toBe('https://example.com/avatar.jpg');
      expect(result.allowedMentions).toEqual({ parse: ['users', 'roles'] });
      expect(result.embeds).toHaveLength(1);
      expect(result.embeds[0]).toBeInstanceOf(EmbedBuilder);
    });

    it('should handle null/undefined values gracefully', () => {
      const result = prepareMessageData(null, null, null, false, null);

      expect(result).toEqual({
        content: null,
        username: null,
        avatarURL: null,
        allowedMentions: { parse: ['users', 'roles'] },
      });
    });

    it('should handle empty username correctly', () => {
      const result = prepareMessageData('Message', '', 'avatar.jpg', false, null);

      expect(result).toEqual({
        content: 'Message',
        username: '',
        avatarURL: 'avatar.jpg',
        allowedMentions: { parse: ['users', 'roles'] },
      });
    });

    it('should not modify username when isError is false', () => {
      const result = prepareMessageData(
        'Normal message',
        'TestUser',
        'https://example.com/avatar.jpg',
        false,
        null
      );

      expect(result.username).toBe('TestUser');
    });
  });
});