import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleShapesJobError, type ShapesJobErrorContext } from './shapesJobHelpers.js';
import { ShapesAuthError, ShapesFetchError } from '../services/shapes/shapesErrors.js';

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

vi.mock('./shapesCredentials.js', async () => {
  const actual = await vi.importActual('./shapesCredentials.js');
  return actual;
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
