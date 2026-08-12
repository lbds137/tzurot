import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { isTimeoutKill } from './timeoutKill.js';

describe('isTimeoutKill', () => {
  it('is true for a REAL timeout kill, with the partial-stdout hazard present', () => {
    // Deliberately not a synthetic `{ code: 'ETIMEDOUT' }` fixture: the whole
    // point of this helper is what Node actually attaches, so the test drives
    // a genuine bounded child. The command prints before sleeping, so the
    // thrown error carries partial stdout — the exact shape that makes a
    // content-branching catch return a confident wrong answer.
    let caught: unknown;
    try {
      execFileSync('sh', ['-c', 'printf partial; sleep 5'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 300,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(isTimeoutKill(caught)).toBe(true);
    // Pin the two facts the module's doc comment asserts, so a Node change
    // that moves them fails here rather than silently disabling the guard.
    expect((caught as { stdout?: string }).stdout).toBe('partial');
    expect((caught as { killed?: unknown }).killed).toBeUndefined();
  });

  it('is false for an ordinary non-zero exit that carries real output', () => {
    // The case the guard must NOT swallow: `grep`-style exit 1, where the
    // catch legitimately wants to inspect the output.
    let caught: unknown;
    try {
      execFileSync('sh', ['-c', 'printf real; exit 1'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(isTimeoutKill(caught)).toBe(false);
    expect((caught as { stdout?: string }).stdout).toBe('real');
  });

  it('is false for non-error inputs rather than throwing', () => {
    expect(isTimeoutKill(undefined)).toBe(false);
    expect(isTimeoutKill(null)).toBe(false);
    expect(isTimeoutKill('ETIMEDOUT')).toBe(false);
    expect(isTimeoutKill({})).toBe(false);
    expect(isTimeoutKill(new Error('plain'))).toBe(false);
  });
});
