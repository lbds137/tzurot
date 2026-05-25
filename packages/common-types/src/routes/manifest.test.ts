/**
 * Tests for the central route manifest registry.
 *
 * Per-audience invariants live in the audience-scoped test files
 * (internal.test.ts, admin.test.ts, user/index.test.ts). This file
 * asserts cross-audience invariants — disjointness, audience-feature
 * exclusivity, and global uniqueness.
 */

import { describe, it, expect } from 'vitest';
import { ROUTE_MANIFEST, adminRoutes, internalRoutes, userRoutes } from './manifest.js';
import type { AnyRouteDef } from './types.js';

const entries = Object.entries(ROUTE_MANIFEST) as [string, AnyRouteDef][];

describe('central route manifest', () => {
  it('has at least one entry from each audience', () => {
    expect(Object.keys(internalRoutes).length).toBeGreaterThan(0);
    expect(Object.keys(adminRoutes).length).toBeGreaterThan(0);
    expect(Object.keys(userRoutes).length).toBeGreaterThan(0);
  });

  it('contains every entry from every audience manifest', () => {
    const expectedSize =
      Object.keys(internalRoutes).length +
      Object.keys(adminRoutes).length +
      Object.keys(userRoutes).length;
    expect(entries.length).toBe(expectedSize);
  });

  it('no duplicate route IDs across audiences', () => {
    const ids = entries.map(([, r]) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no duplicate (audience, method, path) tuples', () => {
    const tuples = entries.map(([, r]) => `${r.audience} ${r.method} ${r.path}`);
    expect(new Set(tuples).size).toBe(tuples.length);
  });

  it('serviceOnly only appears on internal audience', () => {
    for (const [key, route] of entries) {
      if (route.serviceOnly === true) {
        expect(route.audience, `${key} audience for serviceOnly`).toBe('internal');
      }
    }
  });

  it('requiresProvisionedUser only appears on user audience', () => {
    for (const [key, route] of entries) {
      if (route.requiresProvisionedUser === true) {
        expect(route.audience, `${key} audience for requiresProvisionedUser`).toBe('user');
      }
    }
  });

  it('acceptsSubject only appears on admin or user audiences', () => {
    for (const [key, route] of entries) {
      if (route.acceptsSubject === true) {
        expect(['admin', 'user'], `${key} audience for acceptsSubject`).toContain(route.audience);
      }
    }
  });

  it('object keys match route.id for every entry (no merge-key drift)', () => {
    for (const [key, route] of entries) {
      expect(route.id, `${key} id mismatch`).toBe(key);
    }
  });

  it('audience values are one of the three known audiences', () => {
    const allowed = new Set(['internal', 'admin', 'user']);
    for (const [key, route] of entries) {
      expect(allowed.has(route.audience), `${key} audience "${route.audience}"`).toBe(true);
    }
  });

  it('every entry has a path that starts with "/"', () => {
    for (const [key, route] of entries) {
      expect(route.path.startsWith('/'), `${key} path "${route.path}"`).toBe(true);
    }
  });

  it('acceptsSubject routes do not also declare userId in their query schema', () => {
    // The `acceptsSubject: true` flag tells the codegen to emit a
    // `['userId', options.subject]` entry into the query-string builder.
    // If the same route's `query` ALSO declares a `userId` key, the
    // codegen would emit two `['userId', ...]` entries — and
    // URLSearchParams.set() silently keeps only the last, so the
    // typed-subject brand can be silently overwritten by a raw-string
    // userId. The whole point of `acceptsSubject` + branded types is to
    // prevent exactly this class of silent failure.
    for (const [key, route] of entries) {
      if (route.acceptsSubject === true && route.query !== undefined) {
        expect(
          'userId' in route.query,
          `${key} declares acceptsSubject AND query.userId — would generate ` +
            `duplicate URLSearchParams entries; drop the userId query key`
        ).toBe(false);
      }
    }
  });

  it('timeoutMs values are integers in [1000, 60_000]', () => {
    // Bounds:
    //   - lower 1000ms: catches the "typed seconds instead of ms"
    //     mistake (`timeoutMs: 30` → meant 30s, got 30ms)
    //   - upper 60_000ms (1 min): catches the inverse mistake AND
    //     the "this should really be async/streaming" anti-pattern;
    //     largest named constant is GATEWAY_TIMEOUTS.BULK_OPERATION
    //     = 30s, so 60s is 2x headroom for one-off future cases
    //   - Number.isInteger: rejects NaN, decimals, Infinity
    // A route that genuinely needs >60s should be a BullMQ job, not
    // a sync gateway request.
    for (const [key, route] of entries) {
      if (route.timeoutMs !== undefined) {
        expect(Number.isInteger(route.timeoutMs), `${key} timeoutMs integer`).toBe(true);
        expect(route.timeoutMs, `${key} timeoutMs >= 1000`).toBeGreaterThanOrEqual(1000);
        expect(route.timeoutMs, `${key} timeoutMs <= 60_000`).toBeLessThanOrEqual(60_000);
      }
    }
  });

  it('GET routes do not declare an input body schema', () => {
    // GET-with-body is broken in the field — Node's fetch (and many
    // intermediaries) drop the body, so a manifest entry like
    // `{ method: 'get', input: SomeSchema }` would generate a client
    // method that silently loses its body on the wire. DELETE-with-body
    // is allowed by HTTP and used here for bulk-delete patterns
    // (e.g., deactivateChannel takes a `channelId` body), so it's not
    // restricted by this invariant.
    for (const [key, route] of entries) {
      if (route.method === 'get') {
        expect(route.input, `${key} (GET) should not declare input`).toBeUndefined();
      }
    }
  });
});
