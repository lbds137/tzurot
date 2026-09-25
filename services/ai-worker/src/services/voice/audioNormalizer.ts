/**
 * Audio Normalizer — output-side EBU R128 loudness normalization + Opus encode
 *
 * Mistral Voxtral's smoke test (2026-05-02) revealed a 13.8 LU spread in
 * synthesis loudness across personas at default. Reference-side normalization
 * FAILED — only narrowed to 10.3 LU AND distorted vocal character via dynamic
 * range compression. Output-side works decisively: 13.8 LU → 1.7 LU spread,
 * no character distortion.
 *
 * Target: **-14 LUFS** (Spotify standard). Discord has no native loudness
 * normalization; users on phones in noisy environments need the AI voice to
 * compete with human-microphone audio.
 *
 * **Single ffmpeg pass** — loudnorm filter + libopus encode + ogg muxer in
 * one process spawn. Provider-agnostic: applied at the TTSStep boundary
 * regardless of which provider produced the audio. Output format is always
 * Opus-in-Ogg at 32kbps mono 24kHz (Discord-friendly voice-message format,
 * ~10x smaller than uncompressed WAV).
 *
 * Pre-consolidation, multiple paths handled this differently:
 * - Mistral / ElevenLabs: posted loudnormed-WAV directly (Discord size issue)
 * - Voice-engine multi-chunk: round-tripped via voice-engine /v1/audio/transcode
 * Now unified: every path → single ffmpeg pass → Opus output.
 *
 * This module also hosts {@link transcodeWebmToOgg}, an unrelated STT-side
 * (input) transcode rather than the TTS-side (output) normalization above —
 * it lives here because both share the same `runFfmpeg` process runner.
 */

import { spawn } from 'node:child_process';
import { createLogger } from '@tzurot/common-types/utils/logger';

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
 * Opus bitrate for output. 32kbps is industry-standard for mono speech voice
 * messages (Discord's own voice messages use 32-48k). Lower than music codecs
 * but adequate for speech intelligibility. Tunable later if quality concerns
 * surface.
 */
const OPUS_BITRATE = '32k';

/**
 * Normalize audio loudness AND encode to Opus-in-Ogg in a single ffmpeg pass.
 *
 * Single-pass loudnorm + libopus encode — one process spawn, two operations.
 * Less precise than two-pass loudnorm but fast and consistent enough for
 * spoken audio in the -14 LUFS / 11 LU LRA range (smoke test: 13.8 LU → 1.7
 * LU spread, well within the "perceptually identical" ~3 LU threshold).
 *
 * Output format invariant: Opus codec / Ogg container / 32kbps / mono / 24kHz.
 * The explicit `-ar 24000 -ac 1` flags survive provider changes that might
 * emit different formats (Mistral WAV, ElevenLabs MP3, voice-engine WAV).
 *
 * Shell-injection safe: uses `spawn` with array args (per
 * `.claude/rules/00-critical.md`); no shell interpolation. Audio is piped
 * via stdin/stdout — no temp files.
 *
 * @param audioBuffer - Source audio (any ffmpeg-supported format).
 * @param options - LUFS target overrides. Defaults to -14 / 11 / -1.5.
 * @returns Normalized Opus-in-Ogg buffer (content-type: audio/ogg).
 * @throws if ffmpeg is missing from PATH or fails to process the input.
 */
export async function normalizeLoudness(
  audioBuffer: Buffer,
  options: NormalizeOptions = {}
): Promise<Buffer> {
  const { targetLufs = -14, lra = 11, truePeak = -1.5 } = options;
  const filter = `loudnorm=I=${targetLufs}:LRA=${lra}:TP=${truePeak}`;

  // Array args, no shell interpretation. Piped I/O via stdin (`pipe:0`) and
  // stdout (`pipe:1`) keeps temp files off disk. Single pipeline:
  //   input → loudnorm filter → libopus encoder → ogg muxer → output
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
    '-c:a',
    'libopus',
    // Speech psychoacoustic model — lower algorithmic delay and better
    // perceptual quality at low bitrates for voiced speech vs. libopus's
    // default `audio` mode (which is tuned for music).
    '-application',
    'voip',
    '-b:a',
    OPUS_BITRATE,
    '-f',
    'ogg',
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
      'Audio normalized + encoded to Opus'
    );
    return stdout;
  } catch (error) {
    logger.error(
      { err: error, targetLufs, inputBytes: audioBuffer.length },
      'ffmpeg loudnorm + opus invocation failed'
    );
    throw error;
  }
}

/**
 * Transcode a WebM/Opus buffer into an Ogg/Opus buffer, for STT:
 * voice-engine's decoder (librosa, over the in-memory upload) does not read
 * WebM and rejects it with "Format not recognised", so a Vencord/Vesktop
 * voice message — sniffed as EBML/WebM by `resolveVoiceAudioLabel` in
 * `voiceContainerSniff.ts` — is transcoded to Ogg before any STT provider
 * sees it. No logging here — the caller (AudioProcessor) logs the outcome.
 *
 * The recording client stamps the Opus packets with a jittered timeline; a
 * stream copy would carry that jitter straight into the Ogg granule
 * positions, which libsndfile then rejects as malformed. `asetpts=N/SR/TB`
 * re-labels the decoded frames with a contiguous timeline, and the stream is
 * re-encoded with libopus at 64kbps; no `-ac` flag is passed (not verified:
 * assumes ffmpeg keeps the source channel count when it is omitted). The
 * stream-copy route was tried and ruled out: ffmpeg's `setts` bitstream
 * filter aborted on this input in the same host probe.
 *
 * No explicit input-format flag: a manual probe against real WebM/Opus
 * samples with ffmpeg n7.1.1 confirmed ffmpeg demuxes WebM correctly through
 * non-seekable stdin/stdout pipes with no `-f matroska` (or similar) hint.
 * This module's unit tests mock `spawn`, so they pin only the args this
 * function passes and do NOT cover ffmpeg's demuxing or libsndfile's
 * acceptance; a host probe against a real Vencord recording verified that
 * libsndfile opens the transcoded output.
 *
 * @param input - WebM/Opus source bytes.
 * @returns Ogg/Opus bytes (content-type: audio/ogg).
 * @throws if ffmpeg is missing from PATH, exits non-zero, or times out.
 */
export async function transcodeWebmToOgg(input: Buffer): Promise<Buffer> {
  return runFfmpeg(
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-vn',
      '-af',
      'asetpts=N/SR/TB',
      '-c:a',
      'libopus',
      '-b:a',
      '64k',
      '-f',
      'ogg',
      'pipe:1',
    ],
    input
  );
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
