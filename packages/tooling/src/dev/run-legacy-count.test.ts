/**
 * Tests for the legacy-count CLI runner.
 *
 * The runner is mostly I/O glue (cwd resolution, baseline read/write,
 * formatted output) — the comparison/counting logic is exercised
 * directly in `legacy-count.test.ts`. These tests pin the runner's
 * exit-code behavior and the `--update` path, since CI relies on
 * non-zero on regression and zero on level/burn-down.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLegacyCount } from './run-legacy-count.js';

let workspace: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'legacy-count-runner-'));
  mkdirSync(join(workspace, 'services/bot-client/src'), { recursive: true });
  mkdirSync(join(workspace, '.github/baselines'), { recursive: true });

  // Vitest worker pools don't allow process.chdir(); stub cwd instead.
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workspace);

  // process.exit must throw in tests — otherwise the runner falls through
  // to additional console.error calls and we can't distinguish exit paths.
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null) => {
    throw new Error(`process.exit(${code ?? 'undefined'})`);
  }) as never;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  cwdSpy.mockRestore();
  exitSpy.mockRestore();
  logSpy.mockRestore();
  errSpy.mockRestore();
});

function seedSource(content: string, relPath = 'commands/x.ts'): void {
  const full = join(workspace, 'services/bot-client/src', relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf-8');
}

const baselinePath = (): string =>
  join(workspace, '.github/baselines/legacy-callsite-baseline.json');

describe('runLegacyCount — --update mode', () => {
  it('writes a baseline file with current counts', async () => {
    seedSource('adminFetch(); callGatewayApi(); callGatewayApi();');

    await runLegacyCount({ update: true });

    const baseline = JSON.parse(readFileSync(baselinePath(), 'utf-8')) as {
      adminFetch: number;
      callGatewayApi: number;
      version: number;
    };
    expect(baseline.adminFetch).toBe(1);
    expect(baseline.callGatewayApi).toBe(2);
    expect(baseline.version).toBe(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('overwrites an existing baseline', async () => {
    writeFileSync(
      baselinePath(),
      JSON.stringify({
        version: 1,
        lastUpdated: '2020-01-01T00:00:00Z',
        adminFetch: 999,
        callGatewayApi: 999,
        notes: 'stale',
      })
    );
    seedSource('adminFetch();');

    await runLegacyCount({ update: true });

    const baseline = JSON.parse(readFileSync(baselinePath(), 'utf-8')) as {
      adminFetch: number;
    };
    expect(baseline.adminFetch).toBe(1);
  });
});

describe('runLegacyCount — check mode (no --update)', () => {
  function writeBaseline(adminFetch: number, callGatewayApi: number): void {
    writeFileSync(
      baselinePath(),
      JSON.stringify({
        version: 1,
        lastUpdated: '2026-01-01T00:00:00Z',
        adminFetch,
        callGatewayApi,
        notes: 'test',
      })
    );
  }

  it('exits 1 when baseline is missing', async () => {
    seedSource('adminFetch();');

    await expect(runLegacyCount({})).rejects.toThrow('process.exit(1)');
  });

  it('exits 0 when counts are level with baseline', async () => {
    writeBaseline(1, 1);
    seedSource('adminFetch(); callGatewayApi();');

    await runLegacyCount({});

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits 0 when counts are below baseline (burn-down)', async () => {
    writeBaseline(5, 10);
    seedSource('adminFetch(); callGatewayApi();');

    await runLegacyCount({});

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits 1 when adminFetch regresses', async () => {
    writeBaseline(0, 100);
    seedSource('adminFetch();');

    await expect(runLegacyCount({})).rejects.toThrow('process.exit(1)');
  });

  it('exits 1 when callGatewayApi regresses', async () => {
    writeBaseline(100, 0);
    seedSource('callGatewayApi();');

    await expect(runLegacyCount({})).rejects.toThrow('process.exit(1)');
  });
});
