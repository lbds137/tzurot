import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloneCacheKernel } from './CloneCacheKernel.js';

describe('CloneCacheKernel', () => {
  let kernel: CloneCacheKernel;

  beforeEach(() => {
    vi.useFakeTimers();
    kernel = new CloneCacheKernel({
      positiveTtlMs: 30 * 60 * 1000,
      negativeTtlMs: 5 * 60 * 1000,
      maxSize: 10,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const neverCache = (): null => null;
  const alwaysCache = (_error: unknown, reason: string): string => reason;

  it('positive hit returns without invoking work', async () => {
    const work = vi.fn().mockResolvedValue('voice-1');
    await kernel.resolve({
      cacheKey: 'k',
      describe: 'clone "a"',
      work,
      classifyFailure: neverCache,
    });

    const again = vi.fn();
    const result = await kernel.resolve({
      cacheKey: 'k',
      describe: 'clone "a"',
      work: again,
      classifyFailure: neverCache,
    });

    expect(result).toBe('voice-1');
    expect(again).not.toHaveBeenCalled();
  });

  it('negative hit throws the describe-prefixed cached reason without invoking work', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('quota exceeded'));
    await expect(
      kernel.resolve({
        cacheKey: 'k',
        describe: 'clone "a"',
        work: failing,
        classifyFailure: alwaysCache,
      })
    ).rejects.toThrow('quota exceeded');

    const again = vi.fn();
    await expect(
      kernel.resolve({
        cacheKey: 'k',
        describe: 'clone "a"',
        work: again,
        classifyFailure: neverCache,
      })
    ).rejects.toThrow('clone "a" recently failed: quota exceeded');
    expect(again).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent resolves — work runs exactly once', async () => {
    let release: (value: string) => void = () => undefined;
    const work = vi.fn().mockImplementation(
      () =>
        new Promise<string>(resolve => {
          release = resolve;
        })
    );

    const first = kernel.resolve({
      cacheKey: 'k',
      describe: 'd',
      work,
      classifyFailure: neverCache,
    });
    const second = kernel.resolve({
      cacheKey: 'k',
      describe: 'd',
      work,
      classifyFailure: neverCache,
    });
    release('voice-9');

    await expect(first).resolves.toBe('voice-9');
    await expect(second).resolves.toBe('voice-9');
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('classifier returning null propagates the raw error and caches nothing', async () => {
    const original = new Error('rate limited');
    const work = vi.fn().mockRejectedValue(original);

    await expect(
      kernel.resolve({ cacheKey: 'k', describe: 'd', work, classifyFailure: neverCache })
    ).rejects.toBe(original);

    // No negative entry: the next attempt re-invokes work.
    const retry = vi.fn().mockResolvedValue('voice-2');
    await expect(
      kernel.resolve({ cacheKey: 'k', describe: 'd', work: retry, classifyFailure: neverCache })
    ).resolves.toBe('voice-2');
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('classifier receives the error and the derived reason string', async () => {
    const original = new Error('boom');
    const classify = vi.fn().mockReturnValue(null);
    const promise = kernel.resolve({
      cacheKey: 'k',
      describe: 'd',
      work: vi.fn().mockRejectedValue(original),
      classifyFailure: classify,
    });
    const assertion = expect(promise).rejects.toBe(original);
    await assertion;

    expect(classify).toHaveBeenCalledWith(original, 'boom');
  });

  it('clears inflight after rejection — the dedup map never wedges', async () => {
    await expect(
      kernel.resolve({
        cacheKey: 'k',
        describe: 'd',
        work: vi.fn().mockRejectedValue(new Error('x')),
        classifyFailure: neverCache,
      })
    ).rejects.toThrow('x');

    expect(kernel.hasInflight('k')).toBe(false);
  });

  it('invalidate drops both records; deleteNegative drops only the failure', async () => {
    await kernel.resolve({
      cacheKey: 'good',
      describe: 'd',
      work: vi.fn().mockResolvedValue('voice-1'),
      classifyFailure: neverCache,
    });
    await expect(
      kernel.resolve({
        cacheKey: 'bad',
        describe: 'clone "bad"',
        work: vi.fn().mockRejectedValue(new Error('nope')),
        classifyFailure: alwaysCache,
      })
    ).rejects.toThrow('nope');

    kernel.invalidate('good');
    expect(kernel.getCached('good')).toBeNull();

    kernel.deleteNegative('bad');
    const retry = vi.fn().mockResolvedValue('voice-3');
    await expect(
      kernel.resolve({ cacheKey: 'bad', describe: 'd', work: retry, classifyFailure: neverCache })
    ).resolves.toBe('voice-3');
  });

  it('has + getCached + clear expose the positive record for eviction support', async () => {
    await kernel.resolve({
      cacheKey: 'k',
      describe: 'd',
      work: vi.fn().mockResolvedValue('voice-7'),
      classifyFailure: neverCache,
    });
    expect(kernel.has('k')).toBe(true);
    expect(kernel.getCached('k')).toBe('voice-7');

    kernel.clear();
    expect(kernel.has('k')).toBe(false);
  });

  it('derives a reason string from a non-Error rejection', async () => {
    const classify = vi.fn().mockReturnValue(null);
    const promise = kernel.resolve({
      cacheKey: 'k',
      describe: 'd',
      work: vi.fn().mockRejectedValue('raw string failure'),
      classifyFailure: classify,
    });
    const assertion = expect(promise).rejects.toBe('raw string failure');
    await assertion;

    expect(classify).toHaveBeenCalledWith('raw string failure', 'raw string failure');
  });
});
