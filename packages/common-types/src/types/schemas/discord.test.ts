import { describe, it, expect } from 'vitest';
import { attachmentMetadataSchema, type AttachmentMetadata } from './discord.js';

describe('attachmentMetadataSchema — provenance flag survival', () => {
  const base = {
    url: 'https://cdn.discordapp.com/attachments/1/2/photo.png',
    contentType: 'image/png',
  } satisfies AttachmentMetadata;

  it('survives isEmbedPreview: true through safeParse (Zod strips undeclared keys, so this pins the declaration)', () => {
    const fixture = { ...base, isEmbedPreview: true } satisfies AttachmentMetadata;
    const result = attachmentMetadataSchema.safeParse(fixture);
    expect(result.success).toBe(true);
    expect(result.data?.isEmbedPreview).toBe(true);
  });

  it('survives isSticker: true through safeParse', () => {
    const fixture = { ...base, isSticker: true } satisfies AttachmentMetadata;
    const result = attachmentMetadataSchema.safeParse(fixture);
    expect(result.success).toBe(true);
    expect(result.data?.isSticker).toBe(true);
  });

  it('parses an ordinary attachment with both provenance flags absent', () => {
    const result = attachmentMetadataSchema.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.data?.isSticker).toBeUndefined();
    expect(result.data?.isEmbedPreview).toBeUndefined();
  });
});
