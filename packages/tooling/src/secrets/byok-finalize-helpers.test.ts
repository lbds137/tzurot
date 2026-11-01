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

import {
  assertFinalizeWindowState,
  classifyFinalizeWindow,
  deleteFailureError,
  resolveServiceIds,
} from './byok-finalize-helpers.js';

describe('classifyFinalizeWindow', () => {
  const CURRENT = 'current-key-value-for-test';
  const PREVIOUS = 'previous-key-value-for-test';

  it('returns open when every service holds a distinct non-empty previous value', () => {
    expect(
      classifyFinalizeWindow({
        current: CURRENT,
        previousByService: [PREVIOUS, PREVIOUS],
      })
    ).toBe('open');
  });

  it('returns open when one service still holds a distinct non-empty previous value and the other is absent or empty', () => {
    expect(
      classifyFinalizeWindow({
        current: CURRENT,
        previousByService: [PREVIOUS, undefined],
      })
    ).toBe('open');
    expect(
      classifyFinalizeWindow({
        current: CURRENT,
        previousByService: ['', PREVIOUS],
      })
    ).toBe('open');
  });

  it.each([
    { label: 'undefined on both services', previousByService: [undefined, undefined] },
    { label: 'empty string on both services', previousByService: ['', ''] },
    { label: 'undefined on one and empty string on the other', previousByService: [undefined, ''] },
  ])('returns none when PREVIOUS is $label', ({ previousByService }) => {
    expect(
      classifyFinalizeWindow({
        current: CURRENT,
        previousByService,
      })
    ).toBe('none');
  });

  it.each([
    { label: 'equal to current on both services', previousByService: [CURRENT, CURRENT] },
    {
      label: 'equal to current on one service and undefined on the other',
      previousByService: [CURRENT, undefined],
    },
    {
      label: 'equal to current on one service and empty string on the other',
      previousByService: ['', CURRENT],
    },
  ])('returns degenerate when PREVIOUS is $label', ({ previousByService }) => {
    expect(
      classifyFinalizeWindow({
        current: CURRENT,
        previousByService,
      })
    ).toBe('degenerate');
  });
});

describe('assertFinalizeWindowState', () => {
  const CURRENT = 'current-key-value-for-test';
  const PREVIOUS = 'previous-key-value-for-test';

  it.each([false, true])(
    'throws on a degenerate window (resume=%s) and directs the operator to stage 1',
    resume => {
      expect(() =>
        assertFinalizeWindowState({
          env: 'dev',
          resume,
          current: CURRENT,
          previousByService: [CURRENT, undefined],
        })
      ).toThrow(/never rotated.*pnpm ops secrets:rotate-byok --env dev --stage 1/s);
    }
  );

  it('throws on a closed window without --resume, naming both --stage 1 and --stage 3 --resume', () => {
    expect(() =>
      assertFinalizeWindowState({
        env: 'dev',
        resume: false,
        current: CURRENT,
        previousByService: [undefined, ''],
      })
    ).toThrow(
      /pnpm ops secrets:rotate-byok --env dev --stage 1.*pnpm ops secrets:rotate-byok --env dev --stage 3 --resume/s
    );
  });

  it('throws on an open window with --resume, telling the operator to run stage 3 without --resume', () => {
    expect(() =>
      assertFinalizeWindowState({
        env: 'dev',
        resume: true,
        current: CURRENT,
        previousByService: [PREVIOUS, PREVIOUS],
      })
    ).toThrow(/nothing to resume.*pnpm ops secrets:rotate-byok --env dev --stage 3/is);
  });

  it('allows an open window without --resume and a closed window with --resume', () => {
    expect(() =>
      assertFinalizeWindowState({
        env: 'dev',
        resume: false,
        current: CURRENT,
        previousByService: [PREVIOUS, PREVIOUS],
      })
    ).not.toThrow();
    expect(() =>
      assertFinalizeWindowState({
        env: 'dev',
        resume: true,
        current: CURRENT,
        previousByService: [undefined, ''],
      })
    ).not.toThrow();
  });
});

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
    expect(err.message).toContain('re-run stage 3 with --resume');
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
    expect(err.message).toContain('may still be set on b, c');
    expect(err.message).toContain(
      '`pnpm ops deploy:var-delete --env dev --service b --name X --yes`; `pnpm ops deploy:var-delete --env dev --service c --name X --yes`'
    );
    expect(err.message).toContain('re-run stage 3 with --resume');
    expect(err.cause).toBe(cause);
  });
});
