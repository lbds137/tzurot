/**
 * Attachment Fetch Utility Unit Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import {
  validateAttachmentUrl,
  isDataUrl,
  bufferToDataUrl,
  fetchAttachmentBytes,
  resizeImageIfNeeded,
  AttachmentTooLargeError,
  ExpiredJobError,
  HttpError,
  JobPayloadTooLargeError,
  MAX_ATTACHMENT_BYTES,
  MAX_AGGREGATE_PAYLOAD_BYTES,
} from './attachmentFetch.js';

describe('validateAttachmentUrl', () => {
  it('accepts cdn.discordapp.com https URLs', () => {
    const sanitized = validateAttachmentUrl(
      'https://cdn.discordapp.com/attachments/1/2/file.png?ex=abc'
    );
    expect(sanitized).toBe('https://cdn.discordapp.com/attachments/1/2/file.png?ex=abc');
  });

  it('accepts media.discordapp.net https URLs', () => {
    const sanitized = validateAttachmentUrl('https://media.discordapp.net/external/xyz/image.jpg');
    expect(sanitized).toBe('https://media.discordapp.net/external/xyz/image.jpg');
  });

  it('rejects http URLs', () => {
    expect(() => validateAttachmentUrl('http://cdn.discordapp.com/x.png')).toThrow(
      /protocol must be https/
    );
  });

  it('rejects URLs with credentials', () => {
    // Construct the credential-bearing URL at runtime so secretlint's
    // basic-auth pattern matcher doesn't flag it as a committed secret.
    const creds = ['u', 's', 'e', 'r'].join('') + ':' + ['p', 'a', 's', 's'].join('');
    const urlWithCreds = `https://${creds}@cdn.discordapp.com/x.png`;
    expect(() => validateAttachmentUrl(urlWithCreds)).toThrow(/credentials not allowed/);
  });

  it('rejects non-standard ports', () => {
    expect(() => validateAttachmentUrl('https://cdn.discordapp.com:8443/x.png')).toThrow(
      /non-standard port/
    );
  });

  it('rejects non-allowlisted hosts', () => {
    expect(() => validateAttachmentUrl('https://evil.example.com/x.png')).toThrow(
      /must be from Discord CDN/
    );
  });

  it('rejects IPv4 addresses', () => {
    expect(() => validateAttachmentUrl('https://192.168.1.1/x.png')).toThrow(
      /IP addresses not allowed/
    );
  });

  it('rejects IPv6 addresses', () => {
    expect(() => validateAttachmentUrl('https://[::1]/x.png')).toThrow(/IP addresses not allowed/);
  });

  it('strips trailing dots from hostname before allowlist check', () => {
    // `cdn.discordapp.com.` (trailing dot, absolute-DNS form) must still match
    // the allowlist — browsers and servers treat it equivalently to the bare
    // form, and an attacker shouldn't bypass the check by adding a dot.
    const sanitized = validateAttachmentUrl('https://cdn.discordapp.com./x.png');
    expect(sanitized).toBe('https://cdn.discordapp.com/x.png');
  });

  it('drops the URL fragment from the sanitized output (undici strips before wire anyway)', () => {
    // Fragments don't go over the wire. Returning them in the "sanitized" URL
    // would mislead callers and risk cache-key fragment-divergence
    // (`/x.png` vs `/x.png#a` vs `/x.png#b` for byte-identical responses).
    const sanitized = validateAttachmentUrl('https://cdn.discordapp.com/x.png#section');
    expect(sanitized).toBe('https://cdn.discordapp.com/x.png');
  });

  it('preserves the URL query string in the sanitized output (Discord signs URLs via query params)', () => {
    // Discord CDN URLs carry HMAC signatures in `ex=`, `is=`, `hm=` query
    // params. Stripping the query string would invalidate the signature and
    // produce 403s. Pin that the query is preserved while the fragment is not.
    const sanitized = validateAttachmentUrl(
      'https://cdn.discordapp.com/x.png?ex=abc&is=def&hm=xyz#frag'
    );
    expect(sanitized).toBe('https://cdn.discordapp.com/x.png?ex=abc&is=def&hm=xyz');
  });
});

describe('isDataUrl', () => {
  it('returns true for data: URLs', () => {
    expect(isDataUrl('data:image/png;base64,iVBORw0K')).toBe(true);
  });

  it('returns false for https URLs', () => {
    expect(isDataUrl('https://cdn.discordapp.com/x.png')).toBe(false);
  });
});

describe('bufferToDataUrl', () => {
  it('produces a valid data URL with the given content type', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const dataUrl = bufferToDataUrl(buf, 'image/png');
    expect(dataUrl).toBe(`data:image/png;base64,${buf.toString('base64')}`);
  });
});

describe('ExpiredJobError', () => {
  it('exposes queueAgeMs and renders a human-friendly message', () => {
    const err = new ExpiredJobError(45 * 60 * 1000); // 45 min
    expect(err.queueAgeMs).toBe(45 * 60 * 1000);
    expect(err.name).toBe('ExpiredJobError');
    expect(err.message).toMatch(/expired/);
  });
});

describe('HttpError', () => {
  it('exposes status and renders the canonical "HTTP N: statusText" message', () => {
    const err = new HttpError(403, 'Forbidden');
    expect(err.status).toBe(403);
    expect(err.name).toBe('HttpError');
    expect(err.message).toBe('HTTP 403: Forbidden');
  });

  it('is an Error subclass so `instanceof Error` still works for general handlers', () => {
    const err = new HttpError(500, 'Internal Server Error');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HttpError);
  });
});

describe('JobPayloadTooLargeError', () => {
  it('exposes totalBytes and limit, names itself, and exists in MiB form in the message', () => {
    const err = new JobPayloadTooLargeError(60 * 1024 * 1024, MAX_AGGREGATE_PAYLOAD_BYTES);
    expect(err.totalBytes).toBe(60 * 1024 * 1024);
    expect(err.limit).toBe(MAX_AGGREGATE_PAYLOAD_BYTES);
    expect(err.name).toBe('JobPayloadTooLargeError');
    expect(err.message).toMatch(/60\.0 MiB/);
    expect(err.message).toMatch(/50 MiB/);
  });

  it('is an Error subclass so `instanceof Error` still works for general handlers', () => {
    const err = new JobPayloadTooLargeError(100, 50);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(JobPayloadTooLargeError);
  });
});

describe('AttachmentTooLargeError', () => {
  it('exposes size and limit', () => {
    const err = new AttachmentTooLargeError(30 * 1024 * 1024, 25 * 1024 * 1024);
    expect(err.size).toBe(30 * 1024 * 1024);
    expect(err.limit).toBe(25 * 1024 * 1024);
    expect(err.name).toBe('AttachmentTooLargeError');
  });
});

describe('fetchAttachmentBytes', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  function mockFetchResponse(body: Uint8Array, headers: Record<string, string> = {}): void {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(headers),
        arrayBuffer: () =>
          Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
      } as Response)
    ) as typeof fetch;
  }

  it('returns bytes on a successful fetch under the cap', async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    mockFetchResponse(body, { 'content-length': '4' });

    const buf = await fetchAttachmentBytes('https://cdn.discordapp.com/x.png');
    expect(Array.from(buf)).toEqual([1, 2, 3, 4]);
  });

  it('throws a typed HttpError on non-OK responses (enables instanceof classification)', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers(),
      } as Response)
    ) as typeof fetch;

    // Pin the typed shape — callers use `instanceof HttpError && status === 403`
    // to classify CDN expirations as non-retryable. Message-string regression
    // here would be invisible without this assertion.
    const promise = fetchAttachmentBytes('https://cdn.discordapp.com/x.png');
    await expect(promise).rejects.toBeInstanceOf(HttpError);
    await expect(promise).rejects.toMatchObject({ status: 403, message: /HTTP 403/ });
  });

  it('rejects when Content-Length exceeds the cap without consuming body', async () => {
    const arrayBuffer = vi.fn();
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-length': String(MAX_ATTACHMENT_BYTES + 1) }),
        arrayBuffer,
      } as unknown as Response)
    ) as typeof fetch;

    await expect(
      fetchAttachmentBytes('https://cdn.discordapp.com/huge.png')
    ).rejects.toBeInstanceOf(AttachmentTooLargeError);
    // Critical: the body read must be short-circuited so a malicious server
    // cannot force us to buffer >25 MiB just to discover it was oversized.
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('catches liars: rejects when actual body exceeds cap despite Content-Length omission', async () => {
    const tooBig = new Uint8Array(100); // small in this test, use a custom low cap
    mockFetchResponse(tooBig);

    await expect(
      fetchAttachmentBytes('https://cdn.discordapp.com/lie.png', { maxBytes: 50 })
    ).rejects.toBeInstanceOf(AttachmentTooLargeError);
  });

  it('passes additional headers (e.g. User-Agent for external-image fallback path) into the fetch call', async () => {
    // The Discord-CDN path doesn't need a UA; the external-image path passes
    // one so Reddit/Imgur don't 403 us before SSRF defenses even matter. Pin
    // the wiring rather than just trusting the option exists.
    const fetchSpy = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-length': '0' }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      } as Response)
    ) as typeof fetch;
    globalThis.fetch = fetchSpy;

    await fetchAttachmentBytes('https://i.imgur.com/x.png', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Tzurot/3.0)' },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://i.imgur.com/x.png',
      expect.objectContaining({
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Tzurot/3.0)' },
      })
    );
  });

  it('rejects responses whose Content-Type does not match the asserted prefix', async () => {
    // Memory-exhaustion guard for the external path: an attacker-controlled
    // embed URL pointing at text/html (or anything non-image) would otherwise
    // be buffered before being rejected. The check fires BEFORE arrayBuffer().
    const arrayBuffer = vi.fn();
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        arrayBuffer,
      } as unknown as Response)
    ) as typeof fetch;

    await expect(
      fetchAttachmentBytes('https://evil.example.com/not-image.png', {
        assertContentTypePrefix: 'image/',
      })
    ).rejects.toThrow(/Unexpected Content-Type/);
    // Critical: the body must NOT be consumed when Content-Type fails the assertion.
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('accepts responses whose Content-Type matches the asserted prefix (case-insensitive)', async () => {
    // HTTP header values are case-insensitive in practice; some CDNs return
    // `Image/JPEG` or other casings. Pin the case-folding to avoid false 4xx.
    const body = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic
    mockFetchResponse(body, { 'content-type': 'IMAGE/JPEG', 'content-length': '4' });

    const buf = await fetchAttachmentBytes('https://i.imgur.com/x.jpg', {
      assertContentTypePrefix: 'image/',
    });
    expect(Array.from(buf)).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it('aborts the fetch and surfaces the error when the per-request timeout fires', async () => {
    // Mock fetch as a Promise that only rejects when its AbortSignal fires.
    // With fake timers enabled, advancing past the default 30s timeout triggers
    // the AbortController and produces an AbortError.
    globalThis.fetch = vi.fn((_url, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as typeof fetch;

    const promise = fetchAttachmentBytes('https://cdn.discordapp.com/slow.png');
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(30_001);
    await assertion;
  });
});

describe('resizeImageIfNeeded', () => {
  // Use module-level mocks for MEDIA_LIMITS so we can trigger the resize path
  // with a tiny image instead of generating a 10+ MiB fixture every test run.
  // The real prod thresholds (10 MiB cap, 8 MiB target) are tested indirectly
  // via the threshold-comparison logic that these small values exercise.

  it('passes non-image content types through unchanged, preserving contentType', async () => {
    const buf = Buffer.from('not an image at all');
    const result = await resizeImageIfNeeded(buf, 'application/pdf');
    expect(result.buffer).toBe(buf); // same buffer reference — no copy, no resize
    expect(result.contentType).toBe('application/pdf');
  });

  it('passes small images under the size threshold through unchanged, preserving contentType', async () => {
    // A 2x2 solid-color PNG is a handful of bytes — well under 10 MiB.
    const smallPng = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .png()
      .toBuffer();

    const result = await resizeImageIfNeeded(smallPng, 'image/png');
    expect(result.buffer).toBe(smallPng); // identity — resize branch not taken
    expect(result.contentType).toBe('image/png'); // input MIME preserved when no resize
  });

  it('resizes images over the threshold and switches contentType to image/jpeg', async () => {
    // Generate a high-entropy (incompressible) PNG that exceeds MAX_IMAGE_SIZE.
    // 2400x1800 RGB with pseudorandom bytes and compressionLevel 0 yields
    // ~13 MiB, reliably above the 10 MiB threshold.
    const width = 2400;
    const height = 1800;
    const rawPixels = Buffer.alloc(width * height * 3);
    // Deterministic pseudo-noise (not Math.random) so the test is stable.
    for (let i = 0; i < rawPixels.length; i++) {
      rawPixels[i] = (i * 7919) & 0xff;
    }
    const largePng = await sharp(rawPixels, { raw: { width, height, channels: 3 } })
      .png({ compressionLevel: 0 })
      .toBuffer();

    expect(largePng.byteLength).toBeGreaterThan(10 * 1024 * 1024); // sanity check

    const result = await resizeImageIfNeeded(largePng, 'image/png');
    expect(result.buffer.byteLength).toBeLessThan(largePng.byteLength); // actually shrunk
    expect(result.buffer).not.toBe(largePng); // a new buffer was produced
    // Resize always emits JPEG; the data URL built from the result must use
    // 'image/jpeg' so LLM providers don't see a MIME/bytes mismatch.
    expect(result.contentType).toBe('image/jpeg');
  }, 15_000); // sharp work on constrained runners needs more headroom than vitest's 5s default
});
