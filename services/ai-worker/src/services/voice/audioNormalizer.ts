/**
 * Audio Normalizer — output-side EBU R128 loudness normalization
 *
 * Mistral Voxtral's smoke test (2026-05-02, see TTS Engine Upgrade Phase 1
 * plan section 6) revealed a 13.8 LU spread in synthesis loudness across
 * personas at default. Reference-side normalization FAILED — only narrowed
 * to 10.3 LU AND distorted vocal character via dynamic range compression
 * (`loudnorm`'s LRA target crushes the expressive peaks the model conditions
 * on for voice character).
 *
 * Output-side normalization works decisively: 13.8 LU → 1.7 LU spread on
 * the same four personas, no character distortion (output is post-synthesis
 * flat-ish speech with no expressive dynamics to crush).
 *
 * Target: **-14 LUFS** (Spotify standard, supplementary-council verdict
 * over -16 LUFS podcast standard). Discord has no native loudness
 * normalization; users on phones in noisy environments need the AI voice
 * to compete with human-microphone audio.
 *
 * Provider-agnostic: applied at the TTSStep boundary regardless of which
 * provider produced the audio. ElevenLabs already does internal
 * normalization so this is a near-noop for that path; Mistral genuinely
 * needs it; future providers (NeuTTS Air in Phase 2) inherit it for free.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '@tzurot/common-types';

const execFileAsync = promisify(execFile);
const logger = createLogger('audioNormalizer');

/** ffmpeg execution buffer cap. Typical Discord voice messages are <5MB raw,
 *  <2MB transcoded — 50MB is well above worst case but fails fast on a
 *  runaway process. */
const FFMPEG_MAX_BUFFER_BYTES = 50 * 1024 * 1024;

/** ffmpeg invocation timeout. Single-pass loudnorm on a typical Discord
 *  voice clip is sub-second; 30s is well above the longest realistic case. */
const FFMPEG_TIMEOUT_MS = 30_000;

export interface NormalizeOptions {
  /**
   * Integrated loudness target in LUFS.
   *
   * Defaults to **-14** (Spotify standard) — the supplementary-council
   * verdict for Discord voice playback in mixed/noisy environments.
   * Other reasonable values:
   *   - `-16` LUFS: podcast/dialogue standard (quieter)
   *   - `-19` LUFS: broadcast podcast convention (quieter still)
   */
  targetLufs?: number;
  /** Loudness range in LU. Default 11. */
  lra?: number;
  /** True peak ceiling in dBTP. Default -1.5. */
  truePeak?: number;
}

/**
 * Normalize audio to the target loudness using ffmpeg's `loudnorm` filter.
 *
 * Single-pass mode: loudnorm runs once with target params, no analysis pass.
 * Less precise than two-pass but fast and consistent enough for spoken
 * audio in the -14 LUFS / 11 LU LRA range. The smoke test showed
 * single-pass collapses a 13.8 LU spread to 1.7 LU — well within the
 * "perceptually identical" threshold of ~3 LU.
 *
 * Output format invariant: PCM WAV 16-bit / 24kHz / mono (already what
 * Mistral returns; the explicit `-ar 24000 -ac 1 -sample_fmt s16` flags
 * survive provider changes that might emit different formats).
 *
 * Shell-injection safe: uses `execFile` with array args (per
 * `.claude/rules/00-critical.md`); no shell interpolation. Audio is piped
 * via stdin/stdout — no temp files.
 *
 * @param audioBuffer - Source audio (any ffmpeg-supported format).
 * @param options - LUFS target overrides. Defaults to -14 / 11 / -1.5.
 * @returns Normalized PCM WAV 16-bit / 24kHz / mono buffer.
 * @throws if ffmpeg is missing from PATH or fails to process the input.
 */
export async function normalizeLoudness(
  audioBuffer: Buffer,
  options: NormalizeOptions = {}
): Promise<Buffer> {
  const { targetLufs = -14, lra = 11, truePeak = -1.5 } = options;
  const filter = `loudnorm=I=${targetLufs}:LRA=${lra}:TP=${truePeak}`;

  // Array args, no shell interpretation. Piped I/O via stdin (`pipe:0`) and
  // stdout (`pipe:1`) keeps temp files off disk.
  const args = [
    '-hide_banner',
    '-nostats',
    '-i',
    'pipe:0',
    '-af',
    filter,
    '-ar',
    '24000',
    '-ac',
    '1',
    '-sample_fmt',
    's16',
    '-f',
    'wav',
    'pipe:1',
  ];

  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync('ffmpeg', args, {
      input: audioBuffer,
      maxBuffer: FFMPEG_MAX_BUFFER_BYTES,
      timeout: FFMPEG_TIMEOUT_MS,
      // stdout is binary audio; encoding 'buffer' keeps it as a Buffer.
      encoding: 'buffer',
    });
    const elapsedMs = Date.now() - start;
    logger.debug(
      {
        targetLufs,
        inputBytes: audioBuffer.length,
        outputBytes: stdout.length,
        elapsedMs,
      },
      'Audio normalized'
    );
    // ffmpeg writes loudness analysis to stderr at info level; useful when
    // debugging but not surfaced as a log entry by default to keep volume down.
    void stderr;
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  } catch (error) {
    logger.error(
      { err: error, targetLufs, inputBytes: audioBuffer.length },
      'ffmpeg loudnorm invocation failed'
    );
    throw error;
  }
}
