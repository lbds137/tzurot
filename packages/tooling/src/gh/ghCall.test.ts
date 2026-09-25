import { describe, it, expect, vi } from 'vitest';

describe('ghCall', () => {
  it('returns stdout on success and passes the timeout through in the options object', async () => {
    vi.resetModules();
    const opts: Record<string, unknown>[] = [];
    vi.doMock('node:child_process', () => ({
      execFileSync: (_cmd: string, _args: string[], o: Record<string, unknown>) => {
        opts.push(o);
        return 'ok output';
      },
    }));
    const { ghCall } = await import('./ghCall.js');
    const result = ghCall(['api', 'foo'], 12_345);
    vi.doUnmock('node:child_process');
    vi.resetModules();

    expect(result).toBe('ok output');
    expect(opts).toHaveLength(1);
    expect(opts[0].timeout).toBe(12_345);
  });

  it('throws a GhApiError carrying the stderr FIRST line only, on a failure with stderr', async () => {
    vi.resetModules();
    vi.doMock('node:child_process', () => ({
      execFileSync: () => {
        const err = new Error('Command failed') as Error & { stderr: string };
        err.stderr = 'gh: HTTP 403: rate limit exceeded\nmore noise';
        throw err;
      },
    }));
    const { ghCall } = await import('./ghCall.js');
    let thrown: unknown;
    try {
      ghCall(['api', 'foo'], 1000);
    } catch (error) {
      thrown = error;
    }
    vi.doUnmock('node:child_process');
    vi.resetModules();

    // Assert on `.name`, not the class: resetModules gives this import its own
    // module instance, so its GhApiError is a different object than ours.
    expect(thrown).toEqual(expect.objectContaining({ name: 'GhApiError' }));
    expect((thrown as Error).message).toBe('gh: HTTP 403: rate limit exceeded');
  });

  it('names the signal on a signal-killed failure with empty stderr', async () => {
    vi.resetModules();
    vi.doMock('node:child_process', () => ({
      execFileSync: () => {
        const err = new Error('Command failed: gh api repos/...') as Error & {
          stderr: string;
          status: null;
          signal: string;
        };
        err.stderr = '';
        err.status = null;
        err.signal = 'SIGTERM';
        throw err;
      },
    }));
    const { ghCall } = await import('./ghCall.js');
    let thrown: unknown;
    try {
      ghCall(['api', 'foo'], 1000);
    } catch (error) {
      thrown = error;
    }
    vi.doUnmock('node:child_process');
    vi.resetModules();

    expect(thrown).toEqual(expect.objectContaining({ name: 'GhApiError' }));
    expect((thrown as Error).message).not.toBe('');
    expect((thrown as Error).message).toContain('killed by SIGTERM');
  });

  it('falls back to "gh failed with no output" with no stderr, no message, and no signal', async () => {
    vi.resetModules();
    vi.doMock('node:child_process', () => ({
      execFileSync: () => {
        const err = new Error('') as Error & { stderr?: string; signal?: string | null };
        err.stderr = '';
        err.signal = null;
        throw err;
      },
    }));
    const { ghCall } = await import('./ghCall.js');
    let thrown: unknown;
    try {
      ghCall(['api', 'foo'], 1000);
    } catch (error) {
      thrown = error;
    }
    vi.doUnmock('node:child_process');
    vi.resetModules();

    expect(thrown).toEqual(expect.objectContaining({ name: 'GhApiError' }));
    expect((thrown as Error).message).toBe('gh failed with no output');
  });
});
