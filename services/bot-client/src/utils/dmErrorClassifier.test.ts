import { describe, it, expect } from 'vitest';
import { DiscordAPIError } from 'discord.js';
import { classifyDmError, dmErrorCode } from './dmErrorClassifier.js';

function makeDiscordError(code: number, status = 403): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: 'x' },
    code,
    status,
    'POST',
    'https://discord.com/api',
    {}
  );
}

describe('classifyDmError', () => {
  it('classifies 50007 (cannot DM user) as permanent', () => {
    const result = classifyDmError(makeDiscordError(50007));
    expect(result).toEqual({ kind: 'permanent', code: 50007 });
  });

  it('classifies 10013 (unknown user) as permanent', () => {
    const result = classifyDmError(makeDiscordError(10013));
    expect(result).toEqual({ kind: 'permanent', code: 10013 });
  });

  it('classifies other Discord API errors as transient', () => {
    const result = classifyDmError(makeDiscordError(0, 500));
    expect(result.kind).toBe('transient');
  });

  it('classifies node network errors as transient with the errno', () => {
    const error = new Error('timeout') as NodeJS.ErrnoException;
    error.code = 'ETIMEDOUT';
    expect(classifyDmError(error)).toEqual({ kind: 'transient', cause: 'ETIMEDOUT' });
  });

  it('classifies unknown shapes as transient', () => {
    expect(classifyDmError('boom').kind).toBe('transient');
  });
});

describe('dmErrorCode', () => {
  it('uses the numeric code for permanent failures', () => {
    expect(dmErrorCode({ kind: 'permanent', code: 50007 })).toBe('50007');
  });

  it('caps transient causes at the ledger column width', () => {
    const code = dmErrorCode({ kind: 'transient', cause: 'x'.repeat(80) });
    expect(code.length).toBeLessThanOrEqual(50);
  });
});
