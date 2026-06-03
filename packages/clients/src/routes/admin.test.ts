/**
 * Tests for the admin route manifest.
 *
 * Structural invariants — every admin route has audience: 'admin',
 * serviceOnly should NOT be set (admin routes have a human actor),
 * acceptsSubject is allowed (denylist, future subject-aware admin routes).
 * No duplicate IDs / method+path pairs.
 */

import { describe, it, expect } from 'vitest';
import { adminRoutes } from './admin.js';
import type { AnyRouteDef } from './types.js';

const entries = Object.entries(adminRoutes) as [string, AnyRouteDef][];

describe('admin route manifest', () => {
  it('has at least one entry', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('every entry has audience: "admin"', () => {
    for (const [key, route] of entries) {
      expect(route.audience, `${key} audience`).toBe('admin');
    }
  });

  it('no entry has serviceOnly: true (admin routes have a human actor)', () => {
    for (const [key, route] of entries) {
      expect(route.serviceOnly, `${key} serviceOnly`).toBeFalsy();
    }
  });

  it('no entry has requiresProvisionedUser (provisioning is user-only)', () => {
    for (const [key, route] of entries) {
      expect(route.requiresProvisionedUser, `${key} requiresProvisionedUser`).toBeFalsy();
    }
  });

  it('object key matches the route.id', () => {
    for (const [key, route] of entries) {
      expect(route.id).toBe(key);
    }
  });

  it('no duplicate IDs', () => {
    const ids = entries.map(([, r]) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no duplicate (method, path) pairs', () => {
    const pairs = entries.map(([, r]) => `${r.method} ${r.path}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('every entry has an output schema', () => {
    for (const [key, route] of entries) {
      expect(route.output, `${key} output`).toBeDefined();
    }
  });

  it('every path starts with "/"', () => {
    for (const [key, route] of entries) {
      expect(route.path.startsWith('/'), `${key} path "${route.path}"`).toBe(true);
    }
  });

  it('declared params keys match the :name placeholders in path', () => {
    for (const [key, route] of entries) {
      const pathParams = [...route.path.matchAll(/:(\w+)/g)].map(m => m[1]);
      const declaredParams = Object.keys(route.params ?? {});
      expect(declaredParams.sort(), `${key} params vs path`).toEqual(pathParams.sort());
    }
  });
});
