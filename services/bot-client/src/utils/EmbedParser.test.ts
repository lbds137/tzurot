/**
 * Tests for EmbedParser
 */

import { APIEmbed, Message } from 'discord.js';
import { EmbedParser } from './EmbedParser.js';

describe('EmbedParser', () => {
  describe('parseEmbed', () => {
    it('should parse embed with title only', () => {
      const embed: APIEmbed = {
        title: 'Test Title',
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('<title>Test Title</title>');
    });

    it('should parse embed with title and URL', () => {
      const embed: APIEmbed = {
        title: 'Click Here',
        url: 'https://example.com',
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('<title url="https://example.com">Click Here</title>');
    });

    it('should parse embed with description', () => {
      const embed: APIEmbed = {
        description: 'This is a test description',
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('<description>This is a test description</description>');
    });

    it('should parse embed with author', () => {
      const embed: APIEmbed = {
        author: {
          name: 'Test Author',
        },
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('<author>Test Author</author>');
    });

    it('should parse embed with author and URL', () => {
      const embed: APIEmbed = {
        author: {
          name: 'Test Author',
          url: 'https://author.example.com',
        },
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('<author url="https://author.example.com">Test Author</author>');
    });

    it('should parse embed with single field', () => {
      const embed: APIEmbed = {
        fields: [
          {
            name: 'Field Name',
            value: 'Field Value',
            inline: false,
          },
        ],
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('<fields>');
      expect(result).toContain('<field name="Field Name">Field Value</field>');
      expect(result).toContain('</fields>');
    });

    it('should parse embed with inline field', () => {
      const embed: APIEmbed = {
        fields: [
          {
            name: 'Inline Field',
            value: 'Inline Value',
            inline: true,
          },
        ],
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('<field name="Inline Field" inline="true">Inline Value</field>');
    });

    it('should parse embed with multiple fields', () => {
      const embed: APIEmbed = {
        fields: [
          {
            name: 'Field 1',
            value: 'Value 1',
            inline: false,
          },
          {
            name: 'Field 2',
            value: 'Value 2',
            inline: true,
          },
          {
            name: 'Field 3',
            value: 'Value 3',
            inline: false,
          },
        ],
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('<field name="Field 1">Value 1</field>');
      expect(result).toContain('<field name="Field 2" inline="true">Value 2</field>');
      expect(result).toContain('<field name="Field 3">Value 3</field>');
    });

    it('should parse embed with image', () => {
      const embed: APIEmbed = {
        image: {
          url: 'https://example.com/image.png',
        },
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('<image url="https://example.com/image.png"/>');
    });

    it('should parse embed with thumbnail', () => {
      const embed: APIEmbed = {
        thumbnail: {
          url: 'https://example.com/thumbnail.png',
        },
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('<thumbnail url="https://example.com/thumbnail.png"/>');
    });

    it('should parse embed with footer', () => {
      const embed: APIEmbed = {
        footer: {
          text: 'Footer text here',
        },
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('<footer>Footer text here</footer>');
    });

    it('should parse embed with timestamp', () => {
      const embed: APIEmbed = {
        timestamp: '2025-11-02T12:00:00.000Z',
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('<timestamp>2025-11-02T12:00:00.000Z</timestamp>');
    });

    it('should parse embed with color', () => {
      const embed: APIEmbed = {
        color: 0xff0000, // Red
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('<color>#ff0000</color>');
    });

    it('should parse embed with color padding', () => {
      const embed: APIEmbed = {
        color: 0x000001, // Very small number
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('<color>#000001</color>');
    });

    it('should parse complete embed with all fields', () => {
      const embed: APIEmbed = {
        title: 'Complete Embed',
        url: 'https://example.com',
        description: 'Full description here',
        color: 0x00ff00,
        author: {
          name: 'Author Name',
          url: 'https://author.example.com',
        },
        fields: [
          {
            name: 'Field 1',
            value: 'Value 1',
            inline: true,
          },
          {
            name: 'Field 2',
            value: 'Value 2',
            inline: false,
          },
        ],
        image: {
          url: 'https://example.com/image.png',
        },
        thumbnail: {
          url: 'https://example.com/thumb.png',
        },
        footer: {
          text: 'Footer text',
        },
        timestamp: '2025-11-02T12:00:00.000Z',
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('<title url="https://example.com">Complete Embed</title>');
      expect(result).toContain('<author url="https://author.example.com">Author Name</author>');
      expect(result).toContain('<description>Full description here</description>');
      expect(result).toContain('<field name="Field 1" inline="true">Value 1</field>');
      expect(result).toContain('<field name="Field 2">Value 2</field>');
      expect(result).toContain('<image url="https://example.com/image.png"/>');
      expect(result).toContain('<thumbnail url="https://example.com/thumb.png"/>');
      expect(result).toContain('<footer>Footer text</footer>');
      expect(result).toContain('<timestamp>2025-11-02T12:00:00.000Z</timestamp>');
      expect(result).toContain('<color>#00ff00</color>');
    });

    it('should handle empty embed', () => {
      const embed: APIEmbed = {};

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toBe('');
    });

    it('should handle embed with empty arrays', () => {
      const embed: APIEmbed = {
        fields: [],
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toBe('');
    });

    it('should escape XML special characters in title', () => {
      const embed: APIEmbed = {
        title: 'Test <script> & "quotes"',
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('<title>Test &lt;script&gt; &amp; &quot;quotes&quot;</title>');
    });

    it('should escape XML special characters in URL attributes', () => {
      const embed: APIEmbed = {
        title: 'Link',
        url: 'https://example.com?a=1&b=2',
      };

      const result = EmbedParser.parseEmbed(embed);

      expect(result).toContain('url="https://example.com?a=1&amp;b=2"');
    });
  });

  describe('parseMessageEmbeds', () => {
    it('should parse message with single embed', () => {
      const mockEmbed = {
        toJSON: () => ({
          title: 'Test Title',
          description: 'Test Description',
        }),
      };

      const mockMessage = {
        embeds: [mockEmbed],
      } as unknown as Message;

      const result = EmbedParser.parseMessageEmbeds(mockMessage);

      expect(result).toContain('<embed>');
      expect(result).toContain('<title>Test Title</title>');
      expect(result).toContain('<description>Test Description</description>');
      expect(result).toContain('</embed>');
    });

    it('should parse message with multiple embeds', () => {
      const mockEmbed1 = {
        toJSON: () => ({
          title: 'Embed 1',
          description: 'Description 1',
        }),
      };

      const mockEmbed2 = {
        toJSON: () => ({
          title: 'Embed 2',
          description: 'Description 2',
        }),
      };

      const mockMessage = {
        embeds: [mockEmbed1, mockEmbed2],
      } as unknown as Message;

      const result = EmbedParser.parseMessageEmbeds(mockMessage);

      expect(result).toContain('<embed number="1">');
      expect(result).toContain('<title>Embed 1</title>');
      expect(result).toContain('<description>Description 1</description>');
      expect(result).toContain('<embed number="2">');
      expect(result).toContain('<title>Embed 2</title>');
      expect(result).toContain('<description>Description 2</description>');
    });

    it('should return empty string for message with no embeds', () => {
      const mockMessage = {
        embeds: [],
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
        { toJSON: () => ({ title: 'Third' }) },
      ];

      const mockMessage = {
        embeds: mockEmbeds,
      } as unknown as Message;

      const result = EmbedParser.parseMessageEmbeds(mockMessage);

      expect(result).toContain('<embed number="1">');
      expect(result).toContain('<embed number="2">');
      expect(result).toContain('<embed number="3">');
    });

    it('should not number embed when only one exists', () => {
      const mockEmbed = {
        toJSON: () => ({ title: 'Single' }),
      };

      const mockMessage = {
        embeds: [mockEmbed],
      } as unknown as Message;

      const result = EmbedParser.parseMessageEmbeds(mockMessage);

      expect(result).toContain('<embed>');
      expect(result).not.toContain('number=');
    });
  });

  describe('hasEmbeds', () => {
    it('should return true for message with embeds', () => {
      const mockMessage = {
        embeds: [{ toJSON: () => ({ title: 'Test' }) }],
      } as unknown as Message;

      const result = EmbedParser.hasEmbeds(mockMessage);

      expect(result).toBe(true);
    });

    it('should return false for message with empty embeds array', () => {
      const mockMessage = {
        embeds: [],
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
