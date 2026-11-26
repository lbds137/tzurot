import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { SpawnError, USAGE_HINT, isDirectRun, main, runWrapped } from './exec.js';
import type { ProfileInput } from './profile.js';

const GIB = 1024 ** 3;
const lowInput: ProfileInput = { env: {}, cpus: 8, memTotalBytes: Math.round(14.45 * GIB) };

function collect(): { stream: Writable; text: () => string } {
  let out = '';
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  return { stream, text: () => out };
}

describe('runWrapped', () => {
  it('exports the profile env additions to the child', async () => {
    const stdout = collect();
    const stderr = collect();
    const code = await runWrapped(
      [
        process.execPath,
        '-e',
        'console.log(JSON.stringify([process.env.RESOURCE_PROFILE, process.env.VITEST_MAX_WORKERS, process.env.TURBO_CONCURRENCY, process.env.NODE_OPTIONS]))',
      ],
      lowInput,
      {
        stdio: 'pipe',
        childStdout: stdout.stream,
        childStderr: stderr.stream,
        stderr: stderr.stream,
      }
    );
    expect(code).toBe(0);
    const [profile, workers, concurrency, nodeOptions] = JSON.parse(stdout.text()) as string[];
    expect(profile).toBe('low');
    expect(workers).toBe('1');
    expect(concurrency).toBe('1');
    expect(nodeOptions).toBe('--max-old-space-size=3072');
  });

  it('propagates the child exit code', async () => {
    const code = await runWrapped([process.execPath, '-e', 'process.exit(3)'], lowInput, {
      stderr: collect().stream,
    });
    expect(code).toBe(3);
  });

  it('maps a signal to 128 + signal number', async () => {
    const code = await runWrapped(
      [process.execPath, '-e', 'process.kill(process.pid, "SIGTERM")'],
      lowInput,
      { stderr: collect().stream }
    );
    expect(code).toBe(143);
  });

  it('prints the profile line to stderr before the child runs', async () => {
    const err = collect();
    await runWrapped([process.execPath, '-e', 'process.exit(0)'], lowInput, { stderr: err.stream });
    expect(err.text()).toBe(
      'resource profile: low (auto: 14.5 GiB total memory) - turbo 1, vitest 1, heap 3072 MB\n'
    );
  });

  it('rejects with SpawnError for a missing binary', async () => {
    const attempt = (): Promise<number> =>
      runWrapped(['definitely-missing-binary-lrm-1'], lowInput, { stderr: collect().stream });
    await expect(attempt()).rejects.toThrow(SpawnError);
  });

  it('rejects with SpawnError for an empty command', async () => {
    const attempt = (): Promise<number> => runWrapped([''], lowInput, { stderr: collect().stream });
    await expect(attempt()).rejects.toThrow(SpawnError);
  });

  it('routes piped child stderr through childStderr', async () => {
    const childStderr = collect();
    const code = await runWrapped(
      [process.execPath, '-e', 'console.error("child-to-stderr")'],
      lowInput,
      {
        stdio: 'pipe',
        childStdout: collect().stream,
        childStderr: childStderr.stream,
        stderr: collect().stream,
      }
    );
    expect(code).toBe(0);
    expect(childStderr.text()).toContain('child-to-stderr');
  });
});

describe('runWrapped signal forwarding', () => {
  it('forwards SIGTERM to the child, resolves 128+15 and removes its handlers', async () => {
    const before = process.listenerCount('SIGTERM');
    const out = collect();
    const pending = runWrapped(
      [process.execPath, '-e', 'console.log("ready"); setInterval(() => {}, 1000)'],
      lowInput,
      {
        stdio: 'pipe',
        childStdout: out.stream,
        childStderr: collect().stream,
        stderr: collect().stream,
      }
    );
    await vi.waitFor(() => expect(out.text()).toContain('ready'));
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    process.emit('SIGTERM');
    expect(await pending).toBe(143);
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('removes its handlers when the child exits normally', async () => {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const before = signals.map(s => process.listenerCount(s));
    await runWrapped([process.execPath, '-e', 'process.exit(0)'], lowInput, {
      stderr: collect().stream,
    });
    expect(signals.map(s => process.listenerCount(s))).toEqual(before);
  });
});

describe('isDirectRun', () => {
  const metaUrl = 'file:///real/dir/exec.ts';

  it('matches when the entry resolves to the module URL (symlinked entry)', () => {
    expect(isDirectRun('/link/exec.ts', metaUrl, () => '/real/dir/exec.ts')).toBe(true);
  });

  it('does not match a different path, an undefined entry or a failing realpath', () => {
    expect(isDirectRun('/other/x.ts', metaUrl, path => path)).toBe(false);
    expect(isDirectRun(undefined, metaUrl, path => path)).toBe(false);
    expect(
      isDirectRun('/gone.ts', metaUrl, () => {
        throw new Error('ENOENT');
      })
    ).toBe(false);
  });
});

describe('main', () => {
  it('prints usage and exits 2 with no command', async () => {
    const err = collect();
    const code = await main([], { stderr: err.stream });
    expect(code).toBe(2);
    expect(err.text()).toBe(`${USAGE_HINT}\n`);
  });

  it('maps a resolver rejection to 2 without spawning', async () => {
    const err = collect();
    const code = await main([process.execPath, '-e', 'process.exit(0)'], {
      env: { RESOURCE_PROFILE: 'nope' },
      stderr: err.stream,
    });
    expect(code).toBe(2);
    expect(err.text()).toContain('RESOURCE_PROFILE');
    expect(err.text()).not.toContain('spawn');
  });

  it('maps an unreadable .env to an exec: line and exit 2 without spawning', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'lrm-exec-'));
    try {
      // A directory named .env makes readFileSync throw EISDIR.
      mkdirSync(join(cwd, '.env'));
      const err = collect();
      const code = await main([process.execPath, '-e', 'process.exit(0)'], {
        env: {},
        cwd,
        stderr: err.stream,
      });
      expect(code).toBe(2);
      expect(err.text()).toMatch(/^exec: .*EISDIR/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('maps a spawn failure to 127', async () => {
    const err = collect();
    const code = await main(['definitely-missing-binary-lrm-2'], { env: {}, stderr: err.stream });
    expect(code).toBe(127);
  });

  it('runs the wrapped command with real machine facts and reports the line', async () => {
    const err = collect();
    const code = await main([process.execPath, '-e', 'process.exit(0)'], {
      env: {},
      stderr: err.stream,
    });
    expect(code).toBe(0);
    expect(err.text()).toMatch(/^resource profile: (low|cloud|full) \(/);
  });
});
