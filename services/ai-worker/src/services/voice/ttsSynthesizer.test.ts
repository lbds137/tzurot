/**
 * Tests for TTS Synthesizer
 *
 * Covers text chunking, WAV header construction, PCM extraction,
 * and multi-chunk synthesis orchestration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  splitTextIntoChunks,
  enforceChunkLengthCap,
  extractPcmData,
  buildWavHeader,
  inferSampleRate,
  synthesizeWithChunking,
} from './ttsSynthesizer.js';
import type { VoiceEngineClient, SynthesisResult } from './VoiceEngineClient.js';

// Shared logger singleton so tests can assert on warn/error calls made by
// the module under test. createLogger is called once at module import time;
// every downstream `logger.warn(...)` lands on the same spy.
//
// `vi.hoisted` is required because `vi.mock` calls are hoisted to the top
// of the file, and a module-scope `const mockLogger = {...}` would be in
// the temporal dead zone when the mock factory runs.
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@tzurot/common-types', async importActual => {
  const actual = await importActual<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

/** Create a fake WAV buffer from raw PCM data. */
function createFakeWav(pcmData: Buffer, sampleRate = 22050): Buffer {
  const header = buildWavHeader(pcmData.length, sampleRate);
  return Buffer.concat([header, pcmData]);
}

