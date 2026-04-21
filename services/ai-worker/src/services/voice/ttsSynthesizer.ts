/**
 * TTS Synthesizer
 *
 * Handles text-to-speech synthesis with chunking for long text.
 * Splits text at sentence boundaries, synthesizes each chunk via
 * the voice-engine, and concatenates PCM data into a single WAV file.
 */

import { createLogger } from '@tzurot/common-types';
import type { VoiceEngineClient, SynthesisResult } from './VoiceEngineClient.js';

const logger = createLogger('ttsSynthesizer');

/** Maximum characters per TTS chunk (voice-engine limit) */
const MAX_CHUNK_LENGTH = 2000;

/** WAV header size in bytes */
const WAV_HEADER_SIZE = 44;

/**
 * Sentence boundary regex — splits after sentence-ending punctuation followed by whitespace.
 * Known limitation: splits on abbreviations like "Dr.", "U.S.", "etc." which may introduce
 * brief pauses in TTS output. Acceptable trade-off — TTS engines handle mid-sentence chunks
 * gracefully, and a more sophisticated NLP-based splitter would add significant complexity.
 */
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

/** Default sample rate when WAV header is invalid (Pocket TTS default) */
const DEFAULT_SAMPLE_RATE = 22050;

/**
 * Force-split a sentence that exceeds MAX_CHUNK_LENGTH at word boundaries.
 * Returns the split chunks and any remaining text that fits within the limit.
 */
function forceSplitLongSentence(sentence: string): { splitChunks: string[]; remainder: string } {
  const splitChunks: string[] = [];
  let remaining = sentence;

  while (remaining.length > MAX_CHUNK_LENGTH) {
    const splitIndex = remaining.lastIndexOf(' ', MAX_CHUNK_LENGTH);
    // If no word boundary exists within the limit (e.g., a 2000+ char word/URL),
    // break at MAX_CHUNK_LENGTH mid-word to guarantee forward progress.
    const breakAt = splitIndex !== -1 ? splitIndex : MAX_CHUNK_LENGTH;
    splitChunks.push(remaining.substring(0, breakAt).trim());
    remaining = remaining.substring(breakAt).trim();
  }

  return { splitChunks, remainder: remaining };
}

/**
 * Accumulate a sentence into the current chunk, or flush and start a new one.
 * Returns the updated currentChunk value.
 */
function accumulateSentence(chunks: string[], currentChunk: string, sentence: string): string {
  const combined = currentChunk.length > 0 ? `${currentChunk} ${sentence}` : sentence;
  if (combined.length <= MAX_CHUNK_LENGTH) {
    return combined;
  }
  chunks.push(currentChunk.trim());
  return sentence;
}

/**
 * Split text into chunks that fit within the TTS character limit.
 * Splits at sentence boundaries to maintain natural speech flow.
 *
 * @internal Exported for testing
 */
export function splitTextIntoChunks(text: string): string[] {
  if (text.length <= MAX_CHUNK_LENGTH) {
    return [text];
  }

  const sentences = text.split(SENTENCE_BOUNDARY);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if (sentence.length > MAX_CHUNK_LENGTH) {
      // Flush current chunk before force-splitting
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
      }
      const { splitChunks, remainder } = forceSplitLongSentence(sentence);
      chunks.push(...splitChunks);
      currentChunk = remainder;
    } else {
      currentChunk = accumulateSentence(chunks, currentChunk, sentence);
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Extract raw PCM data from a WAV buffer by scanning for the 'data' chunk.
 *
 * WAV files store audio in RIFF chunks. The 'data' chunk is *usually* at
 * byte 36 (PCM data starts at 44), but optional chunks like LIST, INFO,
 * or JUNK can shift it. This function scans for the actual 'data' marker
 * rather than assuming a fixed offset, making it robust against format
 * variations (e.g., if voice-engine or FFMPEG adds metadata chunks).
 *
 * Falls back to offset 44 if the RIFF header is missing (non-WAV buffer).
 *
 * @internal Exported for testing
 */
export function extractPcmData(wavBuffer: Buffer): Buffer {
  if (wavBuffer.length <= WAV_HEADER_SIZE) {
    logger.warn(
      { bufferLength: wavBuffer.length, headerSize: WAV_HEADER_SIZE },
      'WAV buffer too small to contain PCM data — returning empty buffer'
    );
    return Buffer.alloc(0);
  }

  const riffMarker = wavBuffer.subarray(0, 4).toString('ascii');
  if (riffMarker !== 'RIFF') {
    logger.warn(
      { riffMarker, bufferLength: wavBuffer.length },
      'Buffer missing RIFF header — falling back to fixed 44-byte offset'
    );
    return wavBuffer.subarray(WAV_HEADER_SIZE);
  }

  // Scan RIFF chunks to find the 'data' sub-chunk.
  // Start after 'RIFF' (4) + fileSize (4) + 'WAVE' (4) = offset 12
  let offset = 12;
  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);

    if (chunkId === 'data') {
      return wavBuffer.subarray(offset + 8);
    }
    // Guard against malformed chunk sizes that extend beyond the buffer
    if (offset + 8 + chunkSize > wavBuffer.length) {
      logger.warn(
        { chunkId, chunkSize, offset, bufferLength: wavBuffer.length },
        'WAV chunk extends beyond buffer — falling back to fixed 44-byte offset'
      );
      return wavBuffer.subarray(WAV_HEADER_SIZE);
    }
    // Advance past this chunk's header (8 bytes) + data
    offset += 8 + chunkSize;
  }

  // 'data' chunk not found — fall back to fixed offset
  logger.warn(
    { bufferLength: wavBuffer.length },
    'WAV data chunk not found — falling back to fixed 44-byte offset'
  );
  return wavBuffer.subarray(WAV_HEADER_SIZE);
}

