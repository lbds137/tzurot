const {
  parseEmbedsToText,
  extractMediaFromEmbeds,
  detectPersonalityInEmbed,
  extractDiscordLinksFromEmbeds,
} = require('../../../src/utils/embedUtils');
const logger = require('../../../src/logger');

// Mock the logger
jest.mock('../../../src/logger');

describe('embedUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseEmbedsToText', () => {
    it('should return empty string for null or empty embeds', () => {
      expect(parseEmbedsToText(null, 'test')).toBe('');
      expect(parseEmbedsToText([], 'test')).toBe('');
      expect(parseEmbedsToText(undefined, 'test')).toBe('');
    });

    it('should parse embed with title only', () => {
      const embeds = [{ title: 'Test Title' }];
      const result = parseEmbedsToText(embeds, 'test source');

      expect(result).toBe('\n[Embed Title: Test Title]');
      expect(logger.info).toHaveBeenCalledWith('[EmbedUtils] test source contains 1 embeds');
    });

    it('should parse embed with description only', () => {
      const embeds = [{ description: 'Test Description' }];
      const result = parseEmbedsToText(embeds, 'test source');

      expect(result).toBe('\n[Embed Description: Test Description]');
    });

    it('should parse embed with fields', () => {
      const embeds = [
        {
          fields: [
            { name: 'Field1', value: 'Value1' },
            { name: 'Field2', value: 'Value2' },
          ],
        },
      ];
      const result = parseEmbedsToText(embeds, 'test source');

      expect(result).toBe('\n[Embed Field - Field1: Value1]\n[Embed Field - Field2: Value2]');
    });

    it('should parse embed with image', () => {
      const embeds = [
        {
          image: { url: 'https://example.com/image.png' },
        },
      ];
      const result = parseEmbedsToText(embeds, 'test source');

      expect(result).toBe('\n[Embed Image: https://example.com/image.png]');
    });

    it('should parse embed with thumbnail', () => {
      const embeds = [
        {
          thumbnail: { url: 'https://example.com/thumb.png' },
        },
      ];
      const result = parseEmbedsToText(embeds, 'test source');

      expect(result).toBe('\n[Embed Thumbnail: https://example.com/thumb.png]');
    });

    it('should parse embed with footer', () => {
      const embeds = [
        {
          footer: { text: 'Footer Text' },
        },
      ];
      const result = parseEmbedsToText(embeds, 'test source');

      expect(result).toBe('\n[Embed Footer: Footer Text]');
    });

    it('should parse complex embed with all fields', () => {
      const embeds = [
        {
          title: 'Complex Embed',
          description: 'This is a complex embed',
          fields: [
            { name: 'Author', value: 'Test User' },
            { name: 'Date', value: '2025-05-23' },
          ],
          image: { url: 'https://example.com/main.png' },
          thumbnail: { url: 'https://example.com/small.png' },
          footer: { text: 'Posted via Discord' },
        },
      ];

      const result = parseEmbedsToText(embeds, 'test source');

      expect(result).toContain('[Embed Title: Complex Embed]');
      expect(result).toContain('[Embed Description: This is a complex embed]');
      expect(result).toContain('[Embed Field - Author: Test User]');
      expect(result).toContain('[Embed Field - Date: 2025-05-23]');
      expect(result).toContain('[Embed Image: https://example.com/main.png]');
      expect(result).toContain('[Embed Thumbnail: https://example.com/small.png]');
      expect(result).toContain('[Embed Footer: Posted via Discord]');
      expect(logger.debug).toHaveBeenCalled();
    });

    it('should handle multiple embeds', () => {
      const embeds = [
        { title: 'First Embed', description: 'First Description' },
        { title: 'Second Embed', description: 'Second Description' },
      ];

      const result = parseEmbedsToText(embeds, 'test source');

      expect(result).toContain('[Embed Title: First Embed]');
      expect(result).toContain('[Embed Description: First Description]');
      expect(result).toContain('[Embed Title: Second Embed]');
      expect(result).toContain('[Embed Description: Second Description]');
      expect(logger.info).toHaveBeenCalledWith('[EmbedUtils] test source contains 2 embeds');
    });

    it('should handle embeds with missing properties gracefully', () => {
      const embeds = [
        {
          title: 'Partial Embed',
          fields: null,
          image: {},
          thumbnail: { url: null },
          footer: {},
        },
      ];

      const result = parseEmbedsToText(embeds, 'test source');

      expect(result).toBe('\n[Embed Title: Partial Embed]');
    });
  });

  describe('extractMediaFromEmbeds', () => {
    it('should return default object for null or empty embeds', () => {
      const expected = {
        audioUrl: null,
        imageUrl: null,
        hasAudio: false,
        hasImage: false,
      };

      expect(extractMediaFromEmbeds(null)).toEqual(expected);
      expect(extractMediaFromEmbeds([])).toEqual(expected);
      expect(extractMediaFromEmbeds(undefined)).toEqual(expected);
    });

    it('should extract audio URL from embed description', () => {
      const embeds = [
        {
          description: 'Check out this song: https://example.com/song.mp3',
        },
      ];

      const result = extractMediaFromEmbeds(embeds);

      expect(result).toEqual({
        audioUrl: 'https://example.com/song.mp3',
        imageUrl: null,
        hasAudio: true,
        hasImage: false,
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[EmbedUtils] Found audio URL in embed description: https://example.com/song.mp3'
      );
    });

    it('should extract audio URLs with different extensions', () => {
      const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a'];

      audioExtensions.forEach(ext => {
        const embeds = [
          {
            description: `Audio file: https://example.com/audio.${ext}`,
          },
        ];

        const result = extractMediaFromEmbeds(embeds);

        expect(result.audioUrl).toBe(`https://example.com/audio.${ext}`);
        expect(result.hasAudio).toBe(true);
      });
    });

    it('should extract audio URL with query parameters', () => {
      const embeds = [
        {
          description: 'Listen: https://example.com/track.mp3?id=123&auth=abc',
        },
      ];

      const result = extractMediaFromEmbeds(embeds);

      expect(result.audioUrl).toBe('https://example.com/track.mp3?id=123&auth=abc');
    });

    it('should extract audio URL from embed fields', () => {
      const embeds = [
        {
          fields: [
            { name: 'Audio', value: 'Listen here: https://example.com/podcast.mp3' },
            { name: 'Description', value: 'A great podcast' },
          ],
        },
      ];

      const result = extractMediaFromEmbeds(embeds);

      expect(result.audioUrl).toBe('https://example.com/podcast.mp3');
      expect(result.hasAudio).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        "[EmbedUtils] Found audio URL in embed field 'Audio': https://example.com/podcast.mp3"
      );
    });

    it('should extract image URL from embed image', () => {
      const embeds = [
        {
          image: { url: 'https://example.com/picture.png' },
        },
      ];

      const result = extractMediaFromEmbeds(embeds);

      expect(result).toEqual({
        audioUrl: null,
        imageUrl: 'https://example.com/picture.png',
        hasAudio: false,
        hasImage: true,
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[EmbedUtils] Found image in embed: https://example.com/picture.png'
      );
    });

    it('should extract image URL from embed thumbnail', () => {
      const embeds = [
        {
          thumbnail: { url: 'https://example.com/thumb.jpg' },
        },
      ];

      const result = extractMediaFromEmbeds(embeds);

      expect(result).toEqual({
        audioUrl: null,
        imageUrl: 'https://example.com/thumb.jpg',
        hasAudio: false,
        hasImage: true,
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[EmbedUtils] Found thumbnail in embed: https://example.com/thumb.jpg'
      );
    });

    it('should prioritize audio over images by default', () => {
      const embeds = [
        {
          description: 'Audio: https://example.com/audio.mp3',
          image: { url: 'https://example.com/image.png' },
        },
      ];

      const result = extractMediaFromEmbeds(embeds);

      expect(result.audioUrl).toBe('https://example.com/audio.mp3');
      expect(result.imageUrl).toBe(null);
      expect(result.hasAudio).toBe(true);
      expect(result.hasImage).toBe(false);
    });

    it('should only extract image when not prioritizing audio', () => {
      const embeds = [
        {
          description: 'Audio: https://example.com/audio.mp3',
          image: { url: 'https://example.com/image.png' },
        },
      ];

      const result = extractMediaFromEmbeds(embeds, false);

      // When prioritizeAudio is false, audio extraction is skipped entirely
      expect(result.audioUrl).toBe(null);
      expect(result.imageUrl).toBe('https://example.com/image.png');
      expect(result.hasAudio).toBe(false);
      expect(result.hasImage).toBe(true);
    });

    it('should extract image when no audio present and not prioritizing audio', () => {
      const embeds = [
        {
          image: { url: 'https://example.com/image.png' },
        },
      ];

      const result = extractMediaFromEmbeds(embeds, false);

      expect(result.audioUrl).toBe(null);
      expect(result.imageUrl).toBe('https://example.com/image.png');
      expect(result.hasAudio).toBe(false);
      expect(result.hasImage).toBe(true);
    });

    it('should handle multiple embeds and return first match', () => {
      const embeds = [
        { description: 'No media here' },
        { description: 'Audio: https://example.com/first.mp3' },
        { description: 'Another: https://example.com/second.mp3' },
      ];

      const result = extractMediaFromEmbeds(embeds);

      expect(result.audioUrl).toBe('https://example.com/first.mp3');
    });

    it('should prefer image over thumbnail', () => {
      const embeds = [
        {
          image: { url: 'https://example.com/main.png' },
          thumbnail: { url: 'https://example.com/thumb.png' },
        },
      ];

      const result = extractMediaFromEmbeds(embeds);

      expect(result.imageUrl).toBe('https://example.com/main.png');
    });

    it('should handle malformed URLs gracefully', () => {
      const embeds = [
        {
          description: 'Not a valid URL: example.com/audio.mp3',
          image: { url: null },
        },
      ];

      const result = extractMediaFromEmbeds(embeds);

      expect(result).toEqual({
        audioUrl: null,
        imageUrl: null,
        hasAudio: false,
        hasImage: false,
      });
    });
  });

  describe('detectPersonalityInEmbed', () => {
    it('should return null for null or undefined embed', () => {
      expect(detectPersonalityInEmbed(null)).toBe(null);
      expect(detectPersonalityInEmbed(undefined)).toBe(null);
    });

    it('should return null for embed without description', () => {
      expect(detectPersonalityInEmbed({})).toBe(null);
      expect(detectPersonalityInEmbed({ title: 'Test' })).toBe(null);
    });

    it('should return null for non-string description', () => {
      expect(detectPersonalityInEmbed({ description: 123 })).toBe(null);
      expect(detectPersonalityInEmbed({ description: {} })).toBe(null);
    });

    it('should detect personality with simple format', () => {
      const embed = {
        description: '**TestBot:** Hello, this is a message!',
      };

      const result = detectPersonalityInEmbed(embed);

      expect(result).toEqual({
        name: 'TestBot',
        displayName: 'TestBot',
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[EmbedUtils] Detected personality in embed with display name: TestBot'
      );
    });

    it('should detect personality with display name format', () => {
      const embed = {
        description: '**Friendly Bot | TestUser:** How are you today?',
      };

      const result = detectPersonalityInEmbed(embed);

      expect(result).toEqual({
        name: 'Friendly Bot',
        displayName: 'Friendly Bot',
      });
    });

    it('should handle names with special characters', () => {
      const embed = {
        description: '**Bot-123_v2:** Processing request...',
      };

      const result = detectPersonalityInEmbed(embed);

      expect(result).toEqual({
        name: 'Bot-123_v2',
        displayName: 'Bot-123_v2',
      });
    });

    it('should not detect personality without proper format', () => {
      const testCases = [
        'Just a regular message',
        'TestBot: Missing asterisks',
        '*TestBot:* Only one asterisk',
        '**TestBot** Missing colon',
        '**TestBot:**Missing space after colon',
        'Text before **TestBot:** the format',
      ];

      testCases.forEach(description => {
        const embed = { description };
        expect(detectPersonalityInEmbed(embed)).toBe(null);
      });
    });

    it('should handle complex display names with multiple pipes', () => {
      const embed = {
        description: '**Bot Name | User1 | User2:** Complex message',
      };

      const result = detectPersonalityInEmbed(embed);

      expect(result).toEqual({
        name: 'Bot Name',
        displayName: 'Bot Name',
      });
    });

    it('should handle empty name gracefully', () => {
      const embed = {
        description: '**:** Empty name?',
      };

      const result = detectPersonalityInEmbed(embed);

      // The regex won't match an empty name between ** and :
      expect(result).toBe(null);
    });
  });

  describe('extractDiscordLinksFromEmbeds', () => {
    it('should return empty array for null or empty embeds', () => {
      expect(extractDiscordLinksFromEmbeds(null)).toEqual([]);
      expect(extractDiscordLinksFromEmbeds([])).toEqual([]);
    });

    it('should extract link from embed description', () => {
      const embeds = [
        {
          description:
            '**[Reply to:](https://discord.com/channels/1234567890/9876543210/1122334455)** Some message content',
        },
      ];

      const result = extractDiscordLinksFromEmbeds(embeds);

      expect(result).toEqual(['https://discord.com/channels/1234567890/9876543210/1122334455']);
    });

    it('should extract link from embed title', () => {
      const embeds = [
        {
          title: 'Check this out: https://discord.com/channels/1234567890/9876543210/1122334455',
        },
      ];

      const result = extractDiscordLinksFromEmbeds(embeds);

      expect(result).toEqual(['https://discord.com/channels/1234567890/9876543210/1122334455']);
    });

    it('should extract link from embed fields', () => {
      const embeds = [
        {
          fields: [
            {
              name: 'Reference',
              value: 'See: https://discord.com/channels/1234567890/9876543210/1122334455',
            },
          ],
        },
      ];

      const result = extractDiscordLinksFromEmbeds(embeds);

      expect(result).toEqual(['https://discord.com/channels/1234567890/9876543210/1122334455']);
    });

    it('should extract link from embed footer', () => {
      const embeds = [
        {
          footer: {
            text: 'Original: https://discord.com/channels/1234567890/9876543210/1122334455',
          },
        },
      ];

      const result = extractDiscordLinksFromEmbeds(embeds);

      expect(result).toEqual(['https://discord.com/channels/1234567890/9876543210/1122334455']);
    });

    it('should handle multiple links and remove duplicates', () => {
      const embeds = [
        {
          description: 'Link 1: https://discord.com/channels/1234567890/9876543210/1122334455',
          fields: [
            {
              name: 'Same link',
              value: 'https://discord.com/channels/1234567890/9876543210/1122334455',
            },
            {
              name: 'Different link',
              value: 'https://discord.com/channels/2222222222/3333333333/4444444444',
            },
          ],
        },
      ];

      const result = extractDiscordLinksFromEmbeds(embeds);

      expect(result).toHaveLength(2);
      expect(result).toContain('https://discord.com/channels/1234567890/9876543210/1122334455');
      expect(result).toContain('https://discord.com/channels/2222222222/3333333333/4444444444');
    });

    it('should handle PTB and Canary Discord URLs', () => {
      const embeds = [
        {
          description: 'PTB: https://ptb.discord.com/channels/1234567890/9876543210/1122334455',
        },
        {
          description:
            'Canary: https://canary.discord.com/channels/2222222222/3333333333/4444444444',
        },
      ];

      const result = extractDiscordLinksFromEmbeds(embeds);

      expect(result).toEqual([
        'https://ptb.discord.com/channels/1234567890/9876543210/1122334455',
        'https://canary.discord.com/channels/2222222222/3333333333/4444444444',
      ]);
    });

    it('should handle discordapp.com URLs', () => {
      const embeds = [
        {
          description: 'Old URL: https://discordapp.com/channels/1234567890/9876543210/1122334455',
        },
      ];

      const result = extractDiscordLinksFromEmbeds(embeds);

      expect(result).toEqual(['https://discordapp.com/channels/1234567890/9876543210/1122334455']);
    });

    it('should not extract non-Discord links', () => {
      const embeds = [
        {
          description: 'Random link: https://example.com/channels/1234567890/9876543210/1122334455',
        },
      ];

      const result = extractDiscordLinksFromEmbeds(embeds);

      expect(result).toEqual([]);
    });

    it('should handle embeds with missing properties gracefully', () => {
      const embeds = [
        { title: null },
        { description: undefined },
        { fields: [] },
        { footer: {} },
        {},
      ];

      const result = extractDiscordLinksFromEmbeds(embeds);

      expect(result).toEqual([]);
    });
  });
});
