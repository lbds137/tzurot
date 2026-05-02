import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted lifts the mock declaration above the module-mock factories so
// the closure references resolve correctly at hoist time.
const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

vi.mock('node:util', () => ({
  promisify:
    () =>
    (...args: unknown[]): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        const cb = (err: unknown, stdout?: unknown, stderr?: unknown): void => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        };
        mockExecFile(...args, cb);
      });
    },
}));

import { normalizeLoudness } from './audioNormalizer.js';

describe('normalizeLoudness', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it('invokes ffmpeg with loudnorm filter at -14 LUFS by default', async () => {
    const inputBytes = Buffer.from([0x52, 0x49, 0x46, 0x46]); // "RIFF"
    const outputBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]);
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, outputBytes, Buffer.from(''));
    });

    const result = await normalizeLoudness(inputBytes);

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(outputBytes.length);

    const calledArgs = mockExecFile.mock.calls[0][1] as string[];
    expect(mockExecFile.mock.calls[0][0]).toBe('ffmpeg');
    expect(calledArgs).toContain('loudnorm=I=-14:LRA=11:TP=-1.5');
    expect(calledArgs).toContain('24000'); // sample rate
    expect(calledArgs).toContain('s16'); // sample format
  });

  it('honors custom targetLufs / lra / truePeak', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, Buffer.from([0]), Buffer.from(''));
    });

    await normalizeLoudness(Buffer.from([0]), { targetLufs: -16, lra: 13, truePeak: -2.0 });

    const calledArgs = mockExecFile.mock.calls[0][1] as string[];
    expect(calledArgs).toContain('loudnorm=I=-16:LRA=13:TP=-2');
  });

  it('uses array-arg execFile (shell-injection safe per rules/00-critical.md)', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, Buffer.from([0]), Buffer.from(''));
    });

    await normalizeLoudness(Buffer.from([0]));

    // The first arg is the binary path — must be just 'ffmpeg', no shell metacharacters.
    expect(mockExecFile.mock.calls[0][0]).toBe('ffmpeg');
    // The second arg must be an array (not a single shell command string).
    expect(Array.isArray(mockExecFile.mock.calls[0][1])).toBe(true);
  });

  it('pipes audio via stdin (no temp files on disk)', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, Buffer.from([0]), Buffer.from(''));
    });

    const audio = Buffer.from('test audio bytes');
    await normalizeLoudness(audio);

    const opts = mockExecFile.mock.calls[0][2] as { input?: Buffer };
    expect(opts.input).toBe(audio);

    const calledArgs = mockExecFile.mock.calls[0][1] as string[];
    expect(calledArgs).toContain('pipe:0'); // stdin input
    expect(calledArgs).toContain('pipe:1'); // stdout output
  });

  it('propagates ffmpeg errors', async () => {
    const ffmpegError = new Error('ffmpeg: invalid input');
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(ffmpegError, undefined, undefined);
    });

    await expect(normalizeLoudness(Buffer.from([0]))).rejects.toThrow('ffmpeg: invalid input');
  });

  it('passes timeout option to execFile', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, Buffer.from([0]), Buffer.from(''));
    });

    await normalizeLoudness(Buffer.from([0]));

    const opts = mockExecFile.mock.calls[0][2] as { timeout?: number; maxBuffer?: number };
    expect(opts.timeout).toBeGreaterThan(0);
    expect(opts.maxBuffer).toBeGreaterThan(0);
  });
});
