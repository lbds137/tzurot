import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tzurot/common-types', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  VOICE_REFERENCE_LIMITS: {
    MAX_SIZE: 10 * 1024 * 1024,
    ALLOWED_TYPES: ['audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/flac'],
  },
}));

vi.mock('./errorResponses.js', () => ({
  ErrorResponses: {
    validationError: vi.fn((message: string) => ({ error: 'Validation Error', message })),
    processingError: vi.fn((message: string) => ({ error: 'Processing Error', message })),
  },
}));

import { processVoiceReferenceData } from './voiceReferenceProcessor.js';

describe('processVoiceReferenceData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when data is undefined', () => {
    const result = processVoiceReferenceData(undefined, 'test-slug');
    expect(result).toBeNull();
  });

  it('returns null when data is empty string', () => {
    const result = processVoiceReferenceData('', 'test-slug');
    expect(result).toBeNull();
  });

  it('returns error for invalid data URI format', () => {
    const result = processVoiceReferenceData('not-a-data-uri', 'test-slug');
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (result !== null && !result.ok) {
      expect(result.error.message).toContain('base64 data URI');
    }
  });

  it('returns error for unsupported MIME type', () => {
    const result = processVoiceReferenceData('data:image/png;base64,iVBORw0KGgo=', 'test-slug');
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (result !== null && !result.ok) {
      expect(result.error.message).toContain('Unsupported audio type');
      expect(result.error.message).toContain('image/png');
    }
  });

  it('returns success for valid WAV data URI', () => {
    const audioBytes = Buffer.from('fake-wav-audio-data');
    const base64 = audioBytes.toString('base64');
    const dataUri = `data:audio/wav;base64,${base64}`;

    const result = processVoiceReferenceData(dataUri, 'my-persona');
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    if (result !== null && result.ok) {
      expect(result.buffer).toEqual(audioBytes);
      expect(result.mimeType).toBe('audio/wav');
    }
  });

  it('returns success for valid MP3 data URI', () => {
    const audioBytes = Buffer.from('fake-mp3-data');
    const base64 = audioBytes.toString('base64');
    const dataUri = `data:audio/mpeg;base64,${base64}`;

    const result = processVoiceReferenceData(dataUri, 'test');
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    if (result !== null && result.ok) {
      expect(result.mimeType).toBe('audio/mpeg');
    }
  });

  it('returns success for valid OGG data URI', () => {
    const audioBytes = Buffer.from('fake-ogg-data');
    const base64 = audioBytes.toString('base64');
    const dataUri = `data:audio/ogg;base64,${base64}`;

    const result = processVoiceReferenceData(dataUri, 'test');
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    if (result !== null && result.ok) {
      expect(result.mimeType).toBe('audio/ogg');
    }
  });

  it('returns success for valid FLAC data URI', () => {
    const audioBytes = Buffer.from('fake-flac-data');
    const base64 = audioBytes.toString('base64');
    const dataUri = `data:audio/flac;base64,${base64}`;

    const result = processVoiceReferenceData(dataUri, 'test');
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    if (result !== null && result.ok) {
      expect(result.mimeType).toBe('audio/flac');
    }
  });

  it('returns error when audio exceeds max size', () => {
    // Create a buffer that exceeds 10MB
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024);
    const base64 = largeBuffer.toString('base64');
    const dataUri = `data:audio/wav;base64,${base64}`;

    const result = processVoiceReferenceData(dataUri, 'test-slug');
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (result !== null && !result.ok) {
      expect(result.error.message).toContain('too large');
      expect(result.error.message).toContain('10MB');
    }
  });

  it('accepts audio at exactly max size', () => {
    const exactBuffer = Buffer.alloc(10 * 1024 * 1024);
    const base64 = exactBuffer.toString('base64');
    const dataUri = `data:audio/wav;base64,${base64}`;

    const result = processVoiceReferenceData(dataUri, 'test-slug');
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
  });
});
