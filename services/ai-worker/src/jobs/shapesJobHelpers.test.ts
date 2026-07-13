import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  claimShapesFetchSlot,
  handleShapesJobError,
  type ShapesJobErrorContext,
} from './shapesJobHelpers.js';
import {
  ShapesAuthError,
  ShapesFetchBusyError,
  ShapesFetchError,
} from '../services/shapes/shapesErrors.js';
import type { ShapesFetchGate } from '../services/shapes/shapesFetchGate.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

interface TestResult {
  success: boolean;
  error?: string;
}

function createMockJob(overrides: { attemptsMade?: number; attempts?: number } = {}) {
  return {
    opts: { attempts: overrides.attempts ?? 3 },
    attemptsMade: overrides.attemptsMade ?? 0,
  } as never;
}

function createCtx(
  overrides: Partial<ShapesJobErrorContext<TestResult>> = {}
): ShapesJobErrorContext<TestResult> {
  return {
    jobType: 'export',
    error: new Error('something went wrong'),
    job: createMockJob(),
    jobId: 'job-123',
    sourceSlug: 'test-slug',
    markFailed: vi.fn(),
    buildFailureResult: (errorMessage: string) => ({ success: false, error: errorMessage }),
    ...overrides,
  };
}

describe('handleShapesJobError', () => {
  beforeEach(() => vi.resetAllMocks());

  it('re-throws retryable errors when retries remain', async () => {
    const error = new Error('Network timeout');
    const ctx = createCtx({
      error,
      job: createMockJob({ attemptsMade: 0, attempts: 3 }),
    });

    await expect(handleShapesJobError(ctx)).rejects.toThrow('Network timeout');
    expect(ctx.markFailed).not.toHaveBeenCalled();
  });

  it('marks failed and returns failure result on final retry attempt', async () => {
    const ctx = createCtx({
      error: new Error('Network timeout'),
      job: createMockJob({ attemptsMade: 2, attempts: 3 }),
    });

    const result = await handleShapesJobError(ctx);

    expect(ctx.markFailed).toHaveBeenCalledWith('Network timeout');
    expect(result).toEqual({ success: false, error: 'Network timeout' });
  });

  it('marks failed immediately for non-retryable errors (ShapesAuthError)', async () => {
    const ctx = createCtx({
      error: new ShapesAuthError('Auth expired'),
      job: createMockJob({ attemptsMade: 0, attempts: 3 }),
    });

    const result = await handleShapesJobError(ctx);

    expect(ctx.markFailed).toHaveBeenCalledWith('Auth expired');
    expect(result).toEqual({ success: false, error: 'Auth expired' });
  });

  it('marks failed immediately for non-retryable errors (ShapesFetchError)', async () => {
    const ctx = createCtx({
      error: new ShapesFetchError(403, 'Forbidden'),
      job: createMockJob({ attemptsMade: 0, attempts: 3 }),
    });

    const result = await handleShapesJobError(ctx);

    expect(ctx.markFailed).toHaveBeenCalledWith('Forbidden');
    expect(result).toEqual({ success: false, error: 'Forbidden' });
  });

  it('handles jobs with no configured attempts (defaults to 1)', async () => {
    const job = { opts: {}, attemptsMade: 0 } as never;
    const ctx = createCtx({ error: new Error('fail'), job });

    const result = await handleShapesJobError(ctx);

    expect(ctx.markFailed).toHaveBeenCalledWith('fail');
    expect(result).toEqual({ success: false, error: 'fail' });
  });

  it('handles non-Error values', async () => {
    const ctx = createCtx({ error: 'string error' });
    // String errors are retryable (not a known shapes error type)
    // With attemptsMade: 0, attempts: 3 → willRetry = true → re-throws
    await expect(handleShapesJobError(ctx)).rejects.toBe('string error');
  });

  it('works correctly with import job type', async () => {
    const ctx = createCtx({
      jobType: 'import',
      error: new ShapesAuthError('No credentials'),
      job: createMockJob({ attemptsMade: 0, attempts: 3 }),
    });

    const result = await handleShapesJobError(ctx);

    expect(result).toEqual({ success: false, error: 'No credentials' });
  });
});

describe('claimShapesFetchSlot', () => {
  it('returns false (nothing to release) when no gate is supplied', async () => {
    await expect(claimShapesFetchSlot(undefined)).resolves.toBe(false);
  });

  it('returns true when the gate grants a slot', async () => {
    const gate = {
      tryAcquire: vi.fn().mockResolvedValue('acquired'),
      maxConcurrent: 2,
    } as unknown as ShapesFetchGate;
    await expect(claimShapesFetchSlot(gate)).resolves.toBe(true);
  });

  it('returns false on fail-open — the fetch proceeds but no slot is held to release', async () => {
    const gate = {
      tryAcquire: vi.fn().mockResolvedValue('fail-open'),
      maxConcurrent: 2,
    } as unknown as ShapesFetchGate;
    await expect(claimShapesFetchSlot(gate)).resolves.toBe(false);
  });

  it('throws the retryable busy error naming the cap when the gate denies', async () => {
    const gate = {
      tryAcquire: vi.fn().mockResolvedValue('denied'),
      maxConcurrent: 2,
    } as unknown as ShapesFetchGate;
    await expect(claimShapesFetchSlot(gate)).rejects.toThrow(ShapesFetchBusyError);
    await expect(claimShapesFetchSlot(gate)).rejects.toThrow(/cap 2/);
  });
});
