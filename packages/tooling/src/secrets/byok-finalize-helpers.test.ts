/**
 * Tests for stage-3 BYOK finalize helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RailwayIds } from '../deployment/railway-status.js';

const { resolveRailwayIds } = vi.hoisted(() => ({
  resolveRailwayIds: vi.fn(),
}));

vi.mock('../deployment/railway-status.js', () => ({
  resolveRailwayIds,
}));

import { deleteFailureError, resolveServiceIds } from './byok-finalize-helpers.js';

describe('resolveServiceIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the three ids when serviceId is present', () => {
    resolveRailwayIds.mockReturnValue({
      projectId: 'proj',
      environmentId: 'envid',
      serviceId: 'svc-api-gateway',
    } satisfies RailwayIds);

    expect(resolveServiceIds('dev', 'api-gateway')).toEqual({
      projectId: 'proj',
      environmentId: 'envid',
      serviceId: 'svc-api-gateway',
    });
    expect(resolveRailwayIds).toHaveBeenCalledWith('dev', 'api-gateway');
  });

  it('throws when serviceId is undefined', () => {
    resolveRailwayIds.mockReturnValue({
      projectId: 'proj',
      environmentId: 'envid',
    } satisfies RailwayIds);

    expect(() => resolveServiceIds('dev', 'api-gateway')).toThrow('without a service id');
  });
});

describe('deleteFailureError', () => {
  it('instructs to re-run stage 3 when absentNow is empty and preserves cause', () => {
    const cause = new Error('network down');
    const err = deleteFailureError({
      env: 'dev',
      service: 'a',
      services: ['a', 'b'],
      absentNow: [],
      varName: 'X',
      error: cause,
    });

    expect(err.message).toContain('Re-run stage 3 to retry');
    expect(err.message).not.toContain('--service');
    expect(err.cause).toBe(cause);
  });

  it('lists absent and remaining services with var-delete commands when absentNow is non-empty', () => {
    const cause = new Error('api error');
    const err = deleteFailureError({
      env: 'dev',
      service: 'b',
      services: ['a', 'b', 'c'],
      absentNow: ['a'],
      varName: 'X',
      error: cause,
    });

    expect(err.message).toContain('absent on a');
    expect(err.message).toContain('still set on b, c');
    expect(err.message).toContain(
      '`pnpm ops deploy:var-delete --env dev --service b --name X --yes`; `pnpm ops deploy:var-delete --env dev --service c --name X --yes`'
    );
    expect(err.cause).toBe(cause);
  });
});
