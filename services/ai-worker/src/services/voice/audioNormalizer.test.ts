import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';

// vi.hoisted lifts the mock declaration above the module-mock factories.
const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

import { normalizeLoudness } from './audioNormalizer.js';

/**
 * Build a fake child process whose `close` event the test can drive
 * synchronously. stdin captures the piped audio so we can assert on it;
 * stdout emits the configured chunks then closes.
 */
interface FakeChildOptions {
  exitCode?: number;
  signal?: NodeJS.Signals | null;
  stdoutChunks?: Buffer[];
  stderrChunks?: string[];
  spawnError?: Error;
}

function makeFakeChild(opts: FakeChildOptions = {}): {
  emitter: EventEmitter;
  capturedStdin: Buffer[];
} {
  const emitter = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: Writable;
    kill: (sig?: NodeJS.Signals) => void;
  };
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  const captured: Buffer[] = [];
  emitter.stdin = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      captured.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  });
  emitter.kill = vi.fn();

  // Schedule events on the next tick so the caller can attach handlers first.
  setImmediate(() => {
    if (opts.spawnError) {
      emitter.emit('error', opts.spawnError);
      return;
    }
    for (const chunk of opts.stdoutChunks ?? [Buffer.from('output-bytes')]) {
      emitter.stdout.emit('data', chunk);
    }
    for (const chunk of opts.stderrChunks ?? []) {
      emitter.stderr.emit('data', Buffer.from(chunk));
    }
    emitter.emit('close', opts.exitCode ?? 0, opts.signal ?? null);
  });

  return { emitter, capturedStdin: captured };
}

describe('normalizeLoudness', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it('invokes ffmpeg with loudnorm filter at -14 LUFS by default + libopus output', async () => {
    const { emitter } = makeFakeChild({
      stdoutChunks: [Buffer.from('OggSnormalized-opus-bytes')],
    });
    mockSpawn.mockReturnValue(emitter);

    const result = await normalizeLoudness(Buffer.from('input-bytes'));

    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString('utf8')).toBe('OggSnormalized-opus-bytes');

    const calledArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(mockSpawn.mock.calls[0][0]).toBe('ffmpeg');
    expect(calledArgs).toContain('loudnorm=I=-14:LRA=11:TP=-1.5');
    expect(calledArgs).toContain('24000'); // sample rate
    // Single-pass loudnorm + libopus encode + ogg muxer — replaces the
    // two-pass design where voice-engine had its own /v1/audio/transcode
    expect(calledArgs).toContain('libopus');
    expect(calledArgs).toContain('ogg');
    expect(calledArgs).toContain('32k'); // OPUS_BITRATE
    // -application voip selects libopus's speech-tuned psychoacoustic model
    // (lower algorithmic delay, better quality/size for voiced speech vs.
    // the music-tuned `audio` default).
    expect(calledArgs).toContain('-application');
    expect(calledArgs).toContain('voip');
  });

  it('honors custom targetLufs / lra / truePeak', async () => {
    const { emitter } = makeFakeChild();
    mockSpawn.mockReturnValue(emitter);

    await normalizeLoudness(Buffer.from('x'), { targetLufs: -16, lra: 13, truePeak: -2.0 });

    const calledArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(calledArgs).toContain('loudnorm=I=-16:LRA=13:TP=-2');
  });

  it('uses array-arg spawn (shell-injection safe per rules/00-critical.md)', async () => {
    const { emitter } = makeFakeChild();
    mockSpawn.mockReturnValue(emitter);

    await normalizeLoudness(Buffer.from('x'));

    expect(mockSpawn.mock.calls[0][0]).toBe('ffmpeg');
    expect(Array.isArray(mockSpawn.mock.calls[0][1])).toBe(true);
  });

  it('pipes audio via stdin (no temp files on disk)', async () => {
    const { emitter, capturedStdin } = makeFakeChild();
    mockSpawn.mockReturnValue(emitter);

    const audio = Buffer.from('test audio bytes');
    await normalizeLoudness(audio);

    const piped = Buffer.concat(capturedStdin).toString('utf8');
    expect(piped).toBe('test audio bytes');

    const calledArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(calledArgs).toContain('pipe:0'); // stdin input
    expect(calledArgs).toContain('pipe:1'); // stdout output
  });

  it('rejects when ffmpeg exits non-zero, surfacing stderr in the error', async () => {
    const { emitter } = makeFakeChild({
      exitCode: 1,
      stderrChunks: ['ffmpeg: invalid input format\n'],
    });
    mockSpawn.mockReturnValue(emitter);

    await expect(normalizeLoudness(Buffer.from('bad'))).rejects.toThrow(/code=1/);
  });

  it('propagates spawn-level errors (e.g. ffmpeg binary missing)', async () => {
    const { emitter } = makeFakeChild({
      spawnError: Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }),
    });
    mockSpawn.mockReturnValue(emitter);

    await expect(normalizeLoudness(Buffer.from('x'))).rejects.toThrow(/ENOENT/);
  });
});
