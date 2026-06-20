import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockValidateAttachmentUrl,
  mockValidateExternalImageUrl,
  mockFetchAttachmentBytes,
  mockFetchExternalImageBytes,
  mockResizeImageIfNeeded,
  mockBufferToDataUrl,
} = vi.hoisted(() => ({
  mockValidateAttachmentUrl: vi.fn(),
  mockValidateExternalImageUrl: vi.fn(),
  mockFetchAttachmentBytes: vi.fn(),
  mockFetchExternalImageBytes: vi.fn(),
  mockResizeImageIfNeeded: vi.fn(),
  mockBufferToDataUrl: vi.fn(),
}));

// Mock the leaf fetch/transform primitives; keep the real HttpError /
// AttachmentTooLargeError / MAX_ATTACHMENT_BYTES so the retry guards work.
vi.mock('./attachmentFetch.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./attachmentFetch.js')>();
  return {
    ...actual,
    validateAttachmentUrl: mockValidateAttachmentUrl,
    fetchAttachmentBytes: mockFetchAttachmentBytes,
    resizeImageIfNeeded: mockResizeImageIfNeeded,
    bufferToDataUrl: mockBufferToDataUrl,
  };
});
vi.mock('./safeExternalFetch.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./safeExternalFetch.js')>();
  return {
    ...actual,
    validateExternalImageUrl: mockValidateExternalImageUrl,
    fetchExternalImageBytes: mockFetchExternalImageBytes,
  };
});

import { routeImageUrl, downloadImageToDataUrl } from './imageToDataUrl.js';
import { HttpError, AttachmentTooLargeError } from './attachmentFetch.js';

// Project standard: fake timers everywhere so the single retry's backoff
// `setTimeout` never depends on real wall-clock — the retry test advances it
// explicitly via `runAllTimersAsync`.
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('routeImageUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes a valid Discord CDN url as non-external', () => {
    mockValidateAttachmentUrl.mockReturnValue('https://cdn.discordapp.com/x.png');

    expect(routeImageUrl('https://cdn.discordapp.com/x.png')).toEqual({
      sanitizedUrl: 'https://cdn.discordapp.com/x.png',
      isExternal: false,
    });
    expect(mockValidateExternalImageUrl).not.toHaveBeenCalled();
  });

  it('falls through to the external path ONLY on an allowlist miss', () => {
    mockValidateAttachmentUrl.mockImplementation(() => {
      throw new Error('Invalid attachment URL: must be from Discord CDN (cdn.discordapp.com, ...)');
    });
    mockValidateExternalImageUrl.mockReturnValue('https://i.redd.it/x.jpg');

    expect(routeImageUrl('https://i.redd.it/x.jpg')).toEqual({
      sanitizedUrl: 'https://i.redd.it/x.jpg',
      isExternal: true,
    });
  });

  it('propagates non-allowlist validation errors without trying the external path', () => {
    mockValidateAttachmentUrl.mockImplementation(() => {
      throw new Error('Invalid attachment URL: embedded credentials are not allowed');
    });

    // The URL is irrelevant here — the mocked validator decides the error; a
    // literal `user:pass@` would trip secretlint's basic-auth rule for nothing.
    expect(() => routeImageUrl('https://blocked.example/x')).toThrow('credentials');
    expect(mockValidateExternalImageUrl).not.toHaveBeenCalled();
  });
});

describe('downloadImageToDataUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResizeImageIfNeeded.mockResolvedValue({
      buffer: Buffer.from('resized'),
      contentType: 'image/jpeg',
    });
    mockBufferToDataUrl.mockReturnValue('data:image/jpeg;base64,cmVzaXplZA==');
  });

  it('Discord url → fetchAttachmentBytes → resize → base64', async () => {
    mockValidateAttachmentUrl.mockReturnValue('https://cdn.discordapp.com/x.png');
    mockFetchAttachmentBytes.mockResolvedValue(Buffer.from('raw'));

    const result = await downloadImageToDataUrl('https://cdn.discordapp.com/x.png', {
      contentType: 'image/png',
    });

    expect(mockFetchAttachmentBytes).toHaveBeenCalledTimes(1);
    expect(mockFetchExternalImageBytes).not.toHaveBeenCalled();
    expect(result.dataUrl).toBe('data:image/jpeg;base64,cmVzaXplZA==');
    expect(result.bytes).toBe(Buffer.from('resized').byteLength);
  });

  it('external url → fetchExternalImageBytes (allowlist fall-through)', async () => {
    mockValidateAttachmentUrl.mockImplementation(() => {
      throw new Error('must be from Discord CDN');
    });
    mockValidateExternalImageUrl.mockReturnValue('https://i.redd.it/x.jpg');
    mockFetchExternalImageBytes.mockResolvedValue(Buffer.from('raw'));

    await downloadImageToDataUrl('https://i.redd.it/x.jpg');

    expect(mockFetchExternalImageBytes).toHaveBeenCalledTimes(1);
    expect(mockFetchAttachmentBytes).not.toHaveBeenCalled();
  });

  it('retries once on a transient fetch error', async () => {
    mockValidateAttachmentUrl.mockReturnValue('https://cdn.discordapp.com/x.png');
    mockFetchAttachmentBytes
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(Buffer.from('raw'));

    const promise = downloadImageToDataUrl('https://cdn.discordapp.com/x.png', {
      retryDelayMs: 0,
    });
    await vi.runAllTimersAsync(); // drive the backoff setTimeout under fake timers
    await promise;

    expect(mockFetchAttachmentBytes).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on a 403 (expired-URL signal)', async () => {
    mockValidateAttachmentUrl.mockReturnValue('https://cdn.discordapp.com/x.png');
    mockFetchAttachmentBytes.mockRejectedValue(new HttpError(403, 'Forbidden'));

    await expect(
      downloadImageToDataUrl('https://cdn.discordapp.com/x.png', { retryDelayMs: 0 })
    ).rejects.toBeInstanceOf(HttpError);
    expect(mockFetchAttachmentBytes).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on an over-size error', async () => {
    mockValidateAttachmentUrl.mockReturnValue('https://cdn.discordapp.com/x.png');
    mockFetchAttachmentBytes.mockRejectedValue(new AttachmentTooLargeError(999, 1));

    await expect(
      downloadImageToDataUrl('https://cdn.discordapp.com/x.png', { retryDelayMs: 0 })
    ).rejects.toBeInstanceOf(AttachmentTooLargeError);
    expect(mockFetchAttachmentBytes).toHaveBeenCalledTimes(1);
  });
});
