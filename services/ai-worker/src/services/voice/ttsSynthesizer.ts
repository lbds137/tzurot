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

/** Sentence boundary regex — splits after sentence-ending punctuation followed by whitespace */
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
    const breakAt = splitIndex > 0 ? splitIndex : MAX_CHUNK_LENGTH;
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
 * Extract raw PCM data from a WAV buffer by skipping the 44-byte header.
 * Validates the RIFF/data markers before slicing. If the markers don't match
 * (e.g., extra metadata chunks shifted the data offset), logs a warning but
 * still slices at 44 — this is a contract with voice-engine's Pocket TTS output.
 *
 * @internal Exported for testing
 */
export function extractPcmData(wavBuffer: Buffer): Buffer {
  if (wavBuffer.length <= WAV_HEADER_SIZE) {
    return Buffer.alloc(0);
  }
  // Validate expected WAV structure (RIFF header + "data" sub-chunk at offset 36)
  const riffMarker = wavBuffer.subarray(0, 4).toString('ascii');
  const dataMarker = wavBuffer.subarray(36, 40).toString('ascii');
  if (riffMarker !== 'RIFF' || dataMarker !== 'data') {
    logger.warn(
      { riffMarker, dataMarker, bufferLength: wavBuffer.length },
      'WAV buffer has unexpected header structure — PCM extraction may be incorrect'
    );
  }
  return wavBuffer.subarray(WAV_HEADER_SIZE);
}

/**
 * Build a WAV header for the given PCM data length.
 * Assumes 16-bit mono PCM at the specified sample rate.
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
  const chunks = splitTextIntoChunks(text);

  if (chunks.length === 1) {
    logger.debug({ voiceId, textLength: text.length }, 'Single-chunk TTS synthesis');
    return client.synthesize(chunks[0], voiceId);
  }

  logger.info(
    { voiceId, textLength: text.length, chunkCount: chunks.length },
    'Multi-chunk TTS synthesis'
  );

  // Synthesize chunks sequentially to avoid overwhelming the single-process voice-engine
  const results: SynthesisResult[] = [];
  for (let index = 0; index < chunks.length; index++) {
    logger.debug(
      { voiceId, chunkIndex: index, chunkLength: chunks[index].length },
      'Synthesizing chunk'
    );
    results.push(await client.synthesize(chunks[index], voiceId));
  }

  // Extract PCM data from each WAV result and concatenate
  const sampleRate = inferSampleRate(results[0].audioBuffer);
  // Verify sample rate consistency across chunks (mismatches would produce garbled audio)
  for (let i = 1; i < results.length; i++) {
    const chunkRate = inferSampleRate(results[i].audioBuffer);
    if (chunkRate !== sampleRate) {
      logger.warn(
        { chunkIndex: i, expected: sampleRate, got: chunkRate },
        'Sample rate mismatch across TTS chunks'
      );
    }
  }
  const pcmBuffers = results.map(r => extractPcmData(r.audioBuffer));
  const totalPcmLength = pcmBuffers.reduce((sum, buf) => sum + buf.length, 0);

  // Build combined WAV
  const header = buildWavHeader(totalPcmLength, sampleRate);
  const combined = Buffer.concat([header, ...pcmBuffers]);

  logger.info(
    { voiceId, totalAudioSize: combined.length, chunkCount: chunks.length },
    'Multi-chunk TTS synthesis complete'
  );

  return { audioBuffer: combined, contentType: 'audio/wav' };
}
