import { describe, it, expect } from 'vitest';
import {
  AUTOCOMPLETE_ERROR_SENTINEL,
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
  isTransientHttpStatus,
  type ApiCheck,
} from './apiCheck.js';

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

describe('isTransientHttpStatus', () => {
  // Transient status set:
  //   - 0 is the gateway client's sentinel for timeouts / network errors
  //     where no HTTP response was received.
  //   - 5xx is classic server-side transient. 599 is the ceiling.
  //   - 429 is transient DESPITE being 4xx: rate limits self-resolve
  //     without user action and the user's data hasn't changed. Serving
  //     stale data through a rate-limit window is the right UX.
  it.each([0, 429, 500, 502, 503, 504, 599])('returns true for transient status %i', status => {
    expect(isTransientHttpStatus(status)).toBe(true);
  });

  // Permanent status set: 4xx (except 429, above) is client-side and
  // won't resolve without a caller fix. 499 is a deliberate call-out —
  // it's the top of the client error range and must NOT be treated as
  // transient despite being numerically adjacent to 500.
  it.each([400, 401, 403, 404, 499])('returns false for permanent status %i', status => {
    expect(isTransientHttpStatus(status)).toBe(false);
  });

  // 2xx / 3xx shouldn't reach this helper in practice (those are success
  // paths that don't need classification), but pin the behavior anyway
  // so a caller who passes a 200 doesn't silently get treated as transient.
  it.each([200, 204, 301, 302])('returns false for non-error status %i', status => {
    expect(isTransientHttpStatus(status)).toBe(false);
  });
});

describe('isAutocompleteErrorSentinel', () => {
  it('returns true for the exact sentinel string', () => {
    expect(isAutocompleteErrorSentinel(AUTOCOMPLETE_ERROR_SENTINEL)).toBe(true);
  });

  // A user typing the sentinel with leading/trailing whitespace, wrong casing,
  // or partial substring must NOT trip the guard. The autocomplete UI only
  // ever submits the exact literal — any deviation is a legitimate user
  // search string and should flow through to the normal "not found" path.
  it.each([
    ['leading space', ' __autocomplete_error__'],
    ['trailing space', '__autocomplete_error__ '],
    ['uppercase', '__AUTOCOMPLETE_ERROR__'],
    ['substring prefix', '__autocomplete_error'],
    ['substring containing', 'foo__autocomplete_error__bar'],
    ['empty', ''],
    ['unrelated', 'my-character-slug'],
  ])('returns false for %s', (_description, value) => {
    expect(isAutocompleteErrorSentinel(value)).toBe(false);
  });
});

describe('AUTOCOMPLETE_UNAVAILABLE_MESSAGE', () => {
  it('is a non-empty user-facing string', () => {
    // Pin the invariant that the message has content and a user-readable prefix
    // without over-specifying the wording. A future copy-edit should not break
    // this test; changing the message to empty or a raw error code should.
    expect(AUTOCOMPLETE_UNAVAILABLE_MESSAGE.length).toBeGreaterThan(0);
    expect(AUTOCOMPLETE_UNAVAILABLE_MESSAGE.toLowerCase()).toContain('autocomplete');
  });
});
