/**
 * Tests for embedComponents
 */

import { describe, it, expect } from 'vitest';
import type { APIEmbed } from 'discord.js';
import {
  readEmbedComponents,
  collectEmbedComponentText,
  collectEmbedComponentMedia,
  readContainerAccentColor,
  embedComponentsHaveContent,
  formatEmbedComponentsXml,
} from './embedComponents.js';
import { VXREDDIT_COMPONENTS_V2_EMBED } from './fixtures/vxredditComponentsV2Embed.js';

const fixture = VXREDDIT_COMPONENTS_V2_EMBED as unknown as APIEmbed;

describe('embedComponents', () => {
  describe('readEmbedComponents', () => {
    it('returns an empty array when the components key is missing', () => {
      expect(readEmbedComponents({} as APIEmbed)).toEqual([]);
    });

    it('returns an empty array when the components value is not an array', () => {
      expect(readEmbedComponents({ components: 'not-an-array' } as unknown as APIEmbed)).toEqual(
        []
      );
    });
  });

  describe('collectEmbedComponentText', () => {
    it('collects the fixture TextDisplay contents in document order', () => {
      const nodes = readEmbedComponents(fixture);

      expect(collectEmbedComponentText(nodes)).toEqual([
        '-# vxReddit',
        '** u/example_user on r/Cult_of_Emily - ⬆️ 691 | 💬 14 [(link)](https://www.reddit.com/comments/abc1234) **',
        "## Emily's trying something new for an outfit",
      ]);
    });

    it('collects Section text alongside its accessory media', () => {
      const sectionFixture = [
        {
          type: 17,
          components: [
            {
              type: 9,
              components: [{ type: 10, content: 'Section text' }],
              accessory: {
                type: 11,
                media: {
                  url: 'https://example.com/thumb.png',
                  proxy_url: 'https://images-ext-1.discordapp.net/thumb.png',
                  content_type: 'image/png',
                },
                description: 'Section accessory alt text',
              },
            },
          ],
        },
      ];

      const texts = collectEmbedComponentText(sectionFixture);
      const media = collectEmbedComponentMedia(sectionFixture);

      expect(texts).toEqual(['Section text']);
      expect(media).toEqual([
        {
          url: 'https://example.com/thumb.png',
          proxyUrl: 'https://images-ext-1.discordapp.net/thumb.png',
          contentType: 'image/png',
          description: 'Section accessory alt text',
        },
      ]);
    });
  });

  describe('collectEmbedComponentMedia', () => {
    it('collects the fixture media item', () => {
      const nodes = readEmbedComponents(fixture);
      const media = collectEmbedComponentMedia(nodes);

      expect(media).toEqual([
        {
          url: 'https://i.redd.it/exampleimg01.jpeg',
          proxyUrl:
            'https://images-ext-1.discordapp.net/external/examplehash0000000000000000000000000000000/https/i.redd.it/exampleimg01.jpeg',
          contentType: 'image/jpeg',
          description: undefined,
        },
      ]);
    });

    it('skips a media item whose content_type is not an image', () => {
      const nodes = [
        {
          type: 12,
          items: [{ media: { url: 'https://example.com/v.mp4', content_type: 'video/mp4' } }],
        },
      ];

      expect(collectEmbedComponentMedia(nodes)).toEqual([]);
    });

    it('keeps a mixed-case image content_type and stores it lowercased', () => {
      const nodes = [
        {
          type: 12,
          items: [{ media: { url: 'https://example.com/mixed.jpg', content_type: 'Image/JPEG' } }],
        },
      ];

      const media = collectEmbedComponentMedia(nodes);

      expect(media).toHaveLength(1);
      expect(media[0]?.contentType).toBe('image/jpeg');
    });

    it('skips a mixed-case non-image content_type', () => {
      const nodes = [
        {
          type: 12,
          items: [{ media: { url: 'https://example.com/v.mp4', content_type: 'VIDEO/MP4' } }],
        },
      ];

      expect(collectEmbedComponentMedia(nodes)).toEqual([]);
    });

    it('keeps a media item with no content_type', () => {
      const nodes = [
        {
          type: 12,
          items: [{ media: { url: 'https://example.com/no-type.png' } }],
        },
      ];

      const media = collectEmbedComponentMedia(nodes);

      expect(media).toHaveLength(1);
      expect(media[0]?.url).toBe('https://example.com/no-type.png');
      expect(media[0]?.contentType).toBeUndefined();
    });

    it('skips a media item with a missing or empty media.url', () => {
      const nodes = [
        {
          type: 12,
          items: [{ media: {} }, { media: { url: '' } }],
        },
      ];

      expect(collectEmbedComponentMedia(nodes)).toEqual([]);
    });
  });

  describe('readContainerAccentColor', () => {
    it('reads the fixture accent color', () => {
      const nodes = readEmbedComponents(fixture);

      expect(readContainerAccentColor(nodes)).toBe(16729344);
    });
  });

  describe('embedComponentsHaveContent', () => {
    it('is true for the fixture', () => {
      expect(embedComponentsHaveContent(fixture)).toBe(true);
    });

    it('is false for an embed with no components', () => {
      expect(embedComponentsHaveContent({ components: [] } as unknown as APIEmbed)).toBe(false);
    });

    it('is false for a Container whose only child is a Separator', () => {
      const embed = {
        components: [{ type: 17, components: [{ type: 14 }] }],
      } as unknown as APIEmbed;

      expect(embedComponentsHaveContent(embed)).toBe(false);
    });
  });

  describe('formatEmbedComponentsXml', () => {
    it('emits the fixture text, image, and exactly one color line', () => {
      const lines = formatEmbedComponentsXml(fixture, 0);

      expect(lines).toEqual([
        '<text>-# vxReddit</text>',
        '<text>** u/example_user on r/Cult_of_Emily - ⬆️ 691 | 💬 14 [(link)](https://www.reddit.com/comments/abc1234) **</text>',
        '<text>## Emily&apos;s trying something new for an outfit</text>',
        '<image filename="embed-1-media-1.png" url="https://i.redd.it/exampleimg01.jpeg"/>',
        '<color>#ff4500</color>',
      ]);
      expect(lines.filter(line => line.startsWith('<color>'))).toHaveLength(1);
    });

    it('returns an empty array when there is nothing to render', () => {
      expect(formatEmbedComponentsXml({} as APIEmbed, 0)).toEqual([]);
    });

    it('escapes XML special characters in TextDisplay content', () => {
      const embed = {
        components: [{ type: 10, content: 'Tag <script> & "quotes"' }],
      } as unknown as APIEmbed;

      const lines = formatEmbedComponentsXml(embed, 0);

      expect(lines).toEqual(['<text>Tag &lt;script&gt; &amp; &quot;quotes&quot;</text>']);
    });

    it('renders alt text as a description attribute on the <image> element', () => {
      const embed = {
        components: [
          {
            type: 9,
            components: [{ type: 10, content: 'Section text' }],
            accessory: {
              type: 11,
              media: {
                url: 'https://example.com/thumb.png',
                content_type: 'image/png',
              },
              description: 'Section accessory alt text',
            },
          },
        ],
      } as unknown as APIEmbed;

      const lines = formatEmbedComponentsXml(embed, 0);

      expect(lines).toContain(
        '<image filename="embed-1-media-1.png" url="https://example.com/thumb.png" description="Section accessory alt text"/>'
      );
    });

    it('renders spoiler="true" on the <image> element for a spoilered item', () => {
      const embed = {
        components: [
          {
            type: 12,
            items: [
              {
                media: { url: 'https://example.com/spoiler.png', content_type: 'image/png' },
                spoiler: true,
              },
            ],
          },
        ],
      } as unknown as APIEmbed;

      const lines = formatEmbedComponentsXml(embed, 0);

      expect(lines).toContain(
        '<image filename="embed-1-media-1.png" url="https://example.com/spoiler.png" spoiler="true"/>'
      );
    });

    it('renders description before spoiler when an item carries both', () => {
      const embed = {
        components: [
          {
            type: 12,
            items: [
              {
                media: { url: 'https://example.com/both.png', content_type: 'image/png' },
                description: 'Both attrs',
                spoiler: true,
              },
            ],
          },
        ],
      } as unknown as APIEmbed;

      const lines = formatEmbedComponentsXml(embed, 0);

      expect(lines).toContain(
        '<image filename="embed-1-media-1.png" url="https://example.com/both.png" description="Both attrs" spoiler="true"/>'
      );
    });

    it('emits no <color> line when the legacy embed.color is set', () => {
      const embed = { ...fixture, color: 0x123456 } as APIEmbed;

      const lines = formatEmbedComponentsXml(embed, 0);

      expect(lines.some(line => line.startsWith('<color>'))).toBe(false);
    });
  });
});
