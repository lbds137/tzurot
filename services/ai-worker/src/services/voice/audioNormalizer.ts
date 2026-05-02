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

import { spawn } from 'node:child_process';
import { createLogger } from '@tzurot/common-types';

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
    const stdout = await runFfmpeg(args, audioBuffer);
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
    return stdout;
  } catch (error) {
    logger.error(
      { err: error, targetLufs, inputBytes: audioBuffer.length },
      'ffmpeg loudnorm invocation failed'
    );
    throw error;
  }
}

/**
 * Spawn ffmpeg with array args (shell-injection safe), pipe input via stdin,
 * collect stdout, enforce timeout + maxBuffer caps.
 *
 * Extracted as a helper so the test-mock surface is just spawn + stream
 * collection, not the higher-level normalizeLoudness flow.
 */
function runFfmpeg(args: string[], input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // execFile via promisify doesn't expose an `input` option; spawn does
    // via stdin pipe. Array args = no shell interpretation per
    // .claude/rules/00-critical.md.
    const child = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    const stdoutChunks: Buffer[] = [];
    let stdoutLen = 0;
    let stderrTail = '';
    let killed = false;

    const timeout = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      reject(new Error(`ffmpeg timed out after ${FFMPEG_TIMEOUT_MS}ms`));
    }, FFMPEG_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutLen += chunk.length;
      if (stdoutLen > FFMPEG_MAX_BUFFER_BYTES) {
        killed = true;
        child.kill('SIGTERM');
        reject(new Error(`ffmpeg stdout exceeded ${FFMPEG_MAX_BUFFER_BYTES} bytes`));
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      // Keep only the tail of stderr — ffmpeg can be verbose, and we only
      // want it when reporting a failure.
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000);
    });

    child.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      if (killed) {
        return; // Already rejected via the timeout/maxBuffer paths above.
      }
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks));
        return;
      }
      reject(
        new Error(
          `ffmpeg exited with code=${String(code)} signal=${String(signal)}: ${stderrTail.trim()}`
        )
      );
    });

    // Pipe the input audio to ffmpeg's stdin.
    child.stdin.on('error', () => {
      // Suppress EPIPE — ffmpeg may close stdin early on its own; the close
      // event handler above is the source of truth for outcome.
    });
    child.stdin.end(input);
  });
}
