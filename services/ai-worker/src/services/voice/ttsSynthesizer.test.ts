/**
 * Tests for TTS Synthesizer
 *
 * Covers text chunking, WAV header construction, PCM extraction,
 * and multi-chunk synthesis orchestration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  splitTextIntoChunks,
  extractPcmData,
  buildWavHeader,
  inferSampleRate,
  synthesizeWithChunking,
} from './ttsSynthesizer.js';
import type { VoiceEngineClient, SynthesisResult } from './VoiceEngineClient.js';

vi.mock('@tzurot/common-types', async importActual => {
  const actual = await importActual<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
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

  it('should synthesize each chunk and concatenate PCM for multi-chunk text', async () => {
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

    // Each chunk must request WAV format — extractPcmData/buildWavHeader below operate
    // on raw PCM, and Opus-in-Ogg can't be losslessly concatenated at the byte level.
    for (const call of vi.mocked(mockClient.synthesize).mock.calls) {
      expect(call[2]).toEqual({ format: 'wav' });
    }

    // Result should be a WAV with combined PCM
    expect(result.contentType).toBe('audio/wav');

    // Verify the WAV header
    const resultBuffer = result.audioBuffer;
    expect(resultBuffer.toString('ascii', 0, 4)).toBe('RIFF');
    expect(resultBuffer.toString('ascii', 8, 12)).toBe('WAVE');
    expect(resultBuffer.toString('ascii', 36, 40)).toBe('data');

    // Verify sample rate is preserved
    expect(resultBuffer.readUInt32LE(24)).toBe(sampleRate);
  });

  it('should produce combined WAV with correct total PCM length', async () => {
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
