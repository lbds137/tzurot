/**
 * Transcribe API Input Schema Tests
 *
 * Validates schemas for transcribe endpoint request bodies.
 */

import { describe, it, expect } from 'vitest';
import { TranscribeRequestSchema } from './transcribe.js';

describe('TranscribeRequestSchema', () => {
  it('should accept valid single attachment', () => {
    const result = TranscribeRequestSchema.safeParse({
      attachments: [{ url: 'https://cdn.example.com/audio.ogg', contentType: 'audio/ogg' }],
    });
    expect(result.success).toBe(true);
  });

  it('should accept attachment with optional fields', () => {
    const result = TranscribeRequestSchema.safeParse({
      attachments: [
        {
          url: 'https://cdn.example.com/audio.ogg',
          contentType: 'audio/ogg',
          name: 'recording.ogg',
          size: 12345,
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attachments[0].name).toBe('recording.ogg');
      expect(result.data.attachments[0].size).toBe(12345);
    }
  });

  it('should accept multiple attachments', () => {
    const result = TranscribeRequestSchema.safeParse({
      attachments: [
        { url: 'https://cdn.example.com/a.ogg', contentType: 'audio/ogg' },
        { url: 'https://cdn.example.com/b.mp3', contentType: 'audio/mp3' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attachments).toHaveLength(2);
    }
  });

  it('should reject empty attachments array', () => {
    const result = TranscribeRequestSchema.safeParse({ attachments: [] });
    expect(result.success).toBe(false);
  });

  it('should reject missing attachments', () => {
    const result = TranscribeRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject attachment with empty url', () => {
    const result = TranscribeRequestSchema.safeParse({
      attachments: [{ url: '', contentType: 'audio/ogg' }],
    });
    expect(result.success).toBe(false);
  });

  it('should reject attachment with empty contentType', () => {
    const result = TranscribeRequestSchema.safeParse({
      attachments: [{ url: 'https://cdn.example.com/audio.ogg', contentType: '' }],
    });
    expect(result.success).toBe(false);
  });

  it('should reject attachment with missing url', () => {
    const result = TranscribeRequestSchema.safeParse({
      attachments: [{ contentType: 'audio/ogg' }],
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer size', () => {
    const result = TranscribeRequestSchema.safeParse({
      attachments: [
        { url: 'https://cdn.example.com/audio.ogg', contentType: 'audio/ogg', size: 1.5 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative size', () => {
    const result = TranscribeRequestSchema.safeParse({
      attachments: [
        { url: 'https://cdn.example.com/audio.ogg', contentType: 'audio/ogg', size: -1 },
      ],
    });
    expect(result.success).toBe(false);
  });
});
