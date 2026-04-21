import { describe, it, expect } from 'vitest';
import type { ApiCheck } from './apiCheck.js';

describe('ApiCheck', () => {
  it('exhaustively discriminates ok vs error at compile time', () => {
    // This test intentionally exercises the discriminator at the type level.
    // If a future caller drops a branch, TypeScript's exhaustiveness check
    // (via `never` on `_exhaustive`) will flag it before runtime.
    function describeCheck<T>(check: ApiCheck<T>): string {
      switch (check.kind) {
        case 'ok':
          return `ok: ${String(check.value)}`;
        case 'error':
          return `error: ${check.error}`;
        default: {
          const _exhaustive: never = check;
          return _exhaustive;
        }
      }
    }

    expect(describeCheck<number>({ kind: 'ok', value: 42 })).toBe('ok: 42');
    expect(describeCheck<string>({ kind: 'error', error: 'timeout' })).toBe('error: timeout');
  });
});
