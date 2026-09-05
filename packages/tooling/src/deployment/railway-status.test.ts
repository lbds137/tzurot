import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { UsageError } from '../utils/errors.js';
import { resolveRailwayIds } from './railway-status.js';

// `railway-status.ts` calls execFileSync with `encoding: 'utf-8'`, so the real
// return value is a string; execFileSync's overload set would otherwise force
// every mockReturnValue through a Buffer cast.
const mockExecFileSync = vi.mocked(execFileSync) as unknown as Mock<(...args: unknown[]) => string>;

function statusPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'proj-1',
    name: 'tzurot',
    environments: {
      edges: [
        { node: { id: 'env-dev', name: 'development' } },
        { node: { id: 'env-prod', name: 'production' } },
      ],
    },
    services: {
      edges: [
        { node: { id: 'svc-bot', name: 'bot-client' } },
        { node: { id: 'svc-redis', name: 'Redis' } },
      ],
    },
    volumes: { edges: [] },
    ...overrides,
  };
}

describe('resolveRailwayIds', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it('resolves project/environment/service ids for the service-scoped happy path', () => {
    mockExecFileSync.mockReturnValue(JSON.stringify(statusPayload()));

    const result = resolveRailwayIds('dev', 'bot-client');

    expect(result).toEqual({
      projectId: 'proj-1',
      environmentId: 'env-dev',
      serviceId: 'svc-bot',
    });
  });

  it('omits serviceId for a shared (project-level) lookup', () => {
    mockExecFileSync.mockReturnValue(JSON.stringify(statusPayload()));

    const result = resolveRailwayIds('prod', null);

    expect(result.projectId).toBe('proj-1');
    expect(result.environmentId).toBe('env-prod');
    expect(Object.hasOwn(result, 'serviceId')).toBe(false);
  });

  it('throws UsageError listing environment names when the environment is not found', () => {
    mockExecFileSync.mockReturnValue(
      JSON.stringify(
        statusPayload({ environments: { edges: [{ node: { id: 'x', name: 'staging' } }] } })
      )
    );

    let caught: unknown;
    try {
      resolveRailwayIds('dev', null);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UsageError);
    expect((caught as Error).message).toContain('staging');
  });

  it('throws UsageError listing service names when the service is not found (case-sensitive)', () => {
    mockExecFileSync.mockReturnValue(JSON.stringify(statusPayload()));

    let caught: unknown;
    try {
      resolveRailwayIds('dev', 'redis');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UsageError);
    expect((caught as Error).message).toContain('bot-client');
    expect((caught as Error).message).toContain('Redis');
  });

  it('throws UsageError on malformed JSON', () => {
    mockExecFileSync.mockReturnValue('not json{{');

    expect(() => resolveRailwayIds('dev', null)).toThrow(UsageError);
    expect(() => resolveRailwayIds('dev', null)).toThrow(/JSON/);
  });

  it('throws UsageError naming the failing path when the schema does not match', () => {
    mockExecFileSync.mockReturnValue(
      JSON.stringify(
        statusPayload({
          environments: { edges: [{ node: { name: 'development' } }] }, // missing id
        })
      )
    );

    let caught: unknown;
    try {
      resolveRailwayIds('dev', null);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UsageError);
    expect((caught as Error).message).toContain('environments');
  });

  it('passes a 30s timeout to execFileSync', () => {
    mockExecFileSync.mockReturnValue(JSON.stringify(statusPayload()));

    resolveRailwayIds('dev', null);

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'railway',
      ['status', '--json'],
      expect.objectContaining({ timeout: 30_000 })
    );
  });

  it('rethrows as UsageError mentioning "railway link" when execFileSync throws', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('spawnSync railway ENOENT');
    });

    let caught: unknown;
    try {
      resolveRailwayIds('dev', null);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UsageError);
    expect((caught as Error).message).toContain('railway link');
  });
});
