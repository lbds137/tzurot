/**
 * Tests for embedComponents
 */

import { describe, it, expect } from 'vitest';
import type { APIEmbed } from 'discord.js';
import {
  readEmbedComponents,
  collectEmbedComponentMedia,
  readContainerAccentColor,
  embedComponentsHaveContent,
  formatEmbedComponentsXml,
  walkEmbedComponents,
  MAX_EMBED_COMPONENT_DEPTH,
} from './embedComponents.js';
import { VXREDDIT_COMPONENTS_V2_EMBED } from './fixtures/vxredditComponentsV2Embed.js';
import { EMBED_LIMITS } from '@tzurot/common-types/constants/media';

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

  describe('walkEmbedComponents', () => {
    it('collects Section text alongside its accessory media, in document order', () => {
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

      const parts = walkEmbedComponents(sectionFixture);

      expect(parts).toEqual([
        { kind: 'text', content: 'Section text' },
        {
          kind: 'media',
          media: {
            url: 'https://example.com/thumb.png',
            proxyUrl: 'https://images-ext-1.discordapp.net/thumb.png',
            contentType: 'image/png',
            description: 'Section accessory alt text',
          },
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

    it('returns the first numeric accent color across top-level Containers', () => {
      const nodes = [
        { type: 17, components: [] },
        { type: 17, accent_color: 255, components: [] },
      ];

      expect(readContainerAccentColor(nodes)).toBe(255);
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

    it('interleaves each Section text with its own accessory image in document order', () => {
      const embed = {
        components: [
          {
            type: 17,
            components: [
              {
                type: 9,
                components: [{ type: 10, content: 'Text one' }],
                accessory: {
                  type: 11,
                  media: { url: 'https://example.com/one.png', content_type: 'image/png' },
                },
              },
              {
                type: 9,
                components: [{ type: 10, content: 'Text two' }],
                accessory: {
                  type: 11,
                  media: { url: 'https://example.com/two.png' },
                },
              },
            ],
          },
        ],
      } as unknown as APIEmbed;

      const lines = formatEmbedComponentsXml(embed, 0);

      expect(lines).toEqual([
        '<text>Text one</text>',
        '<image filename="embed-1-media-1.png" url="https://example.com/one.png"/>',
        '<text>Text two</text>',
        '<image filename="embed-1-media-2.png" url="https://example.com/two.png"/>',
      ]);
    });

    it('renders the accent color of a later Container when the first has none', () => {
      const embed = {
        components: [
          { type: 17, accent_color: null, components: [{ type: 10, content: 'A' }] },
          { type: 17, accent_color: 0x00ff00, components: [{ type: 10, content: 'B' }] },
        ],
      } as unknown as APIEmbed;

      const lines = formatEmbedComponentsXml(embed, 0);

      expect(lines).toEqual(['<text>A</text>', '<text>B</text>', '<color>#00ff00</color>']);
    });
  });

  describe('bounds', () => {
    it('renders only the levels within the depth cap', () => {
      const maxLevel = MAX_EMBED_COMPONENT_DEPTH + 1;
      let components: unknown[] = [
        { type: 10, content: `level ${maxLevel}` },
        {
          type: 12,
          items: [{ media: { url: 'https://example.com/toodeep.png', content_type: 'image/png' } }],
        },
      ];
      for (let level = maxLevel - 1; level >= 1; level--) {
        components = [
          { type: 10, content: `level ${level}` },
          { type: 17, components },
        ];
      }

      const embed = { components } as unknown as APIEmbed;
      const lines = formatEmbedComponentsXml(embed, 0);

      const expected = Array.from(
        { length: MAX_EMBED_COMPONENT_DEPTH },
        (_, i) => `<text>level ${i + 1}</text>`
      );
      expect(lines).toEqual(expected);
      expect(lines.some(line => line.startsWith('<image'))).toBe(false);
    });

    it('does not throw on a pathologically deep tree', () => {
      const totalLevels = 10000;
      let components: unknown[] = [{ type: 10, content: `level ${totalLevels}` }];
      for (let level = totalLevels - 1; level >= 1; level--) {
        components = [
          { type: 10, content: `level ${level}` },
          { type: 17, components },
        ];
      }
      const embed = { components } as unknown as APIEmbed;

      let result: string[] = [];
      expect(() => {
        result = formatEmbedComponentsXml(embed, 0);
      }).not.toThrow();
      expect(result).toHaveLength(MAX_EMBED_COMPONENT_DEPTH);
    });

    it('caps collected media at EMBED_LIMITS.MAX_MEDIA_PER_EMBED in document order', () => {
      const itemCount = EMBED_LIMITS.MAX_MEDIA_PER_EMBED + 3;
      const items = Array.from({ length: itemCount }, (_, i) => ({
        media: { url: `https://example.com/m${i + 1}.png`, content_type: 'image/png' },
      }));
      const nodes = [{ type: 12, items }];

      const media = collectEmbedComponentMedia(nodes);
      expect(media).toHaveLength(EMBED_LIMITS.MAX_MEDIA_PER_EMBED);
      expect(media.map(m => m.url)).toEqual(
        Array.from(
          { length: EMBED_LIMITS.MAX_MEDIA_PER_EMBED },
          (_, i) => `https://example.com/m${i + 1}.png`
        )
      );

      const embed = { components: nodes } as unknown as APIEmbed;
      const lines = formatEmbedComponentsXml(embed, 0);
      const imageLines = lines.filter(line => line.startsWith('<image'));
      expect(imageLines).toHaveLength(EMBED_LIMITS.MAX_MEDIA_PER_EMBED);
      expect(imageLines).toEqual(
        Array.from(
          { length: EMBED_LIMITS.MAX_MEDIA_PER_EMBED },
          (_, i) =>
            `<image filename="embed-1-media-${i + 1}.png" url="https://example.com/m${i + 1}.png"/>`
        )
      );
    });

    it('counts Section accessories and gallery items against one shared cap', () => {
      const galleryItems = Array.from({ length: EMBED_LIMITS.MAX_MEDIA_PER_EMBED }, (_, i) => ({
        media: { url: `https://example.com/g${i + 1}.png`, content_type: 'image/png' },
      }));
      const nodes = [
        {
          type: 17,
          components: [
            {
              type: 9,
              components: [{ type: 10, content: 'S' }],
              accessory: {
                type: 11,
                media: { url: 'https://example.com/s.png', content_type: 'image/png' },
              },
            },
            { type: 12, items: galleryItems },
          ],
        },
      ];

      const media = collectEmbedComponentMedia(nodes);

      expect(media).toHaveLength(EMBED_LIMITS.MAX_MEDIA_PER_EMBED);
      expect(media[0]?.url).toBe('https://example.com/s.png');
      expect(media[media.length - 1]?.url).toBe(
        `https://example.com/g${EMBED_LIMITS.MAX_MEDIA_PER_EMBED - 1}.png`
      );
    });

    it('stops mapping gallery items once the media budget is spent, on a gallery of thousands', () => {
      let accessCount = 0;
      const items = Array.from({ length: 5000 }, (_, i) => ({
        get media(): { url: string; content_type: string } {
          accessCount++;
          return { url: `https://example.com/huge${i + 1}.png`, content_type: 'image/png' };
        },
      }));
      const nodes = [{ type: 12, items }];

      const media = collectEmbedComponentMedia(nodes);

      expect(media).toHaveLength(EMBED_LIMITS.MAX_MEDIA_PER_EMBED);
      expect(media.map(m => m.url)).toEqual(
        Array.from(
          { length: EMBED_LIMITS.MAX_MEDIA_PER_EMBED },
          (_, i) => `https://example.com/huge${i + 1}.png`
        )
      );
      // Observes that mapping stopped: the `media` getter fires once per item
      // examined, so an access count equal to the cap (not the 5000-item
      // array) proves the remaining items were never visited.
      expect(accessCount).toBe(EMBED_LIMITS.MAX_MEDIA_PER_EMBED);
    });
  });
});
