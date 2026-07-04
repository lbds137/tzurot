import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeoutError } from '@tzurot/common-types/utils/errors';

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: vi.fn(),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { getConfig } from '@tzurot/common-types/config/config';
import { fetchVoiceReference, parseAudioDurationSec } from './voiceReferenceHelper.js';

/**
 * Build a minimal valid WAV buffer for tests. Returns a buffer with correct
 * RIFF + fmt + data chunks at the supplied parameters.
 */
function makeWavBuffer(opts: {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
}): Buffer {
  const { sampleRate, channels, bitsPerSample, dataBytes } = opts;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM fmt subchunk size
  buf.writeUInt16LE(1, 20); // audioFormat = PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28); // byteRate
  buf.writeUInt16LE(channels * (bitsPerSample / 8), 32); // blockAlign
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

const mockedGetConfig = vi.mocked(getConfig);

describe('fetchVoiceReference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetConfig.mockReturnValue({
      GATEWAY_URL: 'http://localhost:3000',
      INTERNAL_SERVICE_SECRET: 'test-secret',
    } as ReturnType<typeof getConfig>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns audioBuffer and contentType on successful fetch', async () => {
    const fakeAudio = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // RIFF header
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeAudio.buffer),
      headers: new Headers({ 'content-type': 'audio/mpeg' }),
    });

    const result = await fetchVoiceReference('test-slug');

    expect(result.audioBuffer).toBeInstanceOf(Buffer);
    expect(result.audioBuffer.length).toBe(4);
    expect(result.contentType).toBe('audio/mpeg');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/voice-references/test-slug',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        headers: { 'X-Service-Auth': 'test-secret' },
      })
    );
  });

  it('throws when GATEWAY_URL is undefined', async () => {
    mockedGetConfig.mockReturnValue({ INTERNAL_SERVICE_SECRET: 'test-secret' } as ReturnType<
      typeof getConfig
    >);

    await expect(fetchVoiceReference('test-slug')).rejects.toThrow(
      'GATEWAY_URL not configured — cannot fetch voice reference'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when INTERNAL_SERVICE_SECRET is undefined (fail-fast on misconfiguration)', async () => {
    // The /voice-references route is service-auth-protected. Missing
    // secret means every fetch would 403; failing here surfaces the
    // misconfiguration as a clear error at the call site rather than
    // letting api-gateway respond with a generic auth rejection.
    mockedGetConfig.mockReturnValue({ GATEWAY_URL: 'http://localhost:3000' } as ReturnType<
      typeof getConfig
    >);

    await expect(fetchVoiceReference('test-slug')).rejects.toThrow(
      'INTERNAL_SERVICE_SECRET not configured'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when INTERNAL_SERVICE_SECRET is empty string', async () => {
    mockedGetConfig.mockReturnValue({
      GATEWAY_URL: 'http://localhost:3000',
      INTERNAL_SERVICE_SECRET: '',
    } as ReturnType<typeof getConfig>);

    await expect(fetchVoiceReference('test-slug')).rejects.toThrow(
      'INTERNAL_SERVICE_SECRET not configured'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws typed TimeoutError on AbortSignal timeout', async () => {
    // AbortSignal.timeout() throws a DOMException with name 'TimeoutError'
    const timeoutError = new DOMException('The operation timed out', 'TimeoutError');
    mockFetch.mockRejectedValue(timeoutError);

    const error = await fetchVoiceReference('test-slug').catch(e => e);

    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).timeoutMs).toBe(15_000);
    expect((error as TimeoutError).operationName).toBe('voice reference fetch for "test-slug"');
    expect((error as TimeoutError).cause).toBe(timeoutError);
  });

  it('re-throws non-abort fetch errors', async () => {
    const networkError = new Error('ECONNREFUSED');
    mockFetch.mockRejectedValue(networkError);

    await expect(fetchVoiceReference('test-slug')).rejects.toThrow('ECONNREFUSED');
  });

  it('throws on non-ok response (404)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(fetchVoiceReference('test-slug')).rejects.toThrow(
      'Failed to fetch voice reference for "test-slug": 404 Not Found'
    );
  });

  it('throws on non-ok response (500)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(fetchVoiceReference('test-slug')).rejects.toThrow(
      'Failed to fetch voice reference for "test-slug": 500 Internal Server Error'
    );
  });

  it('falls back to audio/wav when content-type header is null', async () => {
    const fakeAudio = new Uint8Array([0x00, 0x01]);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeAudio.buffer),
      headers: new Headers(), // No content-type
    });

    const result = await fetchVoiceReference('test-slug');

    expect(result.contentType).toBe('audio/wav');
  });

  it('encodes slug with special characters in URL', async () => {
    const fakeAudio = new Uint8Array([0x00]);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeAudio.buffer),
      headers: new Headers({ 'content-type': 'audio/wav' }),
    });

    await fetchVoiceReference('slug with spaces/and../traversal');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/voice-references/slug%20with%20spaces%2Fand..%2Ftraversal',
      expect.any(Object)
    );
  });

  it('returns durationSec for WAV reference audio', async () => {
    // 16 kHz mono 16-bit, 2.5s of audio = 16000 * 2 * 2.5 = 80000 data bytes
    const wav = makeWavBuffer({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      dataBytes: 80000,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength)),
      headers: new Headers({ 'content-type': 'audio/wav' }),
    });

    const result = await fetchVoiceReference('test-slug');

    expect(result.durationSec).toBeCloseTo(2.5, 5);
  });

  it('returns undefined durationSec for non-WAV content type without RIFF magic', async () => {
    const fakeAudio = Buffer.from([0xff, 0xfb, 0x90, 0x00]); // mp3-shaped bytes
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(
          fakeAudio.buffer.slice(fakeAudio.byteOffset, fakeAudio.byteOffset + fakeAudio.byteLength)
        ),
      headers: new Headers({ 'content-type': 'audio/mpeg' }),
    });

    const result = await fetchVoiceReference('test-slug');

    expect(result.durationSec).toBeUndefined();
  });
});

