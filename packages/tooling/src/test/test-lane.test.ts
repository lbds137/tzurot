import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  provisionLaneDatabase,
  runTestLane,
  validateIntegrationDbName,
  type ResolvedLaneReport,
  type TestLaneCommandOptions,
} from './test-lane.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

const mockExec = vi.mocked(execFileSync);

describe('validateIntegrationDbName', () => {
  it('accepts lowercase alphanumeric and underscore database names', () => {
    expect(() => validateIntegrationDbName('tzurot_integration_test')).not.toThrow();
    expect(() => validateIntegrationDbName('tzurot_integration_b_test')).not.toThrow();
  });

  it('refuses names with uppercase characters, dashes, quotes, or spaces', () => {
    expect(() => validateIntegrationDbName('tzurot-integration-test')).toThrow(
      /Invalid integration database name/
    );
    expect(() => validateIntegrationDbName('Tzurot_test')).toThrow(
      /Invalid integration database name/
    );
    expect(() => validateIntegrationDbName("tzurot_test'; DROP DATABASE tzurot;--")).toThrow(
      /Invalid integration database name/
    );
  });
});

describe('runTestLane and provisionLaneDatabase', () => {
  let logged: string[];
  let warned: string[];

  beforeEach(() => {
    logged = [];
    warned = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockExec.mockReset();
  });

  it('prints the resolved lane, source, Redis DB index, and integration DB name without running podman', () => {
    const opts: TestLaneCommandOptions = {
      rootDir: '/srv/work/tzurot-b',
      env: {},
    };
    const result: ResolvedLaneReport = runTestLane(opts);

    expect(result).toEqual({
      lane: 'b',
      source: 'path',
      redisDb: 14,
      integrationDbName: 'tzurot_integration_b_test',
    });
    expect(mockExec).not.toHaveBeenCalled();
    expect(logged.join('\n')).toContain('Test lane:           b (source: path)');
    expect(logged.join('\n')).toContain('Redis DB index:      14');
    expect(logged.join('\n')).toContain('Integration DB name: tzurot_integration_b_test');
  });

  it('creates the database and enables extensions when absent (--provision seam argv)', () => {
    mockExec.mockReturnValueOnce('').mockReturnValueOnce('').mockReturnValueOnce('');

    const result = runTestLane({
      rootDir: '/srv/work/tzurot-b',
      env: {},
      provision: true,
    });

    expect(result.created).toBe(true);
    expect(mockExec).toHaveBeenCalledTimes(3);
    expect(mockExec).toHaveBeenNthCalledWith(
      1,
      'podman',
      [
        'exec',
        'tzurot-postgres',
        'psql',
        '-U',
        'tzurot',
        '-tAc',
        "SELECT 1 FROM pg_database WHERE datname = 'tzurot_integration_b_test'",
      ],
      { encoding: 'utf-8' }
    );
    expect(mockExec).toHaveBeenNthCalledWith(
      2,
      'podman',
      ['exec', 'tzurot-postgres', 'createdb', '-U', 'tzurot', 'tzurot_integration_b_test'],
      { encoding: 'utf-8' }
    );
    expect(mockExec).toHaveBeenNthCalledWith(
      3,
      'podman',
      [
        'exec',
        'tzurot-postgres',
        'psql',
        '-U',
        'tzurot',
        '-d',
        'tzurot_integration_b_test',
        '-c',
        'CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS citext',
      ],
      { encoding: 'utf-8' }
    );
    expect(logged.join('\n')).toContain(
      `Next step, in one line (README.md § Local Development's URL with database "tzurot_integration_b_test"): DATABASE_URL=<that URL> pnpm ops db:migrate`
    );
  });

  it('resolves the lane from the workspace root above a nested cwd when rootDir is omitted', () => {
    const base = mkdtempSync(join(tmpdir(), 'lane-root-'));
    try {
      const checkout = join(base, 'tzurot-c');
      const nested = join(checkout, 'packages', 'tooling');
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(checkout, 'pnpm-workspace.yaml'), '');
      vi.spyOn(process, 'cwd').mockReturnValue(nested);

      const result = runTestLane({ env: {} });

      expect(result.lane).toBe('c');
      expect(result.source).toBe('path');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('skips createdb when the integration database already exists', () => {
    mockExec.mockReturnValueOnce('1\n').mockReturnValueOnce('');

    const result = runTestLane({
      rootDir: '/srv/work/tzurot',
      env: {},
      provision: true,
    });

    expect(result.created).toBe(false);
    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockExec).toHaveBeenNthCalledWith(
      1,
      'podman',
      [
        'exec',
        'tzurot-postgres',
        'psql',
        '-U',
        'tzurot',
        '-tAc',
        "SELECT 1 FROM pg_database WHERE datname = 'tzurot_integration_test'",
      ],
      { encoding: 'utf-8' }
    );
    expect(mockExec).toHaveBeenNthCalledWith(
      2,
      'podman',
      [
        'exec',
        'tzurot-postgres',
        'psql',
        '-U',
        'tzurot',
        '-d',
        'tzurot_integration_test',
        '-c',
        'CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS citext',
      ],
      { encoding: 'utf-8' }
    );
  });

  it('refuses an unsafe database name before invoking podman', () => {
    expect(() => provisionLaneDatabase('bad-name;drop')).toThrow(
      /Invalid integration database name/
    );
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('prints a warning when a tzurot* checkout name falls back to lane a via path resolution (/srv/w/tzurot-f)', () => {
    const result = runTestLane({
      rootDir: '/srv/w/tzurot-f',
      env: {},
    });

    expect(result.lane).toBe('a');
    expect(result.source).toBe('path');
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/tzurot-f.*tzurot-b\.\.tzurot-e.*shares lane a.*TZUROT_TEST_LANE/);
  });

  it('does not print a warning for /srv/w/tzurot or /srv/w/tzurot-b', () => {
    runTestLane({ rootDir: '/srv/w/tzurot', env: {} });
    runTestLane({ rootDir: '/srv/w/tzurot-b', env: {} });

    expect(warned).toEqual([]);
  });

  it('does not print a warning for a differently-cased main clone (/srv/w/Tzurot)', () => {
    runTestLane({ rootDir: '/srv/w/Tzurot', env: {} });

    expect(warned).toEqual([]);
  });
});
