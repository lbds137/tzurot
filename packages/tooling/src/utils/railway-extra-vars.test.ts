import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../deployment/railway-api.js', () => ({
  readRailwayVariableValue: vi.fn(),
}));

vi.mock('../deployment/railway-status.js', () => ({
  resolveRailwayIds: vi.fn(),
}));

import { readRailwayVariableValue } from '../deployment/railway-api.js';
import { resolveRailwayIds } from '../deployment/railway-status.js';
import { parseWithVarNames, resolveExtraRailwayVars } from './railway-extra-vars.js';

const mockReadRailwayVariableValue = vi.mocked(readRailwayVariableValue);
const mockResolveRailwayIds = vi.mocked(resolveRailwayIds);

describe('parseWithVarNames', () => {
  it('returns an empty array for undefined', () => {
    expect(parseWithVarNames(undefined)).toEqual([]);
  });

  it('splits a single comma-separated string', () => {
    expect(parseWithVarNames('FOO,BAR')).toEqual(['FOO', 'BAR']);
  });

  it('splits and concatenates a repeated-flag array', () => {
    expect(parseWithVarNames(['FOO,BAR', 'BAZ'])).toEqual(['FOO', 'BAR', 'BAZ']);
  });

  it('trims whitespace and drops empty entries', () => {
    expect(parseWithVarNames(' FOO , , BAR ')).toEqual(['FOO', 'BAR']);
  });

  it('de-duplicates, preserving first-seen order', () => {
    expect(parseWithVarNames('FOO,BAR,FOO')).toEqual(['FOO', 'BAR']);
  });

  it('de-duplicates across repeated flags', () => {
    expect(parseWithVarNames(['FOO', 'BAR,FOO'])).toEqual(['FOO', 'BAR']);
  });
});

describe('resolveExtraRailwayVars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('makes no call to either Railway helper when names is empty', async () => {
    const result = await resolveExtraRailwayVars('dev', []);

    expect(result).toEqual({});
    expect(mockResolveRailwayIds).not.toHaveBeenCalled();
    expect(mockReadRailwayVariableValue).not.toHaveBeenCalled();
  });

  it('resolves two names, calling resolveRailwayIds exactly once with (env, null)', async () => {
    mockResolveRailwayIds.mockReturnValue({
      projectId: 'proj-1',
      environmentId: 'env-1',
    });
    mockReadRailwayVariableValue.mockImplementation(
      async ({ name }: { name: string }) =>
        ({ FOO: 'foo-value-sentinel', BAR: 'bar-value-sentinel' })[name]
    );

    const result = await resolveExtraRailwayVars('dev', ['FOO', 'BAR']);

    expect(result).toEqual({ FOO: 'foo-value-sentinel', BAR: 'bar-value-sentinel' });
    expect(mockResolveRailwayIds).toHaveBeenCalledTimes(1);
    expect(mockResolveRailwayIds).toHaveBeenCalledWith('dev', null);
  });

  it('throws a UsageError naming the missing variable and environment', async () => {
    mockResolveRailwayIds.mockReturnValue({
      projectId: 'proj-1',
      environmentId: 'env-1',
    });
    mockReadRailwayVariableValue.mockImplementation(
      async ({ name }: { name: string }) =>
        (({ FOO: 'foo-value-sentinel' }) as Record<string, string | undefined>)[name]
    );

    await expect(resolveExtraRailwayVars('dev', ['FOO', 'MISSING_VAR'])).rejects.toThrow(
      /MISSING_VAR/
    );
    await expect(resolveExtraRailwayVars('dev', ['FOO', 'MISSING_VAR'])).rejects.toThrow(/dev/);
  });

  it('never leaks a sibling name’s resolved value in the missing-variable error message', async () => {
    mockResolveRailwayIds.mockReturnValue({
      projectId: 'proj-1',
      environmentId: 'env-1',
    });
    mockReadRailwayVariableValue.mockImplementation(
      async ({ name }: { name: string }) =>
        (({ FOO: 'foo-value-sentinel' }) as Record<string, string | undefined>)[name]
    );

    let message = '';
    try {
      await resolveExtraRailwayVars('dev', ['FOO', 'MISSING_VAR']);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('MISSING_VAR');
    expect(message).not.toContain('foo-value-sentinel');
  });
});
