/**
 * Tests for audio message handling in aiMessageFormatter
 */

jest.mock('../../../src/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../../src/utils/aliasResolver', () => ({
  resolvePersonality: jest.fn(),
}));

jest.mock('../../../src/utils/contextMetadataFormatter', () => ({
  formatContextMetadata: jest.fn(() => '[Test Server | #test-channel | 2025-01-01T00:00:00.000Z]'),
}));

const { formatApiMessages } = require('../../../src/utils/aiMessageFormatter');
const { resolvePersonality } = require('../../../src/utils/aliasResolver');

describe('aiMessageFormatter - Audio Message Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('formatApiMessages with audio references', () => {
    it('should handle direct audio URL in referenced message', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'What is this audio?',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Listen to this',
          author: 'AudioUser',
          audioUrl: 'https://example.com/audio.mp3',
          isFromBot: false,
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      expect(result).toBeDefined();
      expect(result[0].role).toBe('user');
      
      // Should include audio_url in content
      const audioElement = result[0].content.find(item => item.type === 'audio_url');
      expect(audioElement).toBeDefined();
      expect(audioElement.audio_url.url).toBe('https://example.com/audio.mp3');
      
      // Should include text mentioning audio
      const textElement = result[0].content.find(item => item.type === 'text');
      expect(textElement.text).toContain('(with audio)');
    });

    it('should extract audio URL from text content', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'What is this?',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Check this out [Audio: https://example.com/sound.mp3]',
          author: 'AudioUser',
          isFromBot: false,
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      expect(result).toBeDefined();
      expect(result[0].role).toBe('user');
      
      // Should extract and include audio URL
      const audioElement = result[0].content.find(item => item.type === 'audio_url');
      expect(audioElement).toBeDefined();
      expect(audioElement.audio_url.url).toBe('https://example.com/sound.mp3');
      
      // Text should not include the [Audio: URL] markup
      const textElement = result[0].content.find(item => item.type === 'text');
      expect(textElement.text).not.toContain('[Audio:');
    });

    it('should add audio placeholder when content is empty after removing URL', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'What did they share?',
        userName: 'TestUser',
        referencedMessage: {
          content: '[Audio: https://example.com/voice.mp3]',
          author: 'AudioUser',
          isFromBot: false,
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textElement = result[0].content.find(item => item.type === 'text');
      expect(textElement.text).toContain('[Audio Message]');
    });

    it('should handle self-reference with audio', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'Did you hear what I said?',
        userName: 'TestUser',
        userId: 'user123',
        referencedMessage: {
          content: 'Listen to this',
          author: 'TestUser',
          authorId: 'user123',
          audioUrl: 'https://example.com/my-audio.mp3',
          isFromBot: false,
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textElement = result[0].content.find(item => item.type === 'text');
      expect(textElement.text).toContain('(with audio I shared)');
      expect(textElement.text).toContain('I said');
    });

    it('should prioritize audio over images when both are present', async () => {
      resolvePersonality.mockResolvedValue(null);

      const content = {
        messageContent: 'What is this?',
        userName: 'TestUser',
        referencedMessage: {
          content: '[Image: https://example.com/pic.jpg] [Audio: https://example.com/sound.mp3]',
          author: 'MediaUser',
          isFromBot: false,
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      // Should only include audio, not image
      const audioElement = result[0].content.find(item => item.type === 'audio_url');
      expect(audioElement).toBeDefined();
      
      const imageElement = result[0].content.find(item => item.type === 'image_url');
      expect(imageElement).toBeUndefined();
      
      const textElement = result[0].content.find(item => item.type === 'text');
      expect(textElement.text).toContain('(with audio)');
      expect(textElement.text).not.toContain('(with an image)');
    });

    it('should handle audio reference from bot personality', async () => {
      resolvePersonality.mockResolvedValue({
        profile: { displayName: 'Music Bot' }
      });

      const content = {
        messageContent: 'What song was that?',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Here is a song for you',
          author: 'bot-user',
          audioUrl: 'https://example.com/song.mp3',
          isFromBot: true,
          personalityName: 'music-bot',
          personalityDisplayName: 'Music Bot',
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textElement = result[0].content.find(item => item.type === 'text');
      expect(textElement.text).toContain('Music Bot (music-bot) said');
      expect(textElement.text).toContain('(with audio)');
    });

    it('should handle audio from same personality (second person)', async () => {
      resolvePersonality.mockResolvedValue({
        profile: { displayName: 'Test Bot' }
      });

      const content = {
        messageContent: 'Play that again',
        userName: 'TestUser',
        referencedMessage: {
          content: 'Here is your audio',
          author: 'bot-user',
          audioUrl: 'https://example.com/audio.mp3',
          isFromBot: true,
          personalityName: 'test-personality',
          personalityDisplayName: 'Test Bot',
        },
      };

      const result = await formatApiMessages(content, 'test-personality');

      const textElement = result[0].content.find(item => item.type === 'text');
      expect(textElement.text).toContain('You said');
      expect(textElement.text).toContain('(with audio)');
    });
  });
});