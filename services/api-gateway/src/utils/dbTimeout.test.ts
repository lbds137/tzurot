import { describe, it, expect } from 'vitest';
import { classifyDbTimeout } from './dbTimeout.js';

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