/**
 * Build a WAV header for the given PCM data length.
 * Assumes 16-bit mono PCM at the specified sample rate — coupled to
 * voice-engine's Pocket TTS output format. If Pocket TTS changes to
 * stereo or different bit depth, this must be updated to match.
 *
 * @internal Exported for testing
 */
export function buildWavHeader(pcmDataLength: number, sampleRate: number): Buffer {
  const header = Buffer.alloc(WAV_HEADER_SIZE);
  const bytesPerSample = 2; // 16-bit
  const numChannels = 1; // mono
  const byteRate = sampleRate * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;

  // RIFF header
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmDataLength, 4); // file size - 8
  header.write('WAVE', 8);

  // fmt sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // sub-chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bytesPerSample * 8, 34); // bits per sample

  // data sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(pcmDataLength, 40);

  return header;
}

/**
 * Infer sample rate from a WAV buffer header.
 * Falls back to DEFAULT_SAMPLE_RATE (22050, Pocket TTS default) if the header is invalid.
 *
 * @internal Exported for testing
 */
export function inferSampleRate(wavBuffer: Buffer): number {
  if (wavBuffer.length < WAV_HEADER_SIZE) {
    return DEFAULT_SAMPLE_RATE;
  }
  const rate = wavBuffer.readUInt32LE(24);
  return rate > 0 && rate <= 96000 ? rate : DEFAULT_SAMPLE_RATE;
}

/**
 * Synthesize text to speech, handling chunking for long text.
 *
 * - Text ≤ 2000 chars: single synthesis call
 * - Text > 2000 chars: split at sentence boundaries, synthesize each chunk,
 *   concatenate PCM data, and wrap in a single WAV header
 *
 * @returns Combined audio buffer and content type
 */
export async function synthesizeWithChunking(
  client: VoiceEngineClient,
  text: string,
  voiceId: string
): Promise<SynthesisResult> {
  // splitTextIntoChunks always returns at least one element (even for empty string)
  const chunks = splitTextIntoChunks(text);

  // Invariant: splitTextIntoChunks always returns >= 1 element (line 69–71 early return)
  if (chunks.length === 1) {
    logger.debug({ voiceId, textLength: text.length }, 'Single-chunk TTS synthesis');
    return client.synthesize(chunks[0], voiceId);
  }

  logger.info(
    { voiceId, textLength: text.length, chunkCount: chunks.length },
    'Multi-chunk TTS synthesis'
  );

  // Synthesize chunks sequentially to avoid overwhelming the single-process voice-engine.
  // Request WAV for each chunk: extractPcmData/buildWavHeader below operate on raw PCM,
  // and Opus-in-Ogg can't be losslessly concatenated at the byte level.
  const results: SynthesisResult[] = [];
  for (let index = 0; index < chunks.length; index++) {
    logger.debug(
      { voiceId, chunkIndex: index, chunkLength: chunks[index].length },
      'Synthesizing chunk'
    );
    results.push(await client.synthesize(chunks[index], voiceId, { format: 'wav' }));
  }

  // Extract PCM data from each WAV result and concatenate
  const sampleRate = inferSampleRate(results[0].audioBuffer);
  // Verify sample rate consistency across chunks.
  // Mismatched rates produce audible artifacts (pitch shift, speed distortion).
  // We log a warning but still concatenate — voice-engine uses a single model,
  // so rate mismatches should never happen in practice. If they do, the warning
  // surfaces it for debugging while still producing best-effort audio output.
  for (let i = 1; i < results.length; i++) {
    const chunkRate = inferSampleRate(results[i].audioBuffer);
    if (chunkRate !== sampleRate) {
      logger.warn(
        { chunkIndex: i, expected: sampleRate, got: chunkRate },
        'Sample rate mismatch across TTS chunks — output audio may have artifacts'
      );
    }
  }
  const pcmBuffers = results.map(r => extractPcmData(r.audioBuffer));
  const totalPcmLength = pcmBuffers.reduce((sum, buf) => sum + buf.length, 0);

  // Build combined WAV
  const header = buildWavHeader(totalPcmLength, sampleRate);
  const combined = Buffer.concat([header, ...pcmBuffers]);

  // Re-encode combined WAV to Opus-in-Ogg so multi-chunk output matches the
  // single-chunk path's ~10x size reduction. Without this, ~2 min of speech
  // lands around 11-13 MB WAV and trips Discord's 8 MiB attachment limit.
  // On transcode failure, fall back to WAV — better to deliver too-large
  // audio that Discord's sender will replace with a fallback notice than to
  // fail the whole synthesis.
  try {
    const transcoded = await client.transcode(combined);
    logger.info(
      {
        voiceId,
        wavSize: combined.length,
        encodedSize: transcoded.audioBuffer.length,
        contentType: transcoded.contentType,
        chunkCount: chunks.length,
      },
      'Multi-chunk TTS synthesis complete'
    );
    return transcoded;
  } catch (error) {
    logger.warn(
      { err: error, voiceId, wavSize: combined.length, chunkCount: chunks.length },
      'Multi-chunk Opus transcode failed — falling back to combined WAV'
    );
    return { audioBuffer: combined, contentType: 'audio/wav' };
  }
}
