/**
 * Tests for Embed Image Extractor
 */

import { describe, it, expect } from 'vitest';
import { extractEmbedImages } from './embedImageExtractor.js';
import { formatEmbedComponentsXml } from './embedComponents.js';
import { generateAttachmentPlaceholder } from './attachmentPlaceholders.js';
import { EMBED_LIMITS } from '@tzurot/common-types/constants/media';
import type { Embed, APIEmbed } from 'discord.js';
import { VXREDDIT_COMPONENTS_V2_EMBED } from './fixtures/vxredditComponentsV2Embed.js';

describe('extractEmbedImages', () => {
  it('should return undefined for undefined input', () => {
    expect(extractEmbedImages(undefined)).toBeUndefined();
  });

  it('should return undefined for empty array', () => {
    expect(extractEmbedImages([])).toBeUndefined();
  });

  it('should extract image URL from embed', () => {
    const embeds = [
      {
        image: { url: 'https://example.com/image.png' },
        thumbnail: null,
        toJSON: () => ({}),
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(1);
    expect(result![0].url).toBe('https://example.com/image.png');
    expect(result![0].name).toBe('embed-1-image.png');
    expect(result![0].contentType).toBe('image/png');
    expect(result![0].size).toBeUndefined();
    expect(result![0].isEmbedPreview).toBe(true);
  });

  it('should extract thumbnail URL from embed', () => {
    const embeds = [
      {
        image: null,
        thumbnail: { url: 'https://example.com/thumb.png' },
        toJSON: () => ({}),
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(1);
    expect(result![0].url).toBe('https://example.com/thumb.png');
    expect(result![0].name).toBe('embed-1-thumbnail.png');
    expect(result![0].isEmbedPreview).toBe(true);
  });

  it('should extract both image and thumbnail from same embed', () => {
    const embeds = [
      {
        image: { url: 'https://example.com/image.png' },
        thumbnail: { url: 'https://example.com/thumb.png' },
        toJSON: () => ({}),
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(2);
    expect(result![0].url).toBe('https://example.com/image.png');
    expect(result![0].name).toBe('embed-1-image.png');
    expect(result![1].url).toBe('https://example.com/thumb.png');
    // Under the old running-counter scheme this was `embed-thumbnail-2.png` —
    // interleaved numbering that gave the same embed two different indices
    // for its two slots. The fix: both slots of the same embed now share its
    // index.
    expect(result![1].name).toBe('embed-1-thumbnail.png');
    expect(result![0].isEmbedPreview).toBe(true);
    expect(result![1].isEmbedPreview).toBe(true);
  });

  it('should extract images from multiple embeds', () => {
    const embeds = [
      {
        image: { url: 'https://example.com/image1.png' },
        thumbnail: null,
        toJSON: () => ({}),
      },
      {
        image: { url: 'https://example.com/image2.png' },
        thumbnail: null,
        toJSON: () => ({}),
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(2);
    expect(result![0].url).toBe('https://example.com/image1.png');
    expect(result![0].name).toBe('embed-1-image.png');
    expect(result![1].url).toBe('https://example.com/image2.png');
    expect(result![1].name).toBe('embed-2-image.png');
  });

  it('names both slots of the first embed by its own index, not an interleaved counter', () => {
    // Two embeds: the first carries both image and thumbnail, the second an
    // image. Under the old running-counter scheme this produced
    // embed-image-1, embed-thumbnail-2, embed-image-3 — the second embed's
    // image was misnumbered "3" because the counter didn't reset per embed,
    // and the first embed's two slots didn't share an index at all.
    const embeds = [
      {
        image: { url: 'https://example.com/e1-image.png' },
        thumbnail: { url: 'https://example.com/e1-thumb.png' },
        toJSON: () => ({}),
      },
      {
        image: { url: 'https://example.com/e2-image.png' },
        thumbnail: null,
        toJSON: () => ({}),
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(3);
    expect(result![0].name).toBe('embed-1-image.png');
    expect(result![1].name).toBe('embed-1-thumbnail.png');
    expect(result![2].name).toBe('embed-2-image.png');
  });

  it('should return undefined when embeds have no images', () => {
    const embeds = [
      {
        image: null,
        thumbnail: null,
        title: 'Just a text embed',
        toJSON: () => ({}),
      },
    ] as unknown as Embed[];

    expect(extractEmbedImages(embeds)).toBeUndefined();
  });

  it('should skip embeds with empty image URLs', () => {
    const embeds = [
      {
        image: { url: '' },
        thumbnail: null,
        toJSON: () => ({}),
      },
    ] as unknown as Embed[];

    expect(extractEmbedImages(embeds)).toBeUndefined();
  });

  it('should skip embeds with undefined image property', () => {
    const embeds = [
      {
        image: undefined,
        thumbnail: undefined,
        toJSON: () => ({}),
      },
    ] as unknown as Embed[];

    expect(extractEmbedImages(embeds)).toBeUndefined();
  });

  it('should prefer proxyURL over url when both are present (external-hosted image)', () => {
    // When Discord generates an embed from a Reddit/Imgur link, `url` is the original
    // source and `proxyURL` is Discord's `media.discordapp.net`-proxied version.
    // We need the proxied one to satisfy the CDN allowlist downstream.
    const embeds = [
      {
        image: {
          url: 'https://i.redd.it/original.jpg',
          proxyURL: 'https://media.discordapp.net/external/abc123/original.jpg',
        },
        thumbnail: {
          url: 'https://i.redd.it/thumb.jpg',
          proxyURL: 'https://media.discordapp.net/external/def456/thumb.jpg',
        },
        toJSON: () => ({}),
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(2);
    expect(result![0].url).toBe('https://media.discordapp.net/external/abc123/original.jpg');
    expect(result![1].url).toBe('https://media.discordapp.net/external/def456/thumb.jpg');
  });

  it('should fall back to url when proxyURL is undefined (bot-sent embed)', () => {
    // Bot-generated embeds sometimes ship without proxyURL — the raw url must still work.
    const embeds = [
      {
        image: { url: 'https://cdn.example.com/bot-image.png', proxyURL: undefined },
        thumbnail: null,
        toJSON: () => ({}),
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(1);
    expect(result![0].url).toBe('https://cdn.example.com/bot-image.png');
  });

  it('should handle mixed embeds with and without images', () => {
    const embeds = [
      {
        image: null,
        thumbnail: null,
        title: 'Text only',
        toJSON: () => ({}),
      },
      {
        image: { url: 'https://example.com/image.png' },
        thumbnail: null,
        toJSON: () => ({}),
      },
      {
        image: null,
        thumbnail: null,
        description: 'Another text embed',
        toJSON: () => ({}),
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(1);
    expect(result![0].url).toBe('https://example.com/image.png');
  });

  it('extracts the fixture Components-V2 gallery media as one attachment', () => {
    const embeds = [
      {
        image: null,
        thumbnail: null,
        toJSON: () => VXREDDIT_COMPONENTS_V2_EMBED,
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toEqual([
      {
        url: 'https://images-ext-1.discordapp.net/external/examplehash0000000000000000000000000000000/https/i.redd.it/exampleimg01.jpeg',
        name: 'embed-1-media-1.png',
        isEmbedPreview: true,
        contentType: 'image/jpeg',
        size: undefined,
      },
    ]);
  });

  it('skips a non-image gallery item without consuming a media index slot', () => {
    const embeds = [
      {
        image: null,
        thumbnail: null,
        toJSON: () => ({
          components: [
            {
              type: 17,
              components: [
                {
                  type: 12,
                  items: [
                    { media: { url: 'https://example.com/clip.mp4', content_type: 'video/mp4' } },
                    { media: { url: 'https://example.com/photo.png', content_type: 'image/png' } },
                  ],
                },
              ],
            },
          ],
        }),
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(1);
    expect(result![0].url).toBe('https://example.com/photo.png');
    expect(result![0].name).toBe('embed-1-media-1.png');
  });

  it('still extracts a spoilered gallery item as an attachment', () => {
    const embeds = [
      {
        image: null,
        thumbnail: null,
        toJSON: () => ({
          components: [
            {
              type: 17,
              components: [
                {
                  type: 12,
                  items: [
                    {
                      media: {
                        url: 'https://example.com/spoiler.png',
                        content_type: 'image/png',
                      },
                      spoiler: true,
                    },
                  ],
                },
              ],
            },
          ],
        }),
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(1);
    expect(result![0].url).toBe('https://example.com/spoiler.png');
    expect(result![0].name).toBe('embed-1-media-1.png');
    expect(result![0].isSpoiler).toBe(true);
  });

  it('keeps the Link preview header for a spoilered gallery item through the placeholder path', () => {
    // Link-preview precedence wins the header; the spoiler flag still reaches
    // the render as spoiler="true" on the <image> element (QuoteFormatter),
    // but the bracket header names provenance, not the spoiler state.
    const embeds = [
      {
        image: null,
        thumbnail: null,
        toJSON: () => ({
          components: [
            {
              type: 17,
              components: [
                {
                  type: 12,
                  items: [
                    {
                      media: {
                        url: 'https://example.com/spoiler.png',
                        content_type: 'image/png',
                      },
                      spoiler: true,
                    },
                  ],
                },
              ],
            },
          ],
        }),
      },
    ] as unknown as Embed[];

    const [attachment] = extractEmbedImages(embeds)!;
    expect(generateAttachmentPlaceholder(attachment)).toBe('[Link preview: embed-1-media-1.png]');
  });

  it('does not set isSpoiler on a non-spoilered gallery item', () => {
    const embeds = [
      {
        image: null,
        thumbnail: null,
        toJSON: () => ({
          components: [
            {
              type: 17,
              components: [
                {
                  type: 12,
                  items: [
                    {
                      media: {
                        url: 'https://example.com/plain.png',
                        content_type: 'image/png',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(1);
    expect(result![0]).not.toHaveProperty('isSpoiler');
  });

  it('falls back to media.url when a gallery item has no proxy_url', () => {
    const embeds = [
      {
        image: null,
        thumbnail: null,
        toJSON: () => ({
          components: [
            {
              type: 17,
              components: [
                {
                  type: 12,
                  items: [{ media: { url: 'https://example.com/no-proxy.jpg' } }],
                },
              ],
            },
          ],
        }),
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(1);
    expect(result![0].url).toBe('https://example.com/no-proxy.jpg');
    expect(result![0].name).toBe('embed-1-media-1.png');
  });

  it('names Components-V2 attachments exactly as the text render names its image lines', () => {
    const galleryItems = Array.from({ length: EMBED_LIMITS.MAX_MEDIA_PER_EMBED + 2 }, (_, i) => ({
      media: { url: `https://example.com/g${i + 1}.png`, content_type: 'image/png' },
    }));
    const json = {
      components: [
        {
          type: 17,
          components: [
            {
              type: 9,
              components: [{ type: 10, content: 'one' }],
              accessory: {
                type: 11,
                media: { url: 'https://example.com/t1.png', content_type: 'image/png' },
              },
            },
            { type: 12, items: galleryItems },
            {
              type: 9,
              components: [{ type: 10, content: 'two' }],
              accessory: {
                type: 11,
                media: { url: 'https://example.com/t2.png', content_type: 'image/png' },
              },
            },
          ],
        },
      ],
    };

    const embeds = [
      {
        image: null,
        thumbnail: null,
        toJSON: () => json,
      },
    ] as unknown as Embed[];

    const names = extractEmbedImages(embeds)!.map(a => a.name);
    const urlsFromExtraction = extractEmbedImages(embeds)!.map(a => a.url);

    const lines = formatEmbedComponentsXml(json as unknown as APIEmbed, 0);
    const imageLines = lines.filter(line => line.startsWith('<image'));
    const parsed = imageLines.map(line => {
      const match = /filename="([^"]+)" url="([^"]+)"/.exec(line);
      return { filename: match![1], url: match![2] };
    });

    expect(names).toEqual(parsed.map(p => p.filename));
    expect(urlsFromExtraction).toEqual(parsed.map(p => p.url));
    expect(names).toHaveLength(EMBED_LIMITS.MAX_MEDIA_PER_EMBED);
  });

  describe('snapshot scope', () => {
    it('scopes the image, thumbnail, and gallery-media names to the forwarded snapshot', () => {
      const embeds = [
        {
          image: { url: 'https://example.com/image.png' },
          thumbnail: { url: 'https://example.com/thumb.png' },
          toJSON: () => VXREDDIT_COMPONENTS_V2_EMBED,
        },
      ] as unknown as Embed[];

      const result = extractEmbedImages(embeds, { snapshotIndex: 1 });

      expect(result).toHaveLength(3);
      expect(result?.map(a => a.name)).toEqual([
        'forward-2-embed-1-image.png',
        'forward-2-embed-1-thumbnail.png',
        'forward-2-embed-1-media-1.png',
      ]);
    });
  });
});
