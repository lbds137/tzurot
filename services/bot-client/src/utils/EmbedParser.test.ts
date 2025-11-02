/**
 * Tests for EmbedParser
 */

import { APIEmbed, Message } from 'discord.js';
import { EmbedParser } from './EmbedParser.js';

describe('EmbedParser', () => {
  describe('parseEmbed', () => {
    it('should parse embed with title only', () => {
      const embed: APIEmbed = {
        title: 'Test Title'
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('## Test Title');
    });

    it('should parse embed with title and URL', () => {
      const embed: APIEmbed = {
        title: 'Click Here',
        url: 'https://example.com'
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('[Click Here](https://example.com)');
    });

    it('should parse embed with description', () => {
      const embed: APIEmbed = {
        description: 'This is a test description'
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('This is a test description');
    });

    it('should parse embed with author', () => {
      const embed: APIEmbed = {
        author: {
          name: 'Test Author'
        }
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('Author: Test Author');
    });

    it('should parse embed with author and URL', () => {
      const embed: APIEmbed = {
        author: {
          name: 'Test Author',
          url: 'https://author.example.com'
        }
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('Author: [Test Author](https://author.example.com)');
    });

    it('should parse embed with single field', () => {
      const embed: APIEmbed = {
        fields: [
          {
            name: 'Field Name',
            value: 'Field Value',
            inline: false
          }
        ]
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('**Field Name**: Field Value');
    });

    it('should parse embed with inline field', () => {
      const embed: APIEmbed = {
        fields: [
          {
            name: 'Inline Field',
            value: 'Inline Value',
            inline: true
          }
        ]
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('**Inline Field** (inline): Inline Value');
    });

    it('should parse embed with multiple fields', () => {
      const embed: APIEmbed = {
        fields: [
          {
            name: 'Field 1',
            value: 'Value 1',
            inline: false
          },
          {
            name: 'Field 2',
            value: 'Value 2',
            inline: true
          },
          {
            name: 'Field 3',
            value: 'Value 3',
            inline: false
          }
        ]
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('**Field 1**: Value 1');
      expect(result).toContain('**Field 2** (inline): Value 2');
      expect(result).toContain('**Field 3**: Value 3');
    });

    it('should parse embed with image', () => {
      const embed: APIEmbed = {
        image: {
          url: 'https://example.com/image.png'
        }
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('Image: https://example.com/image.png');
    });

    it('should parse embed with thumbnail', () => {
      const embed: APIEmbed = {
        thumbnail: {
          url: 'https://example.com/thumbnail.png'
        }
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('Thumbnail: https://example.com/thumbnail.png');
    });

    it('should parse embed with footer', () => {
      const embed: APIEmbed = {
        footer: {
          text: 'Footer text here'
        }
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('_Footer text here_');
    });

    it('should parse embed with timestamp', () => {
      const embed: APIEmbed = {
        timestamp: '2025-11-02T12:00:00.000Z'
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('Timestamp: 2025-11-02T12:00:00.000Z');
    });

    it('should parse embed with color', () => {
      const embed: APIEmbed = {
        color: 0xFF0000 // Red
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('Color: #ff0000');
    });

    it('should parse embed with color padding', () => {
      const embed: APIEmbed = {
        color: 0x000001 // Very small number
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('Color: #000001');
    });

    it('should parse complete embed with all fields', () => {
      const embed: APIEmbed = {
        title: 'Complete Embed',
        url: 'https://example.com',
        description: 'Full description here',
        color: 0x00FF00,
        author: {
          name: 'Author Name',
          url: 'https://author.example.com'
        },
        fields: [
          {
            name: 'Field 1',
            value: 'Value 1',
            inline: true
          },
          {
            name: 'Field 2',
            value: 'Value 2',
            inline: false
          }
        ],
        image: {
          url: 'https://example.com/image.png'
        },
        thumbnail: {
          url: 'https://example.com/thumb.png'
        },
        footer: {
          text: 'Footer text'
        },
        timestamp: '2025-11-02T12:00:00.000Z'
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('## [Complete Embed](https://example.com)');
      expect(result).toContain('Author: [Author Name](https://author.example.com)');
      expect(result).toContain('Full description here');
      expect(result).toContain('**Field 1** (inline): Value 1');
      expect(result).toContain('**Field 2**: Value 2');
      expect(result).toContain('Image: https://example.com/image.png');
      expect(result).toContain('Thumbnail: https://example.com/thumb.png');
      expect(result).toContain('_Footer text_');
      expect(result).toContain('Timestamp: 2025-11-02T12:00:00.000Z');
      expect(result).toContain('Color: #00ff00');
    });

    it('should handle empty embed', () => {
      const embed: APIEmbed = {};

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toBe('');
    });

    it('should handle embed with empty arrays', () => {
      const embed: APIEmbed = {
        fields: []
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toBe('');
    });
  });

  describe('parseMessageEmbeds', () => {
    it('should parse message with single embed', () => {
      const mockEmbed = {
        toJSON: () => ({
          title: 'Test Title',
          description: 'Test Description'
        })
      };

      const mockMessage = {
        embeds: [mockEmbed]
      } as unknown as Message;

      const result = EmbedParser.parseMessageEmbeds(mockMessage);

      expect(result).toContain('### Embed');
      expect(result).toContain('## Test Title');
      expect(result).toContain('Test Description');
    });

    it('should parse message with multiple embeds', () => {
      const mockEmbed1 = {
        toJSON: () => ({
          title: 'Embed 1',
          description: 'Description 1'
        })
      };

      const mockEmbed2 = {
        toJSON: () => ({
          title: 'Embed 2',
          description: 'Description 2'
        })
      };

      const mockMessage = {
        embeds: [mockEmbed1, mockEmbed2]
      } as unknown as Message;

      const result = EmbedParser.parseMessageEmbeds(mockMessage);

      expect(result).toContain('### Embed 1');
      expect(result).toContain('## Embed 1');
      expect(result).toContain('Description 1');
      expect(result).toContain('---');
      expect(result).toContain('### Embed 2');
      expect(result).toContain('## Embed 2');
      expect(result).toContain('Description 2');
    });

    it('should return empty string for message with no embeds', () => {
      const mockMessage = {
        embeds: []
      } as unknown as Message;

      const result = EmbedParser.parseMessageEmbeds(mockMessage);

      expect(result).toBe('');
    });

    it('should handle message with undefined embeds', () => {
      const mockMessage = {} as Message;

      const result = EmbedParser.parseMessageEmbeds(mockMessage);

      expect(result).toBe('');
    });

    it('should number embeds correctly when multiple exist', () => {
      const mockEmbeds = [
        { toJSON: () => ({ title: 'First' }) },
        { toJSON: () => ({ title: 'Second' }) },
        { toJSON: () => ({ title: 'Third' }) }
      ];

      const mockMessage = {
        embeds: mockEmbeds
      } as unknown as Message;

      const result = EmbedParser.parseMessageEmbeds(mockMessage);

      expect(result).toContain('### Embed 1');
      expect(result).toContain('### Embed 2');
      expect(result).toContain('### Embed 3');
    });

    it('should not number embed when only one exists', () => {
      const mockEmbed = {
        toJSON: () => ({ title: 'Single' })
      };

      const mockMessage = {
        embeds: [mockEmbed]
      } as unknown as Message;

      const result = EmbedParser.parseMessageEmbeds(mockMessage);

      expect(result).toContain('### Embed\n');
      expect(result).not.toContain('### Embed 1');
    });
  });

  describe('hasEmbeds', () => {
    it('should return true for message with embeds', () => {
      const mockMessage = {
        embeds: [{ toJSON: () => ({ title: 'Test' }) }]
      } as unknown as Message;

      const result = EmbedParser.hasEmbeds(mockMessage);

      expect(result).toBe(true);
    });

    it('should return false for message with empty embeds array', () => {
      const mockMessage = {
        embeds: []
      } as unknown as Message;

      const result = EmbedParser.hasEmbeds(mockMessage);

      expect(result).toBe(false);
    });

    it('should return false for message with undefined embeds', () => {
      const mockMessage = {} as Message;

      const result = EmbedParser.hasEmbeds(mockMessage);

      expect(result).toBe(false);
    });
  });
});
