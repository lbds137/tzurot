/**
 * Tests for Embed Image Extractor
 */

import { describe, it, expect } from 'vitest';
import { extractEmbedImages } from './embedImageExtractor.js';
import type { Embed } from 'discord.js';

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
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(1);
    expect(result![0].url).toBe('https://example.com/image.png');
    expect(result![0].name).toBe('embed-image-1.png');
    expect(result![0].contentType).toBe('image/png');
    expect(result![0].size).toBeUndefined();
  });

  it('should extract thumbnail URL from embed', () => {
    const embeds = [
      {
        image: null,
        thumbnail: { url: 'https://example.com/thumb.png' },
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(1);
    expect(result![0].url).toBe('https://example.com/thumb.png');
    expect(result![0].name).toBe('embed-thumbnail-1.png');
  });

  it('should extract both image and thumbnail from same embed', () => {
    const embeds = [
      {
        image: { url: 'https://example.com/image.png' },
        thumbnail: { url: 'https://example.com/thumb.png' },
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(2);
    expect(result![0].url).toBe('https://example.com/image.png');
    expect(result![0].name).toBe('embed-image-1.png');
    expect(result![1].url).toBe('https://example.com/thumb.png');
    expect(result![1].name).toBe('embed-thumbnail-2.png');
  });

  it('should extract images from multiple embeds', () => {
    const embeds = [
      {
        image: { url: 'https://example.com/image1.png' },
        thumbnail: null,
      },
      {
        image: { url: 'https://example.com/image2.png' },
        thumbnail: null,
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(2);
    expect(result![0].url).toBe('https://example.com/image1.png');
    expect(result![0].name).toBe('embed-image-1.png');
    expect(result![1].url).toBe('https://example.com/image2.png');
    expect(result![1].name).toBe('embed-image-2.png');
  });

  it('should return undefined when embeds have no images', () => {
    const embeds = [
      {
        image: null,
        thumbnail: null,
        title: 'Just a text embed',
      },
    ] as unknown as Embed[];

    expect(extractEmbedImages(embeds)).toBeUndefined();
  });

  it('should skip embeds with empty image URLs', () => {
    const embeds = [
      {
        image: { url: '' },
        thumbnail: null,
      },
    ] as unknown as Embed[];

    expect(extractEmbedImages(embeds)).toBeUndefined();
  });

  it('should skip embeds with undefined image property', () => {
    const embeds = [
      {
        image: undefined,
        thumbnail: undefined,
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
      },
      {
        image: { url: 'https://example.com/image.png' },
        thumbnail: null,
      },
      {
        image: null,
        thumbnail: null,
        description: 'Another text embed',
      },
    ] as unknown as Embed[];

    const result = extractEmbedImages(embeds);

    expect(result).toHaveLength(1);
    expect(result![0].url).toBe('https://example.com/image.png');
  });
});