describe('parseAudioDurationSec', () => {
  it('computes duration from valid WAV at 16kHz mono 16-bit', () => {
    // 30 seconds = 16000 samples/s * 1 channel * 2 bytes/sample * 30 = 960000 bytes
    const wav = makeWavBuffer({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      dataBytes: 960000,
    });
    expect(parseAudioDurationSec(wav, 'audio/wav')).toBeCloseTo(30, 5);
  });

  it('handles 31.78s reference (the prod incident shape)', () => {
    // Recreating the ha-shem-keev-ima case: 31.78s at 16kHz mono 16-bit
    const sampleRate = 16000;
    const dataBytes = Math.round(sampleRate * 1 * 2 * 31.78);
    const wav = makeWavBuffer({
      sampleRate,
      channels: 1,
      bitsPerSample: 16,
      dataBytes,
    });
    const duration = parseAudioDurationSec(wav, 'audio/wav');
    expect(duration).toBeDefined();
    expect(duration).toBeGreaterThan(30);
    expect(duration).toBeCloseTo(31.78, 1);
  });

  it('handles stereo 44.1kHz 24-bit', () => {
    // 5 seconds at 44100Hz stereo 24-bit = 44100 * 2 * 3 * 5 = 1323000 bytes
    const wav = makeWavBuffer({
      sampleRate: 44100,
      channels: 2,
      bitsPerSample: 24,
      dataBytes: 1323000,
    });
    expect(parseAudioDurationSec(wav, 'audio/wav')).toBeCloseTo(5, 5);
  });

  it('detects WAV via RIFF magic when content-type is generic', () => {
    const wav = makeWavBuffer({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      dataBytes: 32000, // 1 second
    });
    expect(parseAudioDurationSec(wav, 'application/octet-stream')).toBeCloseTo(1, 5);
  });

  it('returns undefined for non-WAV content without RIFF/WAVE magic', () => {
    const notWav = Buffer.from([
      0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(parseAudioDurationSec(notWav, 'audio/mpeg')).toBeUndefined();
  });

  it('returns undefined for buffer too short to contain RIFF header', () => {
    const tooShort = Buffer.from([0x52, 0x49]); // partial "RI"
    expect(parseAudioDurationSec(tooShort, 'audio/wav')).toBeUndefined();
  });

  it('returns undefined when fmt chunk is missing', () => {
    // RIFF + WAVE header but no fmt or data chunk
    const buf = Buffer.alloc(12);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(4, 4);
    buf.write('WAVE', 8);
    expect(parseAudioDurationSec(buf, 'audio/wav')).toBeUndefined();
  });

  it('returns undefined when byteRate is zero (corrupted fmt)', () => {
    const wav = makeWavBuffer({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      dataBytes: 100,
    });
    // Corrupt: zero out byteRate (file offset 28, 4 bytes — fmt chunk dataStart=20, +8 = 28)
    wav.writeUInt32LE(0, 28);
    expect(parseAudioDurationSec(wav, 'audio/wav')).toBeUndefined();
  });

  it('returns undefined when fmt chunk is truncated (header claims 16 bytes but buffer ends short)', () => {
    // RIFF + WAVE + fmt header but the fmt subchunk extends past buffer end
    const buf = Buffer.alloc(20);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(12, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16); // claims 16 bytes of fmt payload, but buffer ends here
    expect(parseAudioDurationSec(buf, 'audio/wav')).toBeUndefined();
  });

  it('handles word-aligned odd-size chunks before fmt (RIFF padding)', () => {
    // Build a buffer with a JUNK chunk (odd size = 5) before fmt, exercising
    // the +1 padding branch on `chunkSize % 2`. The walker should skip JUNK,
    // honor the padding, and reach fmt + data correctly.
    const junkPayload = 5;
    const junkPadding = 1; // odd → +1 word-align byte
    const fmtSize = 16;
    const dataSize = 32000;
    const buf = Buffer.alloc(12 + 8 + junkPayload + junkPadding + 8 + fmtSize + 8 + dataSize);

    let off = 0;
    buf.write('RIFF', off);
    off += 4;
    buf.writeUInt32LE(buf.length - 8, off);
    off += 4;
    buf.write('WAVE', off);
    off += 4;

    // JUNK chunk with odd payload size
    buf.write('JUNK', off);
    off += 4;
    buf.writeUInt32LE(junkPayload, off);
    off += 4;
    off += junkPayload + junkPadding;

    // fmt chunk
    buf.write('fmt ', off);
    off += 4;
    buf.writeUInt32LE(fmtSize, off);
    off += 4;
    buf.writeUInt16LE(1, off); // audioFormat
    buf.writeUInt16LE(1, off + 2); // channels
    buf.writeUInt32LE(16000, off + 4); // sampleRate
    buf.writeUInt32LE(32000, off + 8); // byteRate (16000 * 1 * 2)
    buf.writeUInt16LE(2, off + 12); // blockAlign
    buf.writeUInt16LE(16, off + 14); // bitsPerSample
    off += fmtSize;

    // data chunk
    buf.write('data', off);
    off += 4;
    buf.writeUInt32LE(dataSize, off);

    // 32000 dataBytes / 32000 byteRate = 1.0s
    expect(parseAudioDurationSec(buf, 'audio/wav')).toBeCloseTo(1, 5);
  });

  it('uses the stored byteRate (correct for non-PCM audioFormat)', () => {
    // Build a fmt chunk with derived-formula values that would produce a
    // wrong duration if the parser computed byteRate locally. The stored
    // byteRate field declares the true encoded rate.
    //
    // For ADPCM at 8kHz mono 4-bit: stored byteRate is sampleRate * 0.5 = 4000
    // (each sample = 4 bits = 0.5 bytes). The naive formula
    // (sampleRate * channels * bitsPerSample/8) = 8000 * 1 * 0.5 = 4000 happens
    // to coincide here, so we use mismatched values to make the test discriminative.
    const wav = makeWavBuffer({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      dataBytes: 32000,
    });
    // Override stored byteRate to half the derived value (simulates a non-PCM
    // codec that encodes at half the naive rate).
    wav.writeUInt32LE(16000, 28); // half of 32000 (16000 * 1 * 2)
    // Naive formula would compute 32000 / (16000*1*2) = 1s.
    // Stored byteRate=16000 gives 32000 / 16000 = 2s. The stored value is
    // authoritative.
    expect(parseAudioDurationSec(wav, 'audio/wav')).toBeCloseTo(2, 5);
  });
});
