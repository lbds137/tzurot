/**
 * Tests for the internal route manifest.
 *
 * These are STRUCTURAL invariant tests — they assert properties that must
 * hold across the whole `internalRoutes` registry (every route has audience
 * 'internal', every route is serviceOnly, no duplicate IDs, no duplicate
 * method+path pairs). They don't validate individual route behavior; that
 * belongs in the route handler tests in api-gateway.
 *
 * The strictness here protects the codegen tool's correctness: a duplicate
 * id would produce a typed-client method collision; a non-internal route
 * sneaking into this file would mount at the wrong prefix.
 */

import { describe, it, expect } from 'vitest';
import { internalRoutes } from './internal.js';
import type { AnyRouteDef } from './types.js';

const entries = Object.entries(internalRoutes) as [string, AnyRouteDef][];

describe('internal route manifest', () => {
  it('has at least one entry (smoke test)', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('every entry has audience: "internal"', () => {
    for (const [key, route] of entries) {
      expect(route.audience, `${key} audience`).toBe('internal');
    }
  });

  it('every entry has serviceOnly: true', () => {
    for (const [key, route] of entries) {
      expect(route.serviceOnly, `${key} serviceOnly`).toBe(true);
    }
  });

  it('object key matches the route.id', () => {
    for (const [key, route] of entries) {
      expect(route.id).toBe(key);
    }
  });

  it('no duplicate IDs (smart-constructor of the typed client method names)', () => {
    const ids = entries.map(([, r]) => r.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('no duplicate (method, path) pairs (Express would warn at mount time)', () => {
    const pairs = entries.map(([, r]) => `${r.method} ${r.path}`);
    const unique = new Set(pairs);
    expect(unique.size).toBe(pairs.length);
  });

  it('every entry has an output schema (required for typed client return)', () => {
    for (const [key, route] of entries) {
      expect(route.output, `${key} output`).toBeDefined();
    }
  });

  it('no entry has acceptsSubject: true (subject only valid on admin routes)', () => {
    for (const [key, route] of entries) {
      expect(route.acceptsSubject, `${key} acceptsSubject`).toBeFalsy();
    }
  });

  it('no entry has requiresProvisionedUser: true (provisioning only meaningful for user routes)', () => {
    for (const [key, route] of entries) {
      expect(route.requiresProvisionedUser, `${key} requiresProvisionedUser`).toBeFalsy();
    }
  });

  it('every path starts with "/" (Express path convention)', () => {
    for (const [key, route] of entries) {
      expect(route.path.startsWith('/'), `${key} path "${route.path}" should start with /`).toBe(
        true
      );
    }
  });

  it('declared params keys match the `:name` placeholders in path', () => {
    for (const [key, route] of entries) {
      const pathParams = [...route.path.matchAll(/:(\w+)/g)].map(m => m[1]);
      const declaredParams = Object.keys(route.params ?? {});
      expect(declaredParams.sort(), `${key} params`).toEqual(pathParams.sort());
    }
  });
});
