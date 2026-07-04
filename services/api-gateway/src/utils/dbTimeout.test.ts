import { describe, it, expect, vi } from 'vitest';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { classifyDbTimeout, withDeadConnRetry, applyFastPoolDeadConnRetry } from './dbTimeout.js';

describe('classifyDbTimeout', () => {
  it('labels a lock_timeout by SQLSTATE 55P03', () => {
    expect(classifyDbTimeout({ code: '55P03' })).toEqual({
      label: 'lock-timeout',
      sqlstate: '55P03',
    });
  });

  it('labels a lock_timeout by message phrasing when no code surfaces', () => {
    expect(classifyDbTimeout(new Error('canceling statement due to lock timeout'))).toEqual({
      label: 'lock-timeout',
      sqlstate: '55P03',
    });
  });

  it('labels a statement_timeout by SQLSTATE 57014', () => {
    expect(classifyDbTimeout({ code: '57014' })).toEqual({
      label: 'statement-timeout',
      sqlstate: '57014',
    });
  });

  it('labels a statement_timeout by message phrasing', () => {
    expect(classifyDbTimeout(new Error('canceling statement due to statement timeout'))).toEqual({
      label: 'statement-timeout',
      sqlstate: '57014',
    });
  });

  it('finds the SQLSTATE nested under Prisma .meta', () => {
    expect(
      classifyDbTimeout({ name: 'PrismaClientKnownRequestError', meta: { code: '55P03' } })
    ).toEqual({ label: 'lock-timeout', sqlstate: '55P03' });
  });

  it('finds the SQLSTATE chained on .cause', () => {
    expect(classifyDbTimeout({ message: 'wrapped', cause: { code: '57014' } })).toEqual({
      label: 'statement-timeout',
      sqlstate: '57014',
    });
  });

  it('labels the client-side query_timeout / dead-socket cases', () => {
    expect(classifyDbTimeout(new Error('Query read timeout')).label).toBe(
      'query-timeout-or-dead-conn'
    );
    expect(classifyDbTimeout(new Error('Connection terminated unexpectedly')).label).toBe(
      'query-timeout-or-dead-conn'
    );
    expect(classifyDbTimeout({ code: 'ECONNRESET', message: 'read ECONNRESET' }).label).toBe(
      'query-timeout-or-dead-conn'
    );
    // ETIMEDOUT on `.code` only (no message) — caught via the code-in-text path.
    expect(classifyDbTimeout({ code: 'ETIMEDOUT' }).label).toBe('query-timeout-or-dead-conn');
  });

  it('classifies the real Prisma-wrapped shape (SQLSTATE is in the message, not .code)', () => {
    // Confirmed against the dev DB: Prisma 7 puts its own P2010 on .code and
    // buries the true SQLSTATE in the wrapped message.
    const realErr = {
      name: 'PrismaClientKnownRequestError',
      code: 'P2010',
      message:
        'Invalid `prisma.$queryRaw()` invocation:\n\n' +
        'Raw query failed. Code: `57014`. Message: `canceling statement due to statement timeout`',
    };
    expect(classifyDbTimeout(realErr)).toEqual({ label: 'statement-timeout', sqlstate: '57014' });
  });

  it('treats Prisma P-codes as not-a-SQLSTATE, but carries a real SQLSTATE on other', () => {
    // P2002 (unique-violation race) is a Prisma code, not a SQLSTATE.
    expect(classifyDbTimeout({ code: 'P2002', message: 'Unique constraint failed' })).toEqual({
      label: 'other',
    });
    expect(classifyDbTimeout(new Error('some unrelated failure'))).toEqual({ label: 'other' });
    // A genuine (non-P) SQLSTATE on an unrelated error is carried through.
    expect(classifyDbTimeout({ code: '23505' })).toEqual({ label: 'other', sqlstate: '23505' });
  });

  it('does not throw on non-object inputs', () => {
    expect(classifyDbTimeout(null).label).toBe('other');
    expect(classifyDbTimeout(undefined).label).toBe('other');
    expect(classifyDbTimeout('boom').label).toBe('other');
  });
});

describe('withDeadConnRetry', () => {
  it('returns the result without retrying on success', async () => {
    const op = vi.fn().mockResolvedValue('ok');
    const onRetry = vi.fn();
    await expect(withDeadConnRetry(op, onRetry)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries ONCE on a dead-conn error and succeeds on the fresh connection', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('Query read timeout'))
      .mockResolvedValueOnce('ok');
    const onRetry = vi.fn();
    await expect(withDeadConnRetry(op, onRetry)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does NOT retry a real statement-timeout (the query ran server-side)', async () => {
    const err = { code: '57014' };
    const op = vi.fn().mockRejectedValue(err);
    const onRetry = vi.fn();
    await expect(withDeadConnRetry(op, onRetry)).rejects.toBe(err);
    expect(op).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('does NOT retry a lock-timeout or a constraint (P2002) error', async () => {
    const lockErr = { code: '55P03' };
    const opLock = vi.fn().mockRejectedValue(lockErr);
    await expect(withDeadConnRetry(opLock)).rejects.toBe(lockErr);
    expect(opLock).toHaveBeenCalledTimes(1);

    const p2002 = { code: 'P2002', message: 'Unique constraint failed' };
    const opP2002 = vi.fn().mockRejectedValue(p2002);
    await expect(withDeadConnRetry(opP2002)).rejects.toBe(p2002);
    expect(opP2002).toHaveBeenCalledTimes(1);
  });

  it('re-throws if the retry ALSO hits a dead conn (surfaces the second failure)', async () => {
    const first = new Error('Query read timeout');
    const second = new Error('Connection terminated unexpectedly');
    const op = vi.fn().mockRejectedValueOnce(first).mockRejectedValueOnce(second);
    const onRetry = vi.fn();
    await expect(withDeadConnRetry(op, onRetry)).rejects.toBe(second);
    expect(op).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('works without an onRetry callback', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('Query read timeout'))
      .mockResolvedValueOnce('ok');
    await expect(withDeadConnRetry(op)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });
});

describe('applyFastPoolDeadConnRetry', () => {
  // Capture the `$allOperations` handler the extension installs, then drive it
  // directly — this is the structural retry boundary every fast-pool op flows
  // through, so testing the handler proves ALL fast-pool queries get the retry.
  type AllOps = (ctx: {
    query: (args: unknown) => Promise<unknown>;
    args: unknown;
    operation: string;
    model?: string;
  }) => Promise<unknown>;

  function capture(): { allOps: AllOps | undefined } {
    const box: { allOps: AllOps | undefined } = { allOps: undefined };
    const fakeClient = {
      $extends: (ext: { query: { $allOperations: AllOps } }) => {
        box.allOps = ext.query.$allOperations;
        return fakeClient;
      },
    };
    applyFastPoolDeadConnRetry(fakeClient as unknown as PrismaClient);
    return box;
  }

  it('installs an $allOperations handler that retries the dead-conn class once', async () => {
    const { allOps } = capture();
    expect(allOps).toBeDefined();

    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('Query read timeout'))
      .mockResolvedValueOnce('ok');
    const result = await allOps!({ query, args: { where: {} }, operation: 'findUnique' });

    expect(result).toBe('ok');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a real statement-timeout through the extension', async () => {
    const { allOps } = capture();
    const query = vi.fn().mockRejectedValue({ code: '57014' });

    await expect(allOps!({ query, args: {}, operation: 'create' })).rejects.toEqual({
      code: '57014',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
