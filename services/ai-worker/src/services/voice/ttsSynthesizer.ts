/**
 * TTS Synthesizer
 *
 * Handles text-to-speech synthesis with chunking for long text.
 * Splits text at sentence boundaries, synthesizes each chunk via
 * the voice-engine, and concatenates PCM data into a single WAV file.
 *
 * Newline-on-the-wire invariant: the chunker normalizes `\n` to `\r\n`
 * before any length measurement. WHATWG `multipart/form-data` mandates
 * CRLF in field values (RFC 7578 §4.4), so a payload with bare `\n`
 * grows by one byte per newline once `FormData` serializes it. Without
 * normalization, JS `.length` understates the size voice-engine actually
 * receives, and a 2000-char chunk can become a 2001+-char request body
 * that voice-engine rejects with HTTP 400.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import type { VoiceEngineClient, SynthesisResult } from './VoiceEngineClient.js';

const logger = createLogger('ttsSynthesizer');

/** Maximum characters per TTS chunk (voice-engine limit) */
const MAX_CHUNK_LENGTH = 2000;

/**
 * Max chunks synthesized concurrently. Mirrors voice-engine's own inference
 * semaphore (`INFERENCE_CONCURRENCY`, default 2 — services/voice-engine/
 * server.py), which exists to prevent OOM on Railway's 4 GB ceiling: a higher
 * client cap wouldn't synthesize any faster, it would just park excess
 * requests on the server-side semaphore while the TTS step's outer 300s
 * budget burns. Bump BOTH sides together or not at all.
 */
const TTS_CHUNK_CONCURRENCY = 2;

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
 * **Precondition**: chunks must already be CRLF-normalized (see
 * `splitTextIntoChunks`). Calling this on un-normalized input would mis-cap
 * because JS `.length` would understate the post-FormData wire size. All
 * callers in this module satisfy this — `splitTextIntoChunks` is the only
 * entry point and normalizes at its own entry.
 *
 * Defensive cap: if any chunk exceeds MAX_CHUNK_LENGTH despite the splitting
 * logic, truncate to the cap and warn. Safety net against edge cases the
 * static analysis of accumulateSentence/forceSplitLongSentence misses, plus
 * any upstream preprocessing or measurement-mismatch that could inflate
 * chunk length post-split.
 *
 * Lossy by design (last few chars dropped from an offending chunk) — strictly
 * better than the alternative, which is voice-engine returning 400 and the
 * user losing ALL TTS audio for the response.
 *
 * @internal Exported for testing
 */
export function enforceChunkLengthCap(chunks: string[]): string[] {
  return chunks.map(chunk => {
    if (chunk.length > MAX_CHUNK_LENGTH) {
      logger.warn(
        { chunkLength: chunk.length, maxLength: MAX_CHUNK_LENGTH },
        'TTS chunk exceeded MAX_CHUNK_LENGTH after splitting — truncating to defensive cap'
      );
      return chunk.slice(0, MAX_CHUNK_LENGTH);
    }
    return chunk;
  });
}

/**
 * Split text into chunks that fit within the TTS character limit.
 * Splits at sentence boundaries to maintain natural speech flow.
 *
 * Normalizes newlines to CRLF before measuring/splitting so JS `.length`
 * matches the byte size FormData will produce on the wire. See file header
 * for the multipart/form-data CRLF rationale.
 *
 * @internal Exported for testing
 */
export function splitTextIntoChunks(text: string): string[] {
  // Normalize newlines to CRLF before any length check. The `\r?` prevents
  // double-normalization of input that already has `\r\n` (avoiding `\r\r\n`).
  const normalized = text.replace(/\r?\n/g, '\r\n');

  // Fast path: bypasses enforceChunkLengthCap because the condition itself
  // guarantees output is already at or below MAX_CHUNK_LENGTH.
  if (normalized.length <= MAX_CHUNK_LENGTH) {
    return [normalized];
  }

  const sentences = normalized.split(SENTENCE_BOUNDARY);
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

  return enforceChunkLengthCap(chunks);
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
    // wireLength = post-normalization size = exactly what voice-engine receives.
    // Distinct from `text.length` because CRLF normalization can inflate the
    // payload by N (= bare-`\n` count); using wireLength makes voice-engine 400s
    // diagnosable from the log without needing to reconstruct the request body.
    logger.debug({ voiceId, wireLength: chunks[0].length }, 'Single-chunk TTS synthesis');
    return client.synthesize(chunks[0], voiceId);
  }

  // For multi-chunk, log maxChunkLength (worst-case per-request size — the chunk
  // closest to MAX_CHUNK_LENGTH and most likely to trip voice-engine's cap) rather
  // than total wire size, which isn't a meaningful per-request metric.
  logger.info(
    {
      voiceId,
      chunkCount: chunks.length,
      maxChunkLength: Math.max(...chunks.map(c => c.length)),
    },
    'Multi-chunk TTS synthesis'
  );

  // Synthesize chunks in capped-parallel batches. The cap mirrors
  // voice-engine's own inference semaphore (INFERENCE_CONCURRENCY, default 2
  // — see services/voice-engine/server.py): matching it roughly halves
  // multi-chunk latency, while a higher client cap would only queue on the
  // server semaphore as the 300s TTS_MAX_TOTAL_MS outer budget burns.
  // `results` stays in chunk order (batch slices are contiguous and
  // Promise.all preserves input order) — the concat below depends on it.
  // Voice-engine always returns WAV; the Opus encoding is applied by
  // audioNormalizer downstream, after multi-chunk concatenation.
  const results: SynthesisResult[] = [];
  for (let batchStart = 0; batchStart < chunks.length; batchStart += TTS_CHUNK_CONCURRENCY) {
    const batch = chunks.slice(batchStart, batchStart + TTS_CHUNK_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((chunk, offset) => {
        logger.debug(
          { voiceId, chunkIndex: batchStart + offset, chunkLength: chunk.length },
          'Synthesizing chunk'
        );
        return client.synthesize(chunk, voiceId);
      })
    );
    results.push(...batchResults);
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

  // Build combined WAV. Downstream `TTSStep.storeTTSResult` runs the
  // unified loudnorm + Opus pipeline on this buffer, so we don't need a
  // separate Opus encode here. Returning WAV keeps the multi-chunk path
  // symmetric with the single-chunk and BYOK paths — every path produces
  // some audio buffer, and the audioNormalizer transcodes them all.
  const header = buildWavHeader(totalPcmLength, sampleRate);
  const combined = Buffer.concat([header, ...pcmBuffers]);

  logger.info(
    {
      voiceId,
      wavSize: combined.length,
      chunkCount: chunks.length,
    },
    'Multi-chunk TTS synthesis complete'
  );
  return { audioBuffer: combined, contentType: 'audio/wav' };
}