describe('splitTextIntoChunks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return single chunk for short text', () => {
    const text = 'Hello, world.';
    const chunks = splitTextIntoChunks(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it('should return single chunk for text exactly at 2000 chars', () => {
    const text = 'A'.repeat(2000);
    const chunks = splitTextIntoChunks(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it('should split long text at sentence boundaries', () => {
    // Build text that exceeds 2000 chars by repeating sentences
    const sentence = 'This is a test sentence that helps fill up the chunk. ';
    const repetitions = Math.ceil(2100 / sentence.length);
    const text = sentence.repeat(repetitions).trim();

    expect(text.length).toBeGreaterThan(2000);

    const chunks = splitTextIntoChunks(text);

    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk should be at most 2000 chars
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
    // Concatenating all chunks (with space) should reconstruct original content
    const reconstructed = chunks.join(' ');
    // Sentence splitting means whitespace may differ, but all words should be present
    const originalWords = text.split(/\s+/);
    const reconstructedWords = reconstructed.split(/\s+/);
    expect(reconstructedWords).toEqual(originalWords);
  });

  it('should force-split a single sentence exceeding 2000 chars at word boundaries', () => {
    // A single long sentence with no periods — just words separated by spaces
    const word = 'longword ';
    const repetitions = Math.ceil(2100 / word.length);
    const text = word.repeat(repetitions).trim();

    expect(text.length).toBeGreaterThan(2000);
    // No sentence boundaries exist
    expect(text).not.toContain('.');

    const chunks = splitTextIntoChunks(text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  it('should split text without sentence-ending punctuation at 2000 char boundary', () => {
    // Continuous text with no periods, exclamation marks, or question marks
    const text = 'word '.repeat(500).trim(); // ~2499 chars
    expect(text.length).toBeGreaterThan(2000);

    const chunks = splitTextIntoChunks(text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  it('should return single chunk for empty string', () => {
    const chunks = splitTextIntoChunks('');

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('');
  });

  describe('FormData CRLF expansion safety', () => {
    // Root cause (confirmed via council analysis):
    // multipart/form-data spec mandates `\n` → `\r\n` normalization before
    // serialization (WHATWG HTML standard, RFC 7578). Node's built-in
    // FormData implements this. So a JS-side 2000-char chunk containing N
    // newlines becomes a 2000+N-char payload on the wire, and Python's
    // voice-engine `len(text)` check rejects it. The "off-by-six"
    // and "off-by-one" failure modes both fit:
    // off-by-N = newline count.
    //
    // Existing tests use `'A'.repeat(2000)` which has zero newlines, so
    // the bug shipped despite static analysis + defensive cap appearing
    // correct. The chunker now normalizes `\n` → `\r\n` BEFORE chunking
    // so JS .length accurately reflects what FormData will transmit.

    it('normalizes \\n to \\r\\n before chunking so JS length matches wire size', () => {
      // 1995 'A's + 5 \n at end. Pre-fix: JS sees 2000 chars, FormData
      // expands to 2005, voice-engine rejects (off-by-five). Post-fix:
      // chunker normalizes input → JS sees 2005 chars before chunking →
      // splits or truncates to ≤ 2000.
      const text = 'A'.repeat(1995) + '\n'.repeat(5);
      const chunks = splitTextIntoChunks(text);

      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      }
      // All newlines in the output are CRLF, never bare LF — negative lookbehind
      // catches a bare `\n` even if the same chunk also contains a separate `\r\n`,
      // and matches a leading `\n` at position 0 (which `[^\r]\n` would miss).
      for (const chunk of chunks) {
        expect(chunk).not.toMatch(/(?<!\r)\n/);
      }
    });

    it('does not double-normalize already-CRLF input (no \\r\\r\\n drift)', () => {
      // The normalization regex is `\r?\n/g` (the `?` is load-bearing).
      // Naive `\n` → `\r\n` would turn `\r\n` into `\r\r\n`, inflating
      // length by N on every chunker call and accumulating across
      // upstream-already-normalized inputs.
      const text = 'A'.repeat(100) + '\r\n' + 'B'.repeat(100);
      const chunks = splitTextIntoChunks(text);

      // No \r\r\n drift — should still see exactly one \r\n in the output
      const joined = chunks.join('');
      expect(joined).not.toContain('\r\r\n');
      expect(joined.match(/\r\n/g)?.length ?? 0).toBe(1);
    });

    it('handles mixed \\n and \\r\\n input correctly', () => {
      // Real LLM output sometimes mixes line endings depending on training.
      // All should normalize to CRLF without drift.
      const text = 'A'.repeat(50) + '\n' + 'B'.repeat(50) + '\r\n' + 'C'.repeat(50);
      const chunks = splitTextIntoChunks(text);

      const joined = chunks.join('');
      // Two newlines in input, both should be CRLF in output
      expect(joined.match(/\r\n/g)?.length ?? 0).toBe(2);
      // No bare LF (lookbehind handles position-0 case) and no bare CR
      expect(joined).not.toMatch(/(?<!\r)\n/);
      expect(joined).not.toMatch(/\r(?!\n)/);
    });

    it('returns CRLF-normalized output as the single chunk for short text with bare LF', () => {
      // Locks in the post-normalization identity contract: when input fits in
      // one chunk, the function returns `[normalized]` rather than `[input]`.
      // The "should return single chunk for short text" case earlier uses
      // newline-free input, so it incidentally satisfies both contracts;
      // this case disambiguates which one is load-bearing.
      const text = 'Hello,\nworld.';
      const chunks = splitTextIntoChunks(text);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('Hello,\r\nworld.');
    });

    it('SENTENCE_BOUNDARY consumes CRLF between sentences (rejoined with space)', () => {
      // SENTENCE_BOUNDARY = /(?<=[.!?])\s+/ matches `\r\n` as `\s+`, so the
      // CRLF between sentences is consumed during the split. accumulateSentence
      // recombines fitting sentences with a single space — the CRLF is not
      // preserved verbatim. This is intentional: TTS doesn't care about newline
      // positions between sentences, only about chunks fitting the wire cap.
      // Confirming here so future readers don't mistake it for a normalization bug.
      //
      // To observe the space-rejoin, the input must (a) exceed MAX_CHUNK_LENGTH
      // so the slow path runs, and (b) contain at least two sentences small
      // enough to combine into one output chunk. Three 700-char sentences
      // satisfy both: total 2107 chars > 2000 (slow path), but s1+s2 = ~1402
      // chars < 2000 (combine in chunk 0); s3 spills to chunk 1.
      const sentence = 'A'.repeat(700) + '.';
      const text = sentence + '\n' + sentence + '\n' + sentence;
      const chunks = splitTextIntoChunks(text);

      // chunk[0] = "AAA...A. AAA...A." — period + space + A (rejoin), no CRLF
      expect(chunks[0]).toContain('. A');
      expect(chunks[0]).not.toContain('.\r\nA');
    });
  });
});

describe('enforceChunkLengthCap', () => {
  // Precondition reminder: enforceChunkLengthCap assumes its inputs are
  // already CRLF-normalized (see the function's docstring). All test cases
  // in this describe block use ASCII-only / newline-free strings, which
  // trivially satisfy the precondition. If you add a case with embedded
  // newlines, normalize first (e.g., wrap in `splitTextIntoChunks` or
  // pre-replace `\n` → `\r\n`) so the test exercises a state the production
  // code can actually produce.
  beforeEach(() => {
    mockLogger.warn.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should pass through chunks within the cap unchanged', () => {
    const input = ['short', 'A'.repeat(1500), 'A'.repeat(2000)];
    const result = enforceChunkLengthCap(input);

    expect(result).toEqual(input);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('should truncate any chunk exceeding the cap to MAX_CHUNK_LENGTH', () => {
    // Synthetic over-cap input — the production-failing shape was 2006 chars
    // against the 2000 cap.
    const oversized = 'A'.repeat(2006);
    const result = enforceChunkLengthCap([oversized]);

    expect(result).toHaveLength(1);
    expect(result[0].length).toBe(2000);
    expect(result[0]).toBe('A'.repeat(2000));
  });

  it('should log a warning with chunk-length context when truncation triggers', () => {
    enforceChunkLengthCap(['A'.repeat(2050)]);

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { chunkLength: 2050, maxLength: 2000 },
      expect.stringContaining('TTS chunk exceeded MAX_CHUNK_LENGTH')
    );
  });

  it('should truncate only the offending chunks in a mixed array', () => {
    const input = ['A'.repeat(1500), 'B'.repeat(2200), 'C'.repeat(800), 'D'.repeat(2001)];
    const result = enforceChunkLengthCap(input);

    expect(result[0]).toBe('A'.repeat(1500));
    expect(result[1]).toBe('B'.repeat(2000));
    expect(result[2]).toBe('C'.repeat(800));
    expect(result[3]).toBe('D'.repeat(2000));
    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
  });

  it('should return an empty array unchanged', () => {
    const result = enforceChunkLengthCap([]);

    expect(result).toEqual([]);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

describe('extractPcmData', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return empty buffer if input is shorter than WAV header', () => {
    const shortBuffer = Buffer.alloc(20);
    const result = extractPcmData(shortBuffer);

    expect(result.length).toBe(0);
  });

  it('should return empty buffer for exactly 44-byte input', () => {
    const exactHeader = Buffer.alloc(44);
    const result = extractPcmData(exactHeader);

    expect(result.length).toBe(0);
  });

  it('should extract PCM from standard WAV with data chunk at offset 36', () => {
    const pcmContent = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
    const wav = createFakeWav(pcmContent);

    const result = extractPcmData(wav);

    expect(result.length).toBe(5);
    expect(Buffer.compare(result, pcmContent)).toBe(0);
  });

  it('should find data chunk when preceded by extra RIFF sub-chunks', () => {
    // Build a WAV with a LIST chunk inserted between fmt and data
    const pcmContent = Buffer.from([0xaa, 0xbb, 0xcc]);

    // RIFF header (12 bytes)
    const riff = Buffer.alloc(12);
    riff.write('RIFF', 0);
    riff.write('WAVE', 8);

    // fmt sub-chunk (24 bytes: 8 header + 16 data)
    const fmt = Buffer.alloc(24);
    fmt.write('fmt ', 0);
    fmt.writeUInt32LE(16, 4); // chunk size
    fmt.writeUInt16LE(1, 8); // PCM format
    fmt.writeUInt16LE(1, 10); // mono
    fmt.writeUInt32LE(22050, 12); // sample rate
    fmt.writeUInt32LE(44100, 16); // byte rate
    fmt.writeUInt16LE(2, 20); // block align
    fmt.writeUInt16LE(16, 22); // bits per sample

    // LIST sub-chunk (20 bytes: 8 header + 12 data) — shifts data chunk
    const listData = Buffer.from('extra_data!!'); // 12 bytes
    const list = Buffer.alloc(8 + listData.length);
    list.write('LIST', 0);
    list.writeUInt32LE(listData.length, 4);
    listData.copy(list, 8);

    // data sub-chunk (8 header + PCM)
    const dataHeader = Buffer.alloc(8);
    dataHeader.write('data', 0);
    dataHeader.writeUInt32LE(pcmContent.length, 4);

    // Update RIFF size
    const totalSize = fmt.length + list.length + dataHeader.length + pcmContent.length + 4; // +4 for 'WAVE'
    riff.writeUInt32LE(totalSize, 4);

    const wav = Buffer.concat([riff, fmt, list, dataHeader, pcmContent]);

    const result = extractPcmData(wav);

    expect(result.length).toBe(3);
    expect(Buffer.compare(result, pcmContent)).toBe(0);
  });

  it('should fall back to offset 44 when chunk size exceeds buffer length', () => {
    // Build a valid RIFF header + fmt chunk with a bogus chunkSize that overflows
    const riff = Buffer.alloc(12);
    riff.write('RIFF', 0);
    riff.writeUInt32LE(100, 4);
    riff.write('WAVE', 8);

    // fmt chunk with absurdly large chunkSize (0xFFFFFF)
    const fmt = Buffer.alloc(8);
    fmt.write('fmt ', 0);
    fmt.writeUInt32LE(0xffffff, 4); // Way beyond buffer

    const pcmContent = Buffer.from([0xab, 0xcd]);
    const wavBuffer = Buffer.concat([riff, fmt, pcmContent]);

    // Should fall back to offset 44, not crash
    const result = extractPcmData(wavBuffer);

    // Buffer is smaller than 44 bytes offset, so fallback returns empty subarray
    expect(result.length).toBe(0);
  });

  it('should fall back to offset 44 when RIFF header is missing', () => {
    const header = Buffer.alloc(44);
    const pcmContent = Buffer.from([0x01, 0x02, 0x03]);
    const wavBuffer = Buffer.concat([header, pcmContent]);

    const result = extractPcmData(wavBuffer);

    expect(result.length).toBe(3);
  });
});

describe('buildWavHeader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return a 44-byte buffer', () => {
    const header = buildWavHeader(1000, 22050);
    expect(header.length).toBe(44);
  });

  it('should start with RIFF magic bytes', () => {
    const header = buildWavHeader(1000, 22050);
    expect(header.toString('ascii', 0, 4)).toBe('RIFF');
  });

  it('should contain WAVE format at offset 8', () => {
    const header = buildWavHeader(1000, 22050);
    expect(header.toString('ascii', 8, 12)).toBe('WAVE');
  });

  it('should contain fmt sub-chunk at offset 12', () => {
    const header = buildWavHeader(1000, 22050);
    expect(header.toString('ascii', 12, 16)).toBe('fmt ');
  });

  it('should contain data sub-chunk at offset 36', () => {
    const header = buildWavHeader(1000, 22050);
    expect(header.toString('ascii', 36, 40)).toBe('data');
  });

  it('should write PCM data length at offset 40', () => {
    const pcmLength = 48000;
    const header = buildWavHeader(pcmLength, 22050);

    expect(header.readUInt32LE(40)).toBe(pcmLength);
  });

  it('should write sample rate at offset 24', () => {
    const sampleRate = 44100;
    const header = buildWavHeader(1000, sampleRate);

    expect(header.readUInt32LE(24)).toBe(sampleRate);
  });

  it('should write correct file size at offset 4 (36 + pcmDataLength)', () => {
    const pcmLength = 5000;
    const header = buildWavHeader(pcmLength, 22050);

    // RIFF chunk size = 36 + data size
    expect(header.readUInt32LE(4)).toBe(36 + pcmLength);
  });

  it('should set PCM audio format (1) at offset 20', () => {
    const header = buildWavHeader(1000, 22050);
    expect(header.readUInt16LE(20)).toBe(1);
  });

  it('should set mono channel (1) at offset 22', () => {
    const header = buildWavHeader(1000, 22050);
    expect(header.readUInt16LE(22)).toBe(1);
  });

  it('should set 16 bits per sample at offset 34', () => {
    const header = buildWavHeader(1000, 22050);
    expect(header.readUInt16LE(34)).toBe(16);
  });
});

describe('inferSampleRate', () => {
  it('should return sample rate from valid WAV header', () => {
    const header = buildWavHeader(1000, 44100);
    const wav = Buffer.concat([header, Buffer.alloc(1000)]);

    expect(inferSampleRate(wav)).toBe(44100);
  });

  it('should return default sample rate for buffer shorter than WAV header', () => {
    const shortBuffer = Buffer.alloc(20);

    expect(inferSampleRate(shortBuffer)).toBe(22050);
  });

  it('should return default sample rate when rate is 0', () => {
    const header = buildWavHeader(100, 22050);
    // Overwrite sample rate at offset 24 with 0
    header.writeUInt32LE(0, 24);
    const wav = Buffer.concat([header, Buffer.alloc(100)]);

    expect(inferSampleRate(wav)).toBe(22050);
  });

  it('should return default sample rate when rate exceeds 96000', () => {
    const header = buildWavHeader(100, 22050);
    // Overwrite sample rate at offset 24 with an absurd value
    header.writeUInt32LE(200000, 24);
    const wav = Buffer.concat([header, Buffer.alloc(100)]);

    expect(inferSampleRate(wav)).toBe(22050);
  });

  it('should accept 96000 as a valid sample rate', () => {
    const header = buildWavHeader(100, 96000);
    const wav = Buffer.concat([header, Buffer.alloc(100)]);

    expect(inferSampleRate(wav)).toBe(96000);
  });
});

describe('synthesizeWithChunking', () => {
  let mockClient: VoiceEngineClient;

  beforeEach(() => {
    vi.useFakeTimers();
    mockClient = {
      synthesize: vi.fn(),
    } as unknown as VoiceEngineClient;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call client.synthesize once for short text and return result directly', async () => {
    const shortText = 'Hello, world.';
    const expectedResult: SynthesisResult = {
      audioBuffer: Buffer.from('fake-wav-data'),
      contentType: 'audio/wav',
    };

    vi.mocked(mockClient.synthesize).mockResolvedValue(expectedResult);

    const result = await synthesizeWithChunking(mockClient, shortText, 'voice-1');

    expect(mockClient.synthesize).toHaveBeenCalledTimes(1);
    expect(mockClient.synthesize).toHaveBeenCalledWith(shortText, 'voice-1');
    expect(result).toBe(expectedResult);
  });

  it('synthesizes each chunk and returns combined WAV (audioNormalizer encodes Opus downstream)', async () => {
    // Build text that requires multiple chunks
    const sentence = 'This is a moderately long sentence for testing purposes. ';
    const repetitions = Math.ceil(2100 / sentence.length);
    const longText = sentence.repeat(repetitions).trim();
    expect(longText.length).toBeGreaterThan(2000);

    const sampleRate = 22050;
    const pcm1 = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const pcm2 = Buffer.from([0x05, 0x06, 0x07, 0x08]);

    vi.mocked(mockClient.synthesize).mockImplementation(async (chunk: string) => {
      // Return different PCM data for each chunk so we can verify concatenation
      const isFirstChunk = chunk.startsWith('This is a moderately');
      const pcmData = isFirstChunk ? pcm1 : pcm2;
      return {
        audioBuffer: createFakeWav(pcmData, sampleRate),
        contentType: 'audio/wav',
      };
    });

    const result = await synthesizeWithChunking(mockClient, longText, 'voice-1');

    // Should have called synthesize for each chunk
    expect(vi.mocked(mockClient.synthesize).mock.calls.length).toBeGreaterThanOrEqual(2);

    // synthesize is called with (text, voiceId) — voice-engine always returns
    // WAV now; no format param needed.
    for (const call of vi.mocked(mockClient.synthesize).mock.calls) {
      expect(call.length).toBe(2);
    }

    // Combined WAV is returned directly. Header has the right magic bytes and
    // sample rate; downstream audioNormalizer is what encodes the Opus output.
    expect(result.contentType).toBe('audio/wav');
    expect(result.audioBuffer.toString('ascii', 0, 4)).toBe('RIFF');
    expect(result.audioBuffer.toString('ascii', 8, 12)).toBe('WAVE');
    expect(result.audioBuffer.toString('ascii', 36, 40)).toBe('data');
    expect(result.audioBuffer.readUInt32LE(24)).toBe(sampleRate);
  });

  it('should warn (not throw) when chunks return mismatched sample rates', async () => {
    // Voice-engine uses a single model so this shouldn't happen in practice,
    // but the code emits a soft warn + best-effort concatenation rather than
    // hard-failing. This test pins that contract: two chunks, two different
    // rates, the warn fires with the expected fields, and synthesis still
    // returns audio.
    mockLogger.warn.mockClear();

    const chunk1Text = 'A'.repeat(1500) + '.';
    const chunk2Text = 'B'.repeat(1500) + '.';
    const longText = `${chunk1Text} ${chunk2Text}`;
    expect(longText.length).toBeGreaterThan(2000);

    const pcm1 = Buffer.alloc(80, 0xaa);
    const pcm2 = Buffer.alloc(80, 0xbb);

    let callIndex = 0;
    vi.mocked(mockClient.synthesize).mockImplementation(async () => {
      // First chunk at 22050 Hz (expected), second at 16000 Hz (mismatch).
      const isFirst = callIndex === 0;
      callIndex++;
      return {
        audioBuffer: createFakeWav(isFirst ? pcm1 : pcm2, isFirst ? 22050 : 16000),
        contentType: 'audio/wav',
      };
    });

    const result = await synthesizeWithChunking(mockClient, longText, 'voice-1');

    // The mismatch warn must fire with the structured fields so ops can
    // grep for it by field rather than by message-string.
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ chunkIndex: 1, expected: 22050, got: 16000 }),
      expect.stringContaining('Sample rate mismatch')
    );

    // Best-effort output — synthesis still completes with the first chunk's
    // sample rate baked into the combined WAV header. Downstream
    // audioNormalizer encodes to Opus.
    expect(result.contentType).toBe('audio/wav');
  });

  it('produces combined WAV with correct total PCM length', async () => {
    // Create text that will result in exactly 2 chunks
    // Use a clear sentence boundary to make splitting predictable
    const chunk1Text = 'A'.repeat(1500) + '.';
    const chunk2Text = 'B'.repeat(1500) + '.';
    const longText = `${chunk1Text} ${chunk2Text}`;
    expect(longText.length).toBeGreaterThan(2000);

    const pcm1 = Buffer.alloc(100, 0xaa);
    const pcm2 = Buffer.alloc(200, 0xbb);
    const sampleRate = 22050;

    let callIndex = 0;
    vi.mocked(mockClient.synthesize).mockImplementation(async () => {
      const pcmData = callIndex === 0 ? pcm1 : pcm2;
      callIndex++;
      return {
        audioBuffer: createFakeWav(pcmData, sampleRate),
        contentType: 'audio/wav',
      };
    });

    const result = await synthesizeWithChunking(mockClient, longText, 'voice-1');

    // Total PCM should be pcm1 + pcm2 = 300 bytes
    const expectedPcmLength = pcm1.length + pcm2.length;

    // PCM data length is written at offset 40 in the WAV header
    expect(result.audioBuffer.readUInt32LE(40)).toBe(expectedPcmLength);

    // Total buffer should be 44 (header) + 300 (PCM)
    expect(result.audioBuffer.length).toBe(44 + expectedPcmLength);

    // Verify the PCM data content is correct (first 100 bytes = 0xAA, next 200 = 0xBB)
    const pcmData = extractPcmData(result.audioBuffer);
    expect(pcmData.length).toBe(expectedPcmLength);
    expect(pcmData.subarray(0, 100).every(b => b === 0xaa)).toBe(true);
    expect(pcmData.subarray(100, 300).every(b => b === 0xbb)).toBe(true);
  });
});
