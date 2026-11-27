import { afterEach, describe, expect, it, vi } from 'vitest';
import { cac } from 'cac';

import { UsageError } from '../utils/errors.js';
import {
  registerResourceCommands,
  renderResourceEnv,
  runResourceEnvCommand,
  shSingleQuote,
  type ResourceEnvInput,
} from './resource.js';

const GiB = 1024 ** 3;
const input = (env: Record<string, string> = {}): ResourceEnvInput => ({
  env,
  envFileValues: undefined,
  cpus: 8,
  memTotalBytes: Math.round(14.45 * GiB),
});

describe('renderResourceEnv', () => {
  it('sh output is eval-able: comment line then quoted exports', () => {
    const text = renderResourceEnv('sh', input());
    const lines = text.split('\n');
    expect(lines[0]).toBe(
      '# resource profile: low (auto: 14.5 GiB total memory) - turbo 1, vitest 2, heap 3072 MB'
    );
    expect(lines.slice(1).map(line => line.startsWith('export '))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(text).toContain("export RESOURCE_PROFILE='low'");
    expect(text).toContain("export VITEST_MAX_WORKERS='2'");
    expect(text).toContain("export TURBO_CONCURRENCY='1'");
    expect(text).toContain("export NODE_OPTIONS='--max-old-space-size=3072'");
  });

  it('json output carries profile, trigger, knobs and env', () => {
    const parsed = JSON.parse(renderResourceEnv('json', input())) as Record<string, unknown>;
    expect(parsed.profile).toBe('low');
    expect(parsed.trigger).toBe('auto: 14.5 GiB total memory');
    expect(parsed.knobs).toEqual({ turboConcurrency: 1, vitestMaxWorkers: 2, nodeHeapMb: 3072 });
    expect(parsed.env).toEqual({
      RESOURCE_PROFILE: 'low',
      VITEST_MAX_WORKERS: '2',
      TURBO_CONCURRENCY: '1',
      NODE_OPTIONS: '--max-old-space-size=3072',
    });
  });

  it('full profile exports only the two keys', () => {
    const text = renderResourceEnv('sh', input({ CI: 'true' }));
    expect(text).toContain("export RESOURCE_PROFILE='full'");
    expect(text).toContain("export VITEST_MAX_WORKERS='3'");
    expect(text).not.toContain('TURBO_CONCURRENCY');
    expect(text).not.toContain('NODE_OPTIONS');
  });
});

describe('shSingleQuote', () => {
  it('escapes single quotes the sh way', () => {
    expect(shSingleQuote("a'b")).toBe(`a'\\''b`);
  });
});

describe('runResourceEnvCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the rendered sh output', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    runResourceEnvCommand({}, input());
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain("export RESOURCE_PROFILE='low'");
  });

  it('rejects an unknown format naming the valid ones', () => {
    expect(() => runResourceEnvCommand({ format: 'yaml' }, input())).toThrow(UsageError);
    expect(() => runResourceEnvCommand({ format: 'yaml' }, input())).toThrow(/sh or json/);
  });

  it('builds the default input from the live process when none is injected', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    runResourceEnvCommand({ format: 'json' });
    const parsed = JSON.parse(log.mock.calls[0]?.[0] as string) as { profile: string };
    expect(['low', 'cloud', 'full']).toContain(parsed.profile);
  });

  it('registers resource:env so parsing it invokes the action', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cli = cac('test');
    registerResourceCommands(cli);
    expect(cli.commands.some(command => command.name === 'resource:env')).toBe(true);
    cli.parse(['tsx', 'test', 'resource:env', '--format', 'json']);
    const parsed = JSON.parse(log.mock.calls[0]?.[0] as string) as { profile: string };
    expect(['low', 'cloud', 'full']).toContain(parsed.profile);
  });
});
