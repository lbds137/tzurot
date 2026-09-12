import { describe, it, expect } from 'vitest';

import { execErrorOutput } from './execErrorOutput.js';

describe('execErrorOutput', () => {
  it('joins stdout and stderr when an Error carries both', () => {
    const error = new Error('Command failed') as Error & { stdout?: string; stderr?: string };
    error.stdout = 'some progress output\n';
    error.stderr = 'fatal: something went wrong\n';
    expect(execErrorOutput(error)).toBe('some progress output\n\nfatal: something went wrong\n');
  });

  it('returns stderr alone when an Error carries only stderr', () => {
    const error = new Error('Command failed') as Error & { stderr?: string };
    error.stderr = 'fatal: Not possible to fast-forward, aborting.\n';
    expect(execErrorOutput(error)).toBe('fatal: Not possible to fast-forward, aborting.\n');
  });

  it('falls back to error.message when an Error carries neither', () => {
    const error = new Error('plain failure message');
    expect(execErrorOutput(error)).toBe('plain failure message');
  });

  it('stringifies a non-Error thrown value', () => {
    expect(execErrorOutput('a string failure')).toBe('a string failure');
    expect(execErrorOutput(42)).toBe('42');
  });
});
