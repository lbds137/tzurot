import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveCreditExhaustionKey,
  executeClear,
  type RedisClientLike,
} from './clear-credit-exhaustion.js';

describe('resolveCreditExhaustionKey', () => {
  it('returns user-scoped key when --user-id is set', () => {
    const result = resolveCreditExhaustionKey({ userId: '278863839632818186' });
    expect(result).toEqual({
      kind: 'ok',
      key: 'nocredits:openrouter:user:278863839632818186',
    });
  });

  it('returns system-bucket key when --system is set', () => {
    const result = resolveCreditExhaustionKey({ system: true });
    expect(result).toEqual({ kind: 'ok', key: 'nocredits:openrouter:system' });
  });

  it('returns mutually-exclusive error when both flags are set', () => {
    const result = resolveCreditExhaustionKey({
      userId: '278863839632818186',
      system: true,
    });
    expect(result).toEqual({ kind: 'error', reason: 'mutually-exclusive' });
  });

  it('returns missing-flag error when neither flag is set', () => {
    const result = resolveCreditExhaustionKey({});
    expect(result).toEqual({ kind: 'error', reason: 'missing-flag' });
  });

  it('treats empty userId as missing (not present)', () => {
    // CAC may pass `--user-id ""` as an empty string; treat the same as omission.
    const result = resolveCreditExhaustionKey({ userId: '' });
    expect(result).toEqual({ kind: 'error', reason: 'missing-flag' });
  });

  it('does NOT include model dimension in the key (account-wide)', () => {
    const result = resolveCreditExhaustionKey({ userId: '111111111111111111' });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.key).not.toContain('glm');
      expect(result.key).not.toContain(':free');
    }
  });
});

describe('executeClear', () => {
  let mockRedis: RedisClientLike;

  beforeEach(() => {
    mockRedis = {
      del: vi.fn(),
      disconnect: vi.fn(),
    };
  });

  it('returns deleted=1 when Redis confirms the key existed', async () => {
    (mockRedis.del as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    const result = await executeClear(mockRedis, 'nocredits:openrouter:user:111');
    expect(result).toEqual({ deleted: 1 });
    expect(mockRedis.del).toHaveBeenCalledWith('nocredits:openrouter:user:111');
  });

  it('returns deleted=0 when the key was already cleared / never set', async () => {
    (mockRedis.del as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    const result = await executeClear(mockRedis, 'nocredits:openrouter:system');
    expect(result).toEqual({ deleted: 0 });
  });

  it('returns an error message when Redis DEL throws', async () => {
    (mockRedis.del as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection refused'));
    const result = await executeClear(mockRedis, 'nocredits:openrouter:system');
    expect(result.deleted).toBe(0);
    expect(result.error).toBe('Connection refused');
  });

  it('always disconnects the Redis client (even on error)', async () => {
    (mockRedis.del as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    await executeClear(mockRedis, 'nocredits:openrouter:system');
    expect(mockRedis.disconnect).toHaveBeenCalledTimes(1);
  });

  it('handles non-Error throwables from Redis (defensive String coercion)', async () => {
    (mockRedis.del as ReturnType<typeof vi.fn>).mockRejectedValue('string error');
    const result = await executeClear(mockRedis, 'nocredits:openrouter:system');
    expect(result.error).toBe('string error');
  });
});
