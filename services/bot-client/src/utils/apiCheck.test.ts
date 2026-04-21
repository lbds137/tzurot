import { describe, it, expect } from 'vitest';
import type { ApiCheck } from './apiCheck.js';

describe('ApiCheck', () => {
  it('exhaustively discriminates ok vs error (exhaustiveness-checked via never)', () => {
    // The runtime assertions below confirm each branch returns its expected
    // shape, but the real guarantee is at the type level: the `_exhaustive:
    // never` line will fail compilation if a future caller adds a new variant
    // to `ApiCheck<T>` and forgets to handle it here.
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
